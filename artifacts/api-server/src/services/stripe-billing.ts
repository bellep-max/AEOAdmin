/**
 * Reads Stripe billing details for a free-trial from either a customer id
 * (`cus_…`) or a subscription id (`sub_…`) and returns a uniform shape we
 * persist: card last-4, billing email, and the relevant dates.
 *
 * Keyed on `cus_`: at trial signup the website captures a card and creates a
 * Stripe CUSTOMER (no subscription yet — that comes at paid conversion). We
 * still accept `sub_` so the same code works once a subscription exists.
 *
 * Plain fetch to Stripe's REST API — no SDK dependency (keeps the Docker build
 * lockfile clean). Fail-soft: never throws; on any error the id is returned
 * with the rest null so the signup + welcome still proceed.
 */

interface Logger {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface StripeBillingDetails {
  /** The `cus_…` or `sub_…` we looked up. */
  stripeId: string;
  cardLast4: string | null;
  billingEmail: string | null;
  /** YYYY-MM-DD (UTC) or null. */
  subscriptionStartDate: string | null;
  /** YYYY-MM-DD (UTC) or null — trial end / first charge (subscription only). */
  nextBillingDate: string | null;
}

type FetchFn = typeof fetch;

interface Options {
  apiKey?: string;
  fetchImpl?: FetchFn;
  log?: Logger;
}

const STRIPE_API = "https://api.stripe.com/v1";

function emptyDetails(stripeId: string): StripeBillingDetails {
  return {
    stripeId,
    cardLast4: null,
    billingEmail: null,
    subscriptionStartDate: null,
    nextBillingDate: null,
  };
}

/** Unix seconds → "YYYY-MM-DD" (UTC), or null. */
function toDate(unixSeconds: unknown): string | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) {
    return null;
  }
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

interface StripeCard {
  card?: { last4?: string } | null;
}
interface StripeSubscription {
  default_payment_method?: StripeCard | null;
  customer?: {
    email?: string | null;
    invoice_settings?: { default_payment_method?: StripeCard | null } | null;
  } | null;
  trial_start?: number | null;
  trial_end?: number | null;
  start_date?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
}
interface StripeCustomer {
  email?: string | null;
  created?: number | null;
  invoice_settings?: { default_payment_method?: StripeCard | null } | null;
}

async function stripeGet<T>(
  path: string,
  apiKey: string,
  doFetch: FetchFn,
): Promise<
  { ok: true; data: T } | { ok: false; status: number; body: string }
> {
  const resp = await doFetch(`${STRIPE_API}/${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, body: body.slice(0, 300) };
  }
  return { ok: true, data: (await resp.json()) as T };
}

async function fetchSubscription(
  subscriptionId: string,
  apiKey: string,
  doFetch: FetchFn,
  log?: Logger,
): Promise<StripeBillingDetails> {
  const params = new URLSearchParams();
  params.append("expand[]", "default_payment_method");
  params.append("expand[]", "customer");
  params.append("expand[]", "customer.invoice_settings.default_payment_method");
  const r = await stripeGet<StripeSubscription>(
    `subscriptions/${encodeURIComponent(subscriptionId)}?${params}`,
    apiKey,
    doFetch,
  );
  if (!r.ok) {
    log?.error(
      { subscriptionId, status: r.status, body: r.body },
      "Stripe subscription lookup failed",
    );
    return emptyDetails(subscriptionId);
  }
  const sub = r.data;
  const last4 =
    sub.default_payment_method?.card?.last4 ??
    sub.customer?.invoice_settings?.default_payment_method?.card?.last4 ??
    null;
  return {
    stripeId: subscriptionId,
    cardLast4: last4,
    billingEmail: sub.customer?.email ?? null,
    subscriptionStartDate: toDate(
      sub.trial_start ?? sub.start_date ?? sub.current_period_start,
    ),
    nextBillingDate: toDate(sub.trial_end ?? sub.current_period_end),
  };
}

async function fetchCustomer(
  customerId: string,
  apiKey: string,
  doFetch: FetchFn,
  log?: Logger,
): Promise<StripeBillingDetails> {
  const r = await stripeGet<StripeCustomer>(
    `customers/${encodeURIComponent(customerId)}?expand[]=invoice_settings.default_payment_method`,
    apiKey,
    doFetch,
  );
  if (!r.ok) {
    log?.error(
      { customerId, status: r.status, body: r.body },
      "Stripe customer lookup failed",
    );
    return emptyDetails(customerId);
  }
  const cust = r.data;
  let last4 =
    cust.invoice_settings?.default_payment_method?.card?.last4 ?? null;
  // Card may be attached but not set as the invoice default — fall back to the
  // customer's first card payment method.
  if (!last4) {
    const pm = await stripeGet<{ data: StripeCard[] }>(
      `customers/${encodeURIComponent(customerId)}/payment_methods?type=card&limit=1`,
      apiKey,
      doFetch,
    );
    if (pm.ok) last4 = pm.data.data?.[0]?.card?.last4 ?? null;
  }
  return {
    stripeId: customerId,
    cardLast4: last4,
    billingEmail: cust.email ?? null,
    // No subscription yet during the trial — start = when the customer/card was
    // created; next billing is unknown until a subscription exists.
    subscriptionStartDate: toDate(cust.created),
    nextBillingDate: null,
  };
}

/* ── Full billing summary (campaign Subscription section + charge history) ── */

export interface StripeChargeRow {
  id: string;
  /** Major units (e.g. dollars), not cents. */
  amount: number;
  currency: string;
  status: string;
  /** YYYY-MM-DD (UTC). */
  date: string | null;
  description: string | null;
}

export interface StripeSubscriptionSummary {
  id: string;
  status: string;
  /** Major units per billing interval, from the first subscription item. */
  monthlyPrice: number | null;
  currency: string | null;
  /** e.g. "month", "year". */
  billingCycle: string | null;
  trialStartDate: string | null;
  trialEndDate: string | null;
  /** Trial over on an active/past_due sub = it converted; the date is trial end. */
  trialConversionDate: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  /** When the cancellation takes/took effect. */
  cancelEffectiveDate: string | null;
  currentPeriodEnd: string | null;
}

export interface StripeBillingSummary {
  stripeCustomerId: string | null;
  billingEmail: string | null;
  cardLast4: string | null;
  subscription: StripeSubscriptionSummary | null;
  charges: StripeChargeRow[];
  /** Latest charge outcome: "succeeded" | "failed" | "pending" | null. */
  paymentStatus: string | null;
  /** True when the latest charge failed or the subscription is past_due/unpaid. */
  hasFailedPayment: boolean;
  lastPaymentDate: string | null;
}

interface StripeSubscriptionFull {
  id: string;
  status: string;
  customer?: string | { id: string } | null;
  items?: {
    data?: Array<{
      price?: {
        unit_amount?: number | null;
        currency?: string | null;
        recurring?: { interval?: string | null } | null;
      } | null;
    }>;
  } | null;
  trial_start?: number | null;
  trial_end?: number | null;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
  cancel_at?: number | null;
  current_period_end?: number | null;
}

interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created?: number | null;
  description?: string | null;
}

function summarizeSubscription(
  sub: StripeSubscriptionFull,
  nowSeconds: number,
): StripeSubscriptionSummary {
  const price = sub.items?.data?.[0]?.price ?? null;
  const trialEnded =
    typeof sub.trial_end === "number" && sub.trial_end < nowSeconds;
  const converted =
    trialEnded && ["active", "past_due", "unpaid"].includes(sub.status);
  return {
    id: sub.id,
    status: sub.status,
    monthlyPrice: price?.unit_amount != null ? price.unit_amount / 100 : null,
    currency: price?.currency ?? null,
    billingCycle: price?.recurring?.interval ?? null,
    trialStartDate: toDate(sub.trial_start),
    trialEndDate: toDate(sub.trial_end),
    trialConversionDate: converted ? toDate(sub.trial_end) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    canceledAt: toDate(sub.canceled_at),
    cancelEffectiveDate: toDate(
      sub.cancel_at ??
        (sub.cancel_at_period_end ? sub.current_period_end : null) ??
        (sub.status === "canceled" ? sub.canceled_at : null),
    ),
    currentPeriodEnd: toDate(sub.current_period_end),
  };
}

/**
 * Everything the campaign page's Subscription section needs, live from Stripe:
 * customer, most-recent subscription, and the charge history. Fail-soft like
 * the details lookup — returns null on any hard failure.
 */
export async function fetchStripeBillingSummary(
  stripeId: string,
  opts: Options = {},
): Promise<StripeBillingSummary | null> {
  const apiKey = opts.apiKey ?? process.env.STRIPE_SECRET_KEY;
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.log;
  if (!apiKey) {
    log?.warn({ stripeId }, "STRIPE_SECRET_KEY not set — no billing summary");
    return null;
  }

  try {
    // Resolve the customer id: direct, or via the subscription.
    let customerId: string | null = null;
    let directSub: StripeSubscriptionFull | null = null;
    if (stripeId.startsWith("cus_")) {
      customerId = stripeId;
    } else if (stripeId.startsWith("sub_")) {
      const r = await stripeGet<StripeSubscriptionFull>(
        `subscriptions/${encodeURIComponent(stripeId)}`,
        apiKey,
        doFetch,
      );
      if (!r.ok) {
        log?.error({ stripeId, status: r.status }, "Stripe sub lookup failed");
        return null;
      }
      directSub = r.data;
      customerId =
        typeof r.data.customer === "string"
          ? r.data.customer
          : (r.data.customer?.id ?? null);
    } else {
      return null;
    }
    if (!customerId) return null;

    const [custR, subsR, chargesR] = await Promise.all([
      stripeGet<StripeCustomer>(
        `customers/${encodeURIComponent(customerId)}?expand[]=invoice_settings.default_payment_method`,
        apiKey,
        doFetch,
      ),
      stripeGet<{ data: StripeSubscriptionFull[] }>(
        `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
        apiKey,
        doFetch,
      ),
      stripeGet<{ data: StripeCharge[] }>(
        `charges?customer=${encodeURIComponent(customerId)}&limit=50`,
        apiKey,
        doFetch,
      ),
    ]);
    if (!custR.ok) {
      log?.error(
        { customerId, status: custR.status },
        "Stripe customer lookup failed",
      );
      return null;
    }

    let cardLast4 =
      custR.data.invoice_settings?.default_payment_method?.card?.last4 ?? null;
    if (!cardLast4) {
      const pm = await stripeGet<{ data: StripeCard[] }>(
        `customers/${encodeURIComponent(customerId)}/payment_methods?type=card&limit=1`,
        apiKey,
        doFetch,
      );
      if (pm.ok) cardLast4 = pm.data.data?.[0]?.card?.last4 ?? null;
    }

    // Most relevant subscription: the one we were pointed at, else newest.
    const subs = subsR.ok ? (subsR.data.data ?? []) : [];
    const sub = directSub ?? subs[0] ?? null;
    const nowSeconds = Math.floor(Date.now() / 1000);

    const charges: StripeChargeRow[] = (
      chargesR.ok ? (chargesR.data.data ?? []) : []
    ).map((ch) => ({
      id: ch.id,
      amount: ch.amount / 100,
      currency: ch.currency,
      status: ch.status,
      date: toDate(ch.created),
      description: ch.description ?? null,
    }));
    const latestCharge = charges[0] ?? null;
    const lastPaid = charges.find((ch) => ch.status === "succeeded") ?? null;

    return {
      stripeCustomerId: customerId,
      billingEmail: custR.data.email ?? null,
      cardLast4,
      subscription: sub ? summarizeSubscription(sub, nowSeconds) : null,
      charges,
      paymentStatus: latestCharge?.status ?? null,
      hasFailedPayment:
        latestCharge?.status === "failed" ||
        (sub != null && ["past_due", "unpaid"].includes(sub.status)),
      lastPaymentDate: lastPaid?.date ?? null,
    };
  } catch (err: unknown) {
    log?.error({ err, stripeId }, "Stripe billing summary threw");
    return null;
  }
}

/**
 * Resolve billing details from a Stripe id. Branches on the id prefix:
 * `cus_` → customer + card, `sub_` → subscription + dates.
 */
export async function fetchStripeBillingDetails(
  stripeId: string,
  opts: Options = {},
): Promise<StripeBillingDetails> {
  const apiKey = opts.apiKey ?? process.env.STRIPE_SECRET_KEY;
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.log;

  if (!apiKey) {
    log?.warn(
      { stripeId },
      "STRIPE_SECRET_KEY not set — skipping Stripe lookup",
    );
    return emptyDetails(stripeId);
  }

  try {
    if (stripeId.startsWith("cus_")) {
      return await fetchCustomer(stripeId, apiKey, doFetch, log);
    }
    if (stripeId.startsWith("sub_")) {
      return await fetchSubscription(stripeId, apiKey, doFetch, log);
    }
    log?.warn(
      { stripeId },
      "Unrecognized Stripe id prefix (expected cus_ or sub_)",
    );
    return emptyDetails(stripeId);
  } catch (err: unknown) {
    log?.error({ err, stripeId }, "Stripe billing lookup threw");
    return emptyDetails(stripeId);
  }
}
