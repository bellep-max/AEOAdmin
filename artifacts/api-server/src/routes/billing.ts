/* Billing overview — owner-only. One page answering "who is actually paying?":
 * every campaign holding a REAL Stripe id (cus_/sub_) with its live Stripe
 * state, plus the account's newest charges (which also surfaces payers that
 * were never linked to an admin campaign — legacy clients, funnel tests). */
import { Router } from "express";
import { db } from "@workspace/db";
import { clientsTable, clientAeoPlansTable } from "@workspace/db";
import { eq, or, like, sql } from "drizzle-orm";
import { requireOwner } from "../middlewares/role-auth";
import {
  fetchStripeBillingSummary,
  fetchRecentCharges,
} from "../services/stripe-billing";

import { reconcileTrialConversions } from "../services/trial-conversion";

const router = Router();

/* POST /api/billing/reconcile-trials — run the trial→paid sweep on demand.
   The server also runs it on a timer (see index.ts); this is for when an
   operator has just taken a payment and doesn't want to wait for the tick.
   `?dryRun=1` reports what would change without writing. */
router.post("/reconcile-trials", requireOwner, async (req, res) => {
  try {
    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
    const out = await reconcileTrialConversions({
      apply: !dryRun,
      log: req.log,
    });
    res.json({ dryRun, ...out });
  } catch (err) {
    req.log.error({ err }, "Error reconciling trial conversions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/overview", requireOwner, async (req, res) => {
  try {
    const plans = await db
      .select({
        planId: clientAeoPlansTable.id,
        clientId: clientAeoPlansTable.clientId,
        clientName: clientsTable.businessName,
        clientStatus: clientsTable.status,
        campaignName: clientAeoPlansTable.name,
        planType: clientAeoPlansTable.planType,
        stripeId: clientAeoPlansTable.subscriptionId,
        paidConversionDate: clientAeoPlansTable.paidConversionDate,
        nextBillingDate: clientAeoPlansTable.nextBillingDate,
        campaignStatus: clientAeoPlansTable.campaignStatus,
      })
      .from(clientAeoPlansTable)
      .innerJoin(
        clientsTable,
        eq(clientAeoPlansTable.clientId, clientsTable.id),
      )
      .where(
        or(
          like(clientAeoPlansTable.subscriptionId, "cus_%"),
          like(clientAeoPlansTable.subscriptionId, "sub_%"),
        ),
      )
      .orderBy(sql`${clientAeoPlansTable.id} DESC`);

    const campaigns = await Promise.all(
      plans.map(async (p) => {
        const summary = p.stripeId
          ? await fetchStripeBillingSummary(p.stripeId, { log: req.log })
          : null;
        return {
          ...p,
          billing: summary
            ? {
                billingEmail: summary.billingEmail,
                cardLast4: summary.cardLast4,
                subscriptionStatus: summary.subscription?.status ?? null,
                monthlyPrice: summary.subscription?.monthlyPrice ?? null,
                currentPeriodEnd:
                  summary.subscription?.currentPeriodEnd ?? null,
                paymentStatus: summary.paymentStatus,
                hasFailedPayment: summary.hasFailedPayment,
                lastPaymentDate: summary.lastPaymentDate,
                charges: summary.charges.slice(0, 5),
              }
            : null,
        };
      }),
    );

    const recentCharges = await fetchRecentCharges(100, { log: req.log });

    return res.json({ campaigns, recentCharges });
  } catch (err) {
    req.log.error({ err }, "Error building billing overview");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
