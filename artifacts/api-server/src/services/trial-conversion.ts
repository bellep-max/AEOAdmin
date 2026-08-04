/**
 * Trial → paid reconciliation.
 *
 * A campaign leaves "Free Trial Plans" the moment Stripe says the customer is
 * actually paying — a succeeded charge, or a live subscription. Sending a proof
 * email already attempts this (see convertFreeTrialAfterProof in routes/
 * sales-email.ts), but that path needs a `cus_` stored on the campaign at send
 * time; when the field holds a placeholder like "ID-4343" the send silently
 * skips and the client keeps showing as a free trial after being billed.
 *
 * This pass closes that gap by reading Stripe instead of trusting our own
 * field: it resolves the customer from the stored id OR the client's account
 * email, and converts on evidence of payment. It NEVER creates a subscription
 * or charges anyone — it only reflects what Stripe already did.
 */
import { and, eq, ilike } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { clientAeoPlansTable, clientsTable } from "@workspace/db/schema";

const STRIPE_API = "https://api.stripe.com/v1";
/** Subscription states that mean "this customer is on a paid plan". */
const LIVE_SUB_STATUSES = ["active", "past_due", "unpaid"];

export interface TrialConversionRow {
  planId: number;
  clientId: number;
  clientName: string | null;
  customerId: string;
  subscriptionId: string | null;
  /** What convinced us they are paying. */
  evidence: string;
  paidOn: string;
  amount: number | null;
}

export interface ReconcileResult {
  scanned: number;
  converted: TrialConversionRow[];
  skipped: Array<{ planId: number; clientName: string | null; reason: string }>;
}

interface StripeSub {
  id: string;
  status: string;
  start_date?: number | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> };
}

interface StripeCharge {
  id: string;
  paid?: boolean;
  status?: string;
  amount?: number | null;
  created?: number | null;
  refunded?: boolean;
}

const ymd = (unixSeconds: number | null | undefined): string | null =>
  unixSeconds == null
    ? null
    : new Date(unixSeconds * 1000).toISOString().slice(0, 10);

async function stripeGet<T>(path: string, apiKey: string): Promise<T | null> {
  const resp = await fetch(`${STRIPE_API}/${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) return null;
  return (await resp.json()) as T;
}

/** The client record carries its own trial labels (plan badge + account-type
 *  chip). Flip them with the campaign, per field, so custom values on already
 *  converted clients are never clobbered. */
async function clearClientTrialLabels(clientId: number): Promise<void> {
  await db
    .update(clientsTable)
    .set({ planName: "Signal AEO Plan" })
    .where(
      and(
        eq(clientsTable.id, clientId),
        ilike(clientsTable.planName, "%free trial%"),
      ),
    );
  await db
    .update(clientsTable)
    .set({ accountType: "Retail" })
    .where(
      and(
        eq(clientsTable.id, clientId),
        eq(clientsTable.accountType, "Free Trial"),
      ),
    );
}

/**
 * Scan every free-trial campaign and convert the ones Stripe shows as paying.
 *
 * @param opts.apply  false runs read-only and reports what it would do.
 * @param opts.limit  cap on campaigns inspected per pass (Stripe rate limits).
 */
export async function reconcileTrialConversions(
  opts: {
    apply?: boolean;
    limit?: number;
    apiKey?: string;
    log?: {
      info: (o: unknown, m?: string) => void;
      error: (o: unknown, m?: string) => void;
    };
  } = {},
): Promise<ReconcileResult> {
  const apply = opts.apply !== false;
  const limit = opts.limit ?? 50;
  const apiKey = opts.apiKey ?? process.env.STRIPE_SECRET_KEY;
  const result: ReconcileResult = { scanned: 0, converted: [], skipped: [] };
  if (!apiKey) {
    result.skipped.push({
      planId: 0,
      clientName: null,
      reason: "STRIPE_SECRET_KEY not configured",
    });
    return result;
  }

  const { rows } = await pool.query<{
    plan_id: number;
    client_id: number;
    business_name: string | null;
    account_email: string | null;
    subscription_id: string | null;
  }>(
    /* Dead work stays dead: a cancelled campaign, an archived client, or an
       entity switched to 'inactive' is out of the funnel and must never be
       resurrected onto a paid plan by this sweep — not even if an old charge
       still sits on the Stripe customer. */
    `SELECT p.id AS plan_id, p.client_id, cl.business_name, cl.account_email,
            p.subscription_id
       FROM client_aeo_plans p
       JOIN clients cl ON cl.id = p.client_id
       LEFT JOIN businesses b ON b.id = p.business_id
      WHERE p.plan_type = 'Free Trial Plans'
        AND p.paid_conversion_date IS NULL
        AND p.campaign_status <> 'canceled'
        AND cl.archived_at IS NULL
        AND COALESCE(cl.status, 'active') <> 'inactive'
        AND COALESCE(b.status::text, 'active') <> 'inactive'
      ORDER BY p.id DESC
      LIMIT $1`,
    [limit],
  );
  result.scanned = rows.length;

  for (const row of rows) {
    const stored = row.subscription_id?.trim() ?? "";
    let customerId = stored.startsWith("cus_") ? stored : "";

    // A stored sub_ resolves to its customer; anything else (placeholders like
    // "ID-4343") is ignored in favour of an email lookup.
    if (!customerId && stored.startsWith("sub_")) {
      const sub = await stripeGet<{ customer?: string }>(
        `subscriptions/${encodeURIComponent(stored)}`,
        apiKey,
      );
      customerId = sub?.customer ?? "";
    }
    if (!customerId && row.account_email) {
      const found = await stripeGet<{ data?: Array<{ id: string }> }>(
        `customers/search?query=${encodeURIComponent(
          `email:'${row.account_email}'`,
        )}&limit=1`,
        apiKey,
      );
      customerId = found?.data?.[0]?.id ?? "";
    }
    if (!customerId) {
      result.skipped.push({
        planId: row.plan_id,
        clientName: row.business_name,
        reason: "no Stripe customer found (no cus_ stored, no email match)",
      });
      continue;
    }

    const subs = await stripeGet<{ data?: StripeSub[] }>(
      `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
      apiKey,
    );
    const liveSub = subs?.data?.find((s) =>
      LIVE_SUB_STATUSES.includes(s.status),
    );

    const charges = await stripeGet<{ data?: StripeCharge[] }>(
      `charges?customer=${encodeURIComponent(customerId)}&limit=10`,
      apiKey,
    );
    const paidCharge = charges?.data?.find(
      (c) => c.paid && c.status === "succeeded" && !c.refunded,
    );

    if (!liveSub && !paidCharge) {
      result.skipped.push({
        planId: row.plan_id,
        clientName: row.business_name,
        reason: "no paid charge and no live subscription — still a trial",
      });
      continue;
    }

    const paidOn =
      ymd(paidCharge?.created) ??
      ymd(liveSub?.start_date) ??
      new Date().toISOString().slice(0, 10);
    const nextBilling =
      ymd(liveSub?.items?.data?.[0]?.current_period_end) ??
      ymd(liveSub?.current_period_end);

    const conversion: TrialConversionRow = {
      planId: row.plan_id,
      clientId: row.client_id,
      clientName: row.business_name,
      customerId,
      subscriptionId: liveSub?.id ?? null,
      evidence: paidCharge
        ? `charge ${paidCharge.id} succeeded`
        : `subscription ${liveSub!.id} is ${liveSub!.status}`,
      paidOn,
      amount: paidCharge?.amount != null ? paidCharge.amount / 100 : null,
    };

    if (apply) {
      await db
        .update(clientAeoPlansTable)
        .set({
          planType: "Signal AEO Plan",
          // Keep the customer id when there is no subscription yet (one-off
          // charge) — never overwrite a real reference with a placeholder.
          subscriptionId:
            liveSub?.id ?? (stored.startsWith("cus_") ? stored : customerId),
          subscriptionStartDate: ymd(liveSub?.start_date) ?? paidOn,
          nextBillingDate: nextBilling,
          trialEndDate: paidOn,
          paidConversionDate: paidOn,
          updatedAt: new Date(),
        })
        .where(eq(clientAeoPlansTable.id, row.plan_id));
      await clearClientTrialLabels(row.client_id);
      opts.log?.info(
        { planId: row.plan_id, customerId, evidence: conversion.evidence },
        "Trial converted to paid from Stripe evidence",
      );
    }
    result.converted.push(conversion);
  }

  return result;
}
