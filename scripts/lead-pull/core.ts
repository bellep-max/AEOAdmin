/**
 * PULL-model core: pure, I/O-free logic for turning belle's eligible leads into
 * free-trial signups on our side.
 *
 * Nothing here touches the network, filesystem, DB, or clock — every side effect
 * is injected (see {@link runPull}). That keeps this module runnable under
 * `node core.test.ts` with no deps and no server bundle coupling. The only
 * external contract is the POST body of `/api/onboarding/free-trial`
 * (see toFreeTrialPayload).
 */

/** A single lead as produced by a source adapter (file / HTTP / DynamoDB). */
export interface RawLead {
  email: string;
  businessName: string;
  address?: string | null;
  website?: string | null;
  /** Business service/category — drives keyword generation when none are sent. */
  service?: string | null;
  brand?: string | null;
  keywords?: string[] | null;
  contactName?: string | null;
  firstName?: string | null;
  /** Stripe customer id captured at signup; `cus_…` is our "card on file" signal. */
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  signupType?: "trial" | "direct" | null;
  /** Stable id from belle's system, used for idempotency + tracing. */
  leadRef?: string | null;
  source?: string | null;
}

/** The subset of the `/free-trial` body this pipeline sends. */
export interface FreeTrialPayload {
  businessName: string;
  email: string;
  keywords?: string[];
  address: string | null;
  website: string | null;
  service: string | null;
  brand: string | null;
  contactName: string | null;
  firstName: string | null;
  signupType: "trial" | "direct";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  leadRef: string | null;
  source: string;
}

export type IneligibleReason =
  | "missing-email"
  | "invalid-email"
  | "missing-business-name"
  | "no-card-on-file"
  | "no-business-baseline";

export interface EligibilityResult {
  eligible: boolean;
  reason?: IneligibleReason;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isNonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const clean = (v: unknown): string | null => (isNonEmpty(v) ? v.trim() : null);

/**
 * A lead is eligible for auto free-trial onboarding when we have enough to
 * create the client AND belle has captured payment. Both gates are required so
 * we never auto-onboard a half-filled lead or one without a card on file.
 */
export function checkEligibility(lead: RawLead): EligibilityResult {
  if (!isNonEmpty(lead.email))
    return { eligible: false, reason: "missing-email" };
  if (!EMAIL_RE.test(lead.email.trim()))
    return { eligible: false, reason: "invalid-email" };
  if (!isNonEmpty(lead.businessName))
    return { eligible: false, reason: "missing-business-name" };

  const hasCard =
    isNonEmpty(lead.stripeCustomerId) &&
    lead.stripeCustomerId.trim().startsWith("cus_");
  if (!hasCard) return { eligible: false, reason: "no-card-on-file" };

  const hasBaseline =
    isNonEmpty(lead.address) ||
    isNonEmpty(lead.website) ||
    isNonEmpty(lead.service);
  if (!hasBaseline) return { eligible: false, reason: "no-business-baseline" };

  return { eligible: true };
}

/**
 * Idempotency key. Prefer belle's stable leadRef; fall back to the email the
 * `/free-trial` endpoint itself dedupes on. Keeps a re-poll from re-submitting.
 */
export function leadKey(lead: RawLead): string {
  return isNonEmpty(lead.leadRef)
    ? `ref:${lead.leadRef.trim()}`
    : `email:${lead.email.trim().toLowerCase()}`;
}

/** Map a raw lead to the `/free-trial` request body. Pure; no defaults invented
 *  beyond signupType (→ "trial") and source (→ "lead-pull") for traceability. */
export function toFreeTrialPayload(lead: RawLead): FreeTrialPayload {
  const keywords = Array.isArray(lead.keywords)
    ? lead.keywords.filter(isNonEmpty).map((k) => k.trim())
    : undefined;
  return {
    businessName: lead.businessName.trim(),
    email: lead.email.trim().toLowerCase(),
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
    address: clean(lead.address),
    website: clean(lead.website),
    service: clean(lead.service),
    brand: clean(lead.brand),
    contactName: clean(lead.contactName),
    firstName: clean(lead.firstName),
    signupType: lead.signupType === "direct" ? "direct" : "trial",
    stripeCustomerId: clean(lead.stripeCustomerId),
    stripeSubscriptionId: clean(lead.stripeSubscriptionId),
    leadRef: clean(lead.leadRef),
    source: clean(lead.source) ?? "lead-pull",
  };
}

/** What the `/free-trial` endpoint tells us back (created vs idempotent). */
export interface SubmitResponse {
  ok: boolean;
  idempotent?: boolean;
  clientId?: number;
  error?: string;
}

export interface LeadSource {
  fetchLeads(): Promise<RawLead[]>;
}

/** Cross-run dedupe store (a local cursor file in the runner). */
export interface ProcessedStore {
  has(key: string): boolean;
  add(key: string): void;
}

export type LogLevel = "info" | "warn" | "error";

export interface PullDeps {
  source: LeadSource;
  submit: (payload: FreeTrialPayload) => Promise<SubmitResponse>;
  store: ProcessedStore;
  log?: (level: LogLevel, msg: string, extra?: Record<string, unknown>) => void;
  /** When true, resolve eligibility + transform but never POST. */
  dryRun?: boolean;
}

export type Outcome =
  | "already-processed"
  | "ineligible"
  | "dry-run"
  | "created"
  | "idempotent"
  | "error";

export interface LeadResult {
  key: string;
  email: string;
  outcome: Outcome;
  reason?: IneligibleReason;
  clientId?: number;
  error?: string;
}

export interface PullSummary {
  total: number;
  alreadyProcessed: number;
  ineligible: number;
  dryRun: number;
  created: number;
  idempotent: number;
  failed: number;
  ineligibleReasons: Record<string, number>;
  results: LeadResult[];
}

function emptySummary(total: number): PullSummary {
  return {
    total,
    alreadyProcessed: 0,
    ineligible: 0,
    dryRun: 0,
    created: 0,
    idempotent: 0,
    failed: 0,
    ineligibleReasons: {},
    results: [],
  };
}

/**
 * Fetch leads, skip already-processed and ineligible ones, and submit the rest
 * to `/free-trial`. Fail-soft per lead: one bad lead never aborts the batch, and
 * only a successful (created / idempotent) submit is marked processed so
 * transient errors retry on the next run.
 */
export async function runPull(deps: PullDeps): Promise<PullSummary> {
  const log = deps.log ?? (() => {});
  const leads = await deps.source.fetchLeads();
  const summary = emptySummary(leads.length);

  for (const lead of leads) {
    const key = leadKey(lead);
    const email = isNonEmpty(lead.email) ? lead.email.trim().toLowerCase() : "";

    if (deps.store.has(key)) {
      summary.alreadyProcessed++;
      summary.results.push({ key, email, outcome: "already-processed" });
      continue;
    }

    const elig = checkEligibility(lead);
    if (!elig.eligible) {
      const reason = elig.reason!;
      summary.ineligible++;
      summary.ineligibleReasons[reason] =
        (summary.ineligibleReasons[reason] ?? 0) + 1;
      summary.results.push({ key, email, outcome: "ineligible", reason });
      log("info", `skip ${key}: ${reason}`);
      continue;
    }

    if (deps.dryRun) {
      summary.dryRun++;
      summary.results.push({ key, email, outcome: "dry-run" });
      continue;
    }

    const payload = toFreeTrialPayload(lead);
    try {
      const resp = await deps.submit(payload);
      if (!resp.ok) {
        summary.failed++;
        summary.results.push({
          key,
          email,
          outcome: "error",
          error: resp.error ?? "submit returned ok:false",
        });
        log("error", `submit failed ${key}`, { error: resp.error });
        continue;
      }
      const outcome: Outcome = resp.idempotent ? "idempotent" : "created";
      if (resp.idempotent) summary.idempotent++;
      else summary.created++;
      deps.store.add(key);
      summary.results.push({ key, email, outcome, clientId: resp.clientId });
      log("info", `${outcome} ${key}`, { clientId: resp.clientId });
    } catch (err) {
      summary.failed++;
      const error = err instanceof Error ? err.message : String(err);
      summary.results.push({ key, email, outcome: "error", error });
      log("error", `submit threw ${key}`, { error });
    }
  }

  return summary;
}
