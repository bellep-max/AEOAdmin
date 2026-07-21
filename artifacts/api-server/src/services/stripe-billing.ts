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
