/**
 * Plan-type → Stripe account routing.
 *
 * The company runs SEPARATE Stripe accounts per product line:
 *   - "Signal AEO Plan"    → the owner/Mary account
 *   - "AEO SEO Local Plan" → Chuck's account
 *
 * Every Stripe call made on behalf of a plan must use that plan's account
 * keys. This module is the single source of truth for that mapping; keys are
 * env-only and never hardcoded:
 *
 *   STRIPE_SECRET_KEY_SIGNAL / STRIPE_PUBLISHABLE_KEY_SIGNAL
 *   STRIPE_SECRET_KEY_LOCAL  / STRIPE_PUBLISHABLE_KEY_LOCAL
 *   STRIPE_SECRET_KEY        / STRIPE_PUBLISHABLE_KEY        (fallback for both)
 *
 * The generic fallback keeps today's single-account deployments working
 * untouched; set the specific vars as each account's keys come online.
 */

export interface StripeAccount {
  /** Which env pair this plan resolved to — for logs, never sent to clients. */
  account: "signal" | "local" | "fallback";
  secretKey: string | null;
  publishableKey: string | null;
  /** Monthly price in cents charged at self-serve checkout. */
  monthlyPriceCents: number;
}

const SIGNAL_PLAN = "Signal AEO Plan";
const LOCAL_PLAN = "AEO SEO Local Plan";

/** Self-serve checkout price per plan type (cents/month). Keep in sync with
 *  the portal's plan-catalog.ts until prices move into Stripe Price objects. */
const PLAN_PRICE_CENTS: Record<string, number> = {
  [SIGNAL_PLAN]: 29900,
  [LOCAL_PLAN]: 29900,
};

const env = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};

export function isKnownPlanType(planType: string): boolean {
  return planType === SIGNAL_PLAN || planType === LOCAL_PLAN;
}

/** Resolve the Stripe account for a plan type. Unknown plan types resolve to
 *  the fallback pair so reads (billing summaries) still work for legacy rows. */
export function resolveStripeAccount(planType: string | null): StripeAccount {
  if (planType === SIGNAL_PLAN) {
    return {
      account: env("STRIPE_SECRET_KEY_SIGNAL") ? "signal" : "fallback",
      secretKey: env("STRIPE_SECRET_KEY_SIGNAL") ?? env("STRIPE_SECRET_KEY"),
      publishableKey:
        env("STRIPE_PUBLISHABLE_KEY_SIGNAL") ?? env("STRIPE_PUBLISHABLE_KEY"),
      monthlyPriceCents: PLAN_PRICE_CENTS[SIGNAL_PLAN],
    };
  }
  if (planType === LOCAL_PLAN) {
    return {
      account: env("STRIPE_SECRET_KEY_LOCAL") ? "local" : "fallback",
      secretKey: env("STRIPE_SECRET_KEY_LOCAL") ?? env("STRIPE_SECRET_KEY"),
      publishableKey:
        env("STRIPE_PUBLISHABLE_KEY_LOCAL") ?? env("STRIPE_PUBLISHABLE_KEY"),
      monthlyPriceCents: PLAN_PRICE_CENTS[LOCAL_PLAN],
    };
  }
  return {
    account: "fallback",
    secretKey: env("STRIPE_SECRET_KEY"),
    publishableKey: env("STRIPE_PUBLISHABLE_KEY"),
    monthlyPriceCents: PLAN_PRICE_CENTS[LOCAL_PLAN],
  };
}
