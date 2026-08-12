/**
 * Self-serve portal checkout: create an incomplete Stripe subscription whose
 * first invoice is paid on the frontend via Stripe Elements (PaymentElement).
 *
 * Flow:
 *   1. POST /portal/checkout/subscription → this module creates a Customer and
 *      a Subscription (payment_behavior=default_incomplete) with an inline
 *      monthly price, and returns the payment intent's client_secret plus the
 *      account's publishable key.
 *   2. The portal confirms the payment with Stripe.js. On success the
 *      subscription auto-activates and the card is saved as the default
 *      payment method for renewals.
 *   3. The portal then creates the campaign row carrying the subscription id,
 *      so the existing billing summary endpoints show live Stripe state.
 *
 * Plain fetch to Stripe's REST API — same no-SDK style as stripe-billing.ts.
 * The account (and therefore the key) is chosen per plan type by the caller
 * via lib/stripe-accounts.ts.
 */

interface Logger {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const STRIPE_API = "https://api.stripe.com/v1";

async function stripePost<T>(
  path: string,
  apiKey: string,
  form: Record<string, string>,
  idempotencyKey?: string,
): Promise<
  { ok: true; data: T } | { ok: false; status: number; body: string }
> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const resp = await fetch(`${STRIPE_API}/${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(form).toString(),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, body: body.slice(0, 400) };
  }
  return { ok: true, data: (await resp.json()) as T };
}

/** Slug a plan type into a stable Stripe product id ("portal-aeo-seo-local-plan"). */
function productIdFor(planType: string): string {
  return `portal-${planType
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

/** Find-or-create the plan type's Product. Deterministic id makes this
 *  idempotent: the create either succeeds or 409s with resource_already_exists,
 *  and both paths yield the same id. (Subscriptions' price_data requires a
 *  product id — inline product_data is Checkout-Sessions-only.) */
async function ensureProduct(
  apiKey: string,
  planType: string,
  log?: Logger,
): Promise<string | null> {
  const id = productIdFor(planType);
  const created = await stripePost<{ id: string }>("products", apiKey, {
    id,
    name: planType,
  });
  if (created.ok) return created.data.id;
  if (created.body.includes("resource_already_exists")) return id;
  log?.error(
    { status: created.status, body: created.body },
    "Stripe checkout: product create failed",
  );
  return null;
}

export interface CheckoutSubscription {
  ok: true;
  subscriptionId: string;
  customerId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
}

export interface CheckoutFailure {
  ok: false;
  reason: string;
}

interface SubscriptionResponse {
  id: string;
  status?: string;
  latest_invoice?: {
    payment_intent?: { client_secret?: string | null } | null;
    /** Newer API versions expose the secret here instead. */
    confirmation_secret?: { client_secret?: string | null } | null;
  } | null;
}

/**
 * Create the customer + incomplete subscription for a portal checkout.
 * Returns the client secret the frontend needs to collect payment.
 */
export async function createCheckoutSubscription(opts: {
  apiKey: string;
  planType: string;
  campaignName: string;
  amountCents: number;
  customerEmail: string | null;
  customerName: string | null;
  clientId: number;
  log?: Logger;
}): Promise<CheckoutSubscription | CheckoutFailure> {
  const { apiKey, log } = opts;
  try {
    const customerForm: Record<string, string> = {
      "metadata[portal_client_id]": String(opts.clientId),
      "metadata[source]": "portal-self-serve",
    };
    if (opts.customerEmail) customerForm.email = opts.customerEmail;
    if (opts.customerName) customerForm.name = opts.customerName;
    const customer = await stripePost<{ id: string }>(
      "customers",
      apiKey,
      customerForm,
    );
    if (!customer.ok) {
      log?.error(
        { status: customer.status, body: customer.body },
        "Stripe checkout: customer create failed",
      );
      return { ok: false, reason: "Could not start checkout with Stripe." };
    }

    const productId = await ensureProduct(apiKey, opts.planType, log);
    if (!productId) {
      return { ok: false, reason: "Could not start checkout with Stripe." };
    }

    const subForm = (expandPath: string): Record<string, string> => ({
      customer: customer.data.id,
      "items[0][price_data][currency]": "usd",
      "items[0][price_data][unit_amount]": String(opts.amountCents),
      "items[0][price_data][recurring][interval]": "month",
      "items[0][price_data][product]": productId,
      payment_behavior: "default_incomplete",
      "payment_settings[save_default_payment_method]": "on_subscription",
      "metadata[portal_client_id]": String(opts.clientId),
      "metadata[campaign_name]": opts.campaignName,
      "expand[]": expandPath,
    });
    /* API versions ≥2025 expose the payable secret as
       latest_invoice.confirmation_secret; older versions as
       latest_invoice.payment_intent. Try modern first, retry legacy if the
       expand path itself is rejected. */
    let sub = await stripePost<SubscriptionResponse>(
      "subscriptions",
      apiKey,
      subForm("latest_invoice.confirmation_secret"),
      `portal-checkout-${opts.clientId}-${Date.now()}`,
    );
    if (!sub.ok && /expand|unknown parameter/i.test(sub.body)) {
      sub = await stripePost<SubscriptionResponse>(
        "subscriptions",
        apiKey,
        subForm("latest_invoice.payment_intent"),
        `portal-checkout-${opts.clientId}-${Date.now()}-legacy`,
      );
    }
    if (!sub.ok) {
      log?.error(
        { status: sub.status, body: sub.body },
        "Stripe checkout: subscription create failed",
      );
      return { ok: false, reason: "Could not start checkout with Stripe." };
    }

    const clientSecret =
      sub.data.latest_invoice?.payment_intent?.client_secret ??
      sub.data.latest_invoice?.confirmation_secret?.client_secret ??
      null;
    if (!clientSecret) {
      log?.error(
        { subscriptionId: sub.data.id, status: sub.data.status },
        "Stripe checkout: subscription created but no client secret",
      );
      return { ok: false, reason: "Stripe did not return a payment secret." };
    }

    return {
      ok: true,
      subscriptionId: sub.data.id,
      customerId: customer.data.id,
      clientSecret,
      amountCents: opts.amountCents,
      currency: "usd",
    };
  } catch (err: unknown) {
    log?.error({ err }, "Stripe checkout threw");
    return { ok: false, reason: "Stripe request failed — try again shortly." };
  }
}
