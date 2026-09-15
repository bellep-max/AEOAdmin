/**
 * PULL-model runner. Fetches eligible leads from a source, then submits each to
 * `/api/onboarding/free-trial` (which creates the client, keywords, variants, and
 * sends the welcome + owner-alert emails). Idempotent by email server-side and by
 * a local cursor file here, so it is safe to run on a schedule (cron / App Runner
 * job) or by hand.
 *
 * Run (dry run — no writes, prints what WOULD happen):
 *   LEAD_SOURCE=file LEAD_FILE=scripts/lead-pull/sample-leads.json DRY_RUN=1 \
 *     node scripts/lead-pull/run.ts
 *
 * Run for real against prod:
 *   API_BASE=https://jjm59vpn3y.us-east-1.awsapprunner.com \
 *   FREE_TRIAL_TOKEN=...   # from Secrets Manager aeo-admin/prod \
 *   LEAD_SOURCE=http LEADS_URL=https://belle.example/leads/eligible LEADS_URL_TOKEN=... \
 *     node scripts/lead-pull/run.ts
 *
 * Env:
 *   LEAD_SOURCE   file | http                       (default: file)
 *   LEAD_FILE     path to a JSON array of leads      (LEAD_SOURCE=file)
 *   LEADS_URL     belle's list-eligible-leads GET    (LEAD_SOURCE=http)
 *   LEADS_URL_TOKEN  bearer for LEADS_URL            (optional)
 *   API_BASE      our API base                       (required unless DRY_RUN)
 *   FREE_TRIAL_TOKEN  X-Free-Trial-Token value       (required unless DRY_RUN)
 *   STORE_FILE    processed-cursor path              (default: scripts/lead-pull/.processed.json)
 *   DRY_RUN       any truthy value → no POSTs
 */
import fs from "node:fs";
import path from "node:path";
import {
  runPull,
  type LeadSource,
  type ProcessedStore,
  type RawLead,
  type FreeTrialPayload,
  type SubmitResponse,
} from "./core.ts";

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim().length > 0 ? v.trim() : undefined;
};
const isTruthy = (v: string | undefined): boolean =>
  v != null && !["", "0", "false", "no"].includes(v.toLowerCase());

const DRY_RUN = isTruthy(env("DRY_RUN"));
const SOURCE = (env("LEAD_SOURCE") ?? "file").toLowerCase();
const STORE_FILE =
  env("STORE_FILE") ?? path.join("scripts", "lead-pull", ".processed.json");

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ---- lead sources --------------------------------------------------------
function fileSource(): LeadSource {
  const file = env("LEAD_FILE") ?? fail("LEAD_SOURCE=file needs LEAD_FILE");
  return {
    fetchLeads: async () => {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) fail(`${file} must contain a JSON array`);
      return parsed as RawLead[];
    },
  };
}

function httpSource(): LeadSource {
  const url = env("LEADS_URL") ?? fail("LEAD_SOURCE=http needs LEADS_URL");
  const token = env("LEADS_URL_TOKEN");
  return {
    fetchLeads: async () => {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) fail(`LEADS_URL returned HTTP ${res.status}`);
      const body = await res.json();
      // Accept a bare array or an { data: [...] } / { leads: [...] } envelope.
      const arr = Array.isArray(body)
        ? body
        : Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body?.leads)
            ? body.leads
            : fail("LEADS_URL response is not an array or {data|leads:[...]}");
      return arr as RawLead[];
    },
  };
}

function makeSource(): LeadSource {
  switch (SOURCE) {
    case "file":
      return fileSource();
    case "http":
      return httpSource();
    case "dynamodb":
      fail(
        "LEAD_SOURCE=dynamodb is not enabled yet — belle's read access is pending. " +
          "See scripts/lead-pull/README.md. Use LEAD_SOURCE=http against a list-eligible-leads endpoint in the meantime.",
      );
    // fallthrough unreachable
    default:
      return fail(`unknown LEAD_SOURCE "${SOURCE}" (file | http)`);
  }
}

// ---- processed store (local cursor) --------------------------------------
function fileStore(filePath: string): ProcessedStore {
  const set = new Set<string>();
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (Array.isArray(parsed?.keys))
        for (const k of parsed.keys) set.add(String(k));
    } catch {
      console.warn(`warn: could not parse ${filePath}, starting fresh`);
    }
  }
  const flush = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ keys: [...set] }, null, 2) + "\n",
    );
  };
  return {
    has: (k) => set.has(k),
    add: (k) => {
      set.add(k);
      flush(); // crash-safe: persist immediately so a mid-batch failure can't re-send
    },
  };
}

// ---- submit --------------------------------------------------------------
function makeSubmit(): (p: FreeTrialPayload) => Promise<SubmitResponse> {
  const apiBase = (env("API_BASE") ?? fail("API_BASE is required")).replace(
    /\/$/,
    "",
  );
  const token = env("FREE_TRIAL_TOKEN") ?? fail("FREE_TRIAL_TOKEN is required");
  return async (payload) => {
    try {
      const res = await fetch(`${apiBase}/api/onboarding/free-trial`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Free-Trial-Token": token,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
      }
      return {
        ok: true,
        idempotent: json?.idempotent === true,
        clientId: json?.clientId,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

// ---- main ----------------------------------------------------------------
const source = makeSource();
const store = fileStore(STORE_FILE);
// In dry run we never POST, so a no-op submit keeps the runner dependency-free.
const submit = DRY_RUN
  ? async (): Promise<SubmitResponse> => ({ ok: true })
  : makeSubmit();

console.log(
  `lead-pull: source=${SOURCE} dryRun=${DRY_RUN} store=${STORE_FILE}`,
);

const summary = await runPull({
  source,
  submit,
  store,
  dryRun: DRY_RUN,
  log: (level, msg, extra) =>
    console[level === "error" ? "error" : "log"](
      `  ${msg}${extra ? " " + JSON.stringify(extra) : ""}`,
    ),
});

console.log("\nsummary:");
console.log(
  JSON.stringify(
    {
      total: summary.total,
      created: summary.created,
      idempotent: summary.idempotent,
      alreadyProcessed: summary.alreadyProcessed,
      ineligible: summary.ineligible,
      ineligibleReasons: summary.ineligibleReasons,
      dryRun: summary.dryRun,
      failed: summary.failed,
    },
    null,
    2,
  ),
);

// Non-zero exit if any lead failed, so a scheduler surfaces the problem.
if (summary.failed > 0) process.exit(2);
