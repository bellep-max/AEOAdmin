import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientAeoPlansTable,
  clientsTable,
  keywordLinksTable,
  keywordsTable,
  promoCodesTable,
} from "@workspace/db/schema";
import { and, eq, asc, inArray, ne, sql } from "drizzle-orm";
import {
  requireSalesAllowed,
  requireEditor,
  requireAdmin,
  requireScopedAdmin,
  requireScopedEditor,
  isChucksLocal,
} from "../middlewares/role-auth";
import {
  assertScopedAccessToClient,
  isPlanAllowedForScope,
  LOCAL_ADMIN_PLAN_TYPES,
} from "../lib/scoped-access";
import {
  scanClientKeywords,
  bucketCountsByPlan,
  type KeywordBuckets,
} from "./portal";
import { fetchStripeBillingSummary } from "../services/stripe-billing";

const router = Router({ mergeParams: true }); // gives access to :clientId from parent

/**
 * GET /api/clients/:clientId/aeo-plans
 * Returns all AEO plans for a client.
 */
router.get("/", requireSalesAllowed, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ error: "Invalid clientId" });
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;

    const businessIdParam = req.query.businessId as string | undefined;
    const businessId = businessIdParam ? parseInt(businessIdParam) : null;

    const plans = await db
      .select()
      .from(clientAeoPlansTable)
      .where(
        businessId != null && !isNaN(businessId)
          ? and(
              eq(clientAeoPlansTable.clientId, clientId),
              eq(clientAeoPlansTable.businessId, businessId),
            )
          : eq(clientAeoPlansTable.clientId, clientId),
      )
      .orderBy(asc(clientAeoPlansTable.createdAt));

    const buckets =
      plans.length > 0
        ? bucketCountsByPlan(
            await scanClientKeywords(clientId, {
              businessId:
                businessId != null && !isNaN(businessId)
                  ? businessId
                  : undefined,
            }),
          )
        : new Map<number, KeywordBuckets>();

    res.json(
      plans.map((p) => {
        const b = buckets.get(p.id) ?? { active: 0, watch: 0, locked: 0 };
        return {
          ...p,
          activeCount: b.active,
          watchCount: b.watch,
          lockedCount: b.locked,
          // back-compat: original "active keyword" count = all active keywords.
          keywordCount: b.active + b.watch,
          monthlyAeoBudget:
            p.monthlyAeoBudget != null ? Number(p.monthlyAeoBudget) : null,
        };
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching client AEO plans");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/clients/:clientId/aeo-plans/:planId
 */
router.get("/:planId", requireSalesAllowed, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    const planId = parseInt(req.params.planId);
    if (isNaN(clientId) || isNaN(planId))
      return res.status(400).json({ error: "Invalid id" });
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;
    const [plan] = await db
      .select()
      .from(clientAeoPlansTable)
      .where(
        and(
          eq(clientAeoPlansTable.clientId, clientId),
          eq(clientAeoPlansTable.id, planId),
        ),
      );
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    // Attach the promo record so the campaign page can render its Promo Code
    // Information card without a second round trip.
    let promo = null;
    if (plan.promoCodeId != null) {
      const [row] = await db
        .select()
        .from(promoCodesTable)
        .where(eq(promoCodesTable.id, plan.promoCodeId));
      promo = row ?? null;
    }
    res.json({
      ...plan,
      promo,
      monthlyAeoBudget:
        plan.monthlyAeoBudget != null ? Number(plan.monthlyAeoBudget) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/clients/:clientId/aeo-plans/:planId/billing
 * Live Stripe billing summary for the campaign's stored subscription/customer
 * ref: subscription status + price + trial dates, and the charge history.
 * Admin/owner only — this is raw billing data.
 */
router.get("/:planId/billing", requireAdmin, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    const planId = parseInt(req.params.planId);
    if (isNaN(clientId) || isNaN(planId))
      return res.status(400).json({ error: "Invalid id" });
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;
    const [plan] = await db
      .select({ subscriptionId: clientAeoPlansTable.subscriptionId })
      .from(clientAeoPlansTable)
      .where(
        and(
          eq(clientAeoPlansTable.clientId, clientId),
          eq(clientAeoPlansTable.id, planId),
        ),
      );
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    if (!plan.subscriptionId)
      return res.json({ hasStripeRef: false, summary: null });
    const summary = await fetchStripeBillingSummary(plan.subscriptionId, {
      log: req.log,
    });
    return res.json({ hasStripeRef: true, summary });
  } catch (err) {
    req.log.error({ err }, "Error fetching plan billing summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/clients/:clientId/aeo-plans
 * Create a new AEO plan for a client.
 */
router.post("/", requireScopedAdmin, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ error: "Invalid clientId" });
    // Scoped role: client must be in slice, and the plan must be an allowed one.
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;

    const body = req.body as Record<string, unknown>;
    if (!body.planType)
      return res.status(400).json({ error: "planType is required" });
    if (
      isChucksLocal(req) &&
      !isPlanAllowedForScope(req, body.planType as string)
    ) {
      return res.status(403).json({
        error: `You can only assign these plans: ${LOCAL_ADMIN_PLAN_TYPES.join(
          ", ",
        )}.`,
      });
    }

    // Reject duplicate campaign under the same client + business + (case-insensitive) name
    const rawName = typeof body.name === "string" ? body.name.trim() : null;
    if (rawName) {
      const businessId =
        body.businessId != null ? Number(body.businessId) : null;
      const [existing] = await db
        .select({
          id: clientAeoPlansTable.id,
          name: clientAeoPlansTable.name,
        })
        .from(clientAeoPlansTable)
        .where(
          and(
            eq(clientAeoPlansTable.clientId, clientId),
            businessId !== null
              ? eq(clientAeoPlansTable.businessId, businessId)
              : sql`${clientAeoPlansTable.businessId} IS NULL`,
            sql`lower(trim(${clientAeoPlansTable.name})) = lower(${rawName})`,
          ),
        )
        .limit(1);
      if (existing) {
        return res.status(409).json({
          error: `A campaign named "${existing.name}" already exists for this business (id ${existing.id}).`,
          conflictId: existing.id,
        });
      }
    }

    const [plan] = await db
      .insert(clientAeoPlansTable)
      .values({
        clientId,
        businessId: body.businessId != null ? Number(body.businessId) : null,
        name: (body.name as string) ?? null,
        businessName: (body.businessName as string) ?? null,
        planType: body.planType as string,
        sampleQuestion1: (body.sampleQuestion1 as string) ?? null,
        sampleQuestion2: (body.sampleQuestion2 as string) ?? null,
        sampleQuestion3: (body.sampleQuestion3 as string) ?? null,
        sampleQuestion4: (body.sampleQuestion4 as string) ?? null,
        sampleQuestion5: (body.sampleQuestion5 as string) ?? null,
        sampleQuestion6: (body.sampleQuestion6 as string) ?? null,
        sampleQuestion7: (body.sampleQuestion7 as string) ?? null,
        sampleQuestion8: (body.sampleQuestion8 as string) ?? null,
        sampleQuestion9: (body.sampleQuestion9 as string) ?? null,
        sampleQuestion10: (body.sampleQuestion10 as string) ?? null,
        currentAnswerPresence: (body.currentAnswerPresence as string) ?? null,
        searchBoostTarget:
          body.searchBoostTarget != null
            ? Number(body.searchBoostTarget)
            : null,
        monthlyAeoBudget:
          body.monthlyAeoBudget != null ? String(body.monthlyAeoBudget) : null,
        schemaImplementor: (body.schemaImplementor as string) ?? null,
        searchAddress: (body.searchAddress as string) ?? null,
        subscriptionId: (body.subscriptionId as string) ?? null,
        subscriptionStartDate: (body.subscriptionStartDate as string) ?? null,
        nextBillingDate: (body.nextBillingDate as string) ?? null,
        cardLast4: (body.cardLast4 as string) ?? null,
        createdBy: (body.createdBy as string) ?? null,
      })
      .returning();

    res.status(201).json({
      ...plan,
      monthlyAeoBudget:
        plan.monthlyAeoBudget != null ? Number(plan.monthlyAeoBudget) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/clients/:clientId/aeo-plans/:planId
 * Update a specific AEO plan.
 */
router.patch("/:planId", requireScopedEditor, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    const planId = parseInt(req.params.planId);
    if (isNaN(clientId) || isNaN(planId))
      return res.status(400).json({ error: "Invalid id" });
    // Scoped role: client must be in slice; plan changes restricted to allowed.
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;

    const body = req.body as Record<string, unknown>;
    if (
      isChucksLocal(req) &&
      "planType" in body &&
      !isPlanAllowedForScope(req, body.planType as string)
    ) {
      return res.status(403).json({
        error: `You can only assign these plans: ${LOCAL_ADMIN_PLAN_TYPES.join(
          ", ",
        )}.`,
      });
    }
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ("businessId" in body)
      update.businessId =
        body.businessId != null ? Number(body.businessId) : null;

    const fields = [
      "name",
      "businessName",
      "planType",
      "sampleQuestion1",
      "sampleQuestion2",
      "sampleQuestion3",
      "sampleQuestion4",
      "sampleQuestion5",
      "sampleQuestion6",
      "sampleQuestion7",
      "sampleQuestion8",
      "sampleQuestion9",
      "sampleQuestion10",
      "currentAnswerPresence",
      "schemaImplementor",
      "searchAddress",
      "subscriptionId",
      "subscriptionStartDate",
      "nextBillingDate",
      "cardLast4",
      "createdBy",
      "cancelReason",
      "canceledAt",
      "trialStartDate",
      "trialEndDate",
      "paidConversionDate",
    ];
    for (const f of fields) {
      if (f in body) update[f] = body[f] ?? null;
    }
    if ("campaignStatus" in body) {
      const cs = String(body.campaignStatus ?? "");
      if (!["active", "paused", "canceled"].includes(cs)) {
        return res.status(400).json({
          error: "campaignStatus must be active, paused, or canceled",
        });
      }
      update.campaignStatus = cs;
      // Stamp/clear the cancellation date with the status flip so the
      // "when was it canceled" datum never depends on the operator remembering.
      if (cs === "canceled" && !("canceledAt" in body)) {
        update.canceledAt = new Date().toISOString().slice(0, 10);
      }
      if (cs !== "canceled") update.canceledAt = null;
    }
    if ("promoCodeId" in body) {
      if (body.promoCodeId == null) {
        update.promoCodeId = null;
      } else {
        const promoId = Number(body.promoCodeId);
        const [promo] = Number.isFinite(promoId)
          ? await db
              .select({ id: promoCodesTable.id })
              .from(promoCodesTable)
              .where(eq(promoCodesTable.id, promoId))
          : [];
        if (!promo) {
          return res.status(400).json({
            error: "promoCodeId does not reference an existing promo code",
          });
        }
        update.promoCodeId = promoId;
      }
    }
    if ("searchBoostTarget" in body)
      update.searchBoostTarget =
        body.searchBoostTarget != null ? Number(body.searchBoostTarget) : null;
    if ("monthlyAeoBudget" in body)
      update.monthlyAeoBudget =
        body.monthlyAeoBudget != null ? String(body.monthlyAeoBudget) : null;

    // Reject rename collisions within the same client + business
    if (typeof update.name === "string" && update.name.trim() !== "") {
      const trimmed = (update.name as string).trim();
      const targetBusinessId =
        "businessId" in update
          ? (update.businessId as number | null)
          : ((
              await db
                .select({ businessId: clientAeoPlansTable.businessId })
                .from(clientAeoPlansTable)
                .where(eq(clientAeoPlansTable.id, planId))
            )[0]?.businessId ?? null);

      const [conflict] = await db
        .select({ id: clientAeoPlansTable.id, name: clientAeoPlansTable.name })
        .from(clientAeoPlansTable)
        .where(
          and(
            eq(clientAeoPlansTable.clientId, clientId),
            targetBusinessId !== null
              ? eq(clientAeoPlansTable.businessId, targetBusinessId)
              : sql`${clientAeoPlansTable.businessId} IS NULL`,
            sql`lower(trim(${clientAeoPlansTable.name})) = lower(${trimmed})`,
            sql`${clientAeoPlansTable.id} <> ${planId}`,
          ),
        )
        .limit(1);
      if (conflict) {
        return res.status(409).json({
          error: `Another campaign named "${conflict.name}" already exists for this business (id ${conflict.id}).`,
          conflictId: conflict.id,
        });
      }
      update.name = trimmed;
    }

    const [updated] = await db
      .update(clientAeoPlansTable)
      .set(update as Partial<typeof clientAeoPlansTable.$inferInsert>)
      // Constrain to the asserted clientId too: a scoped role owns this client,
      // but planId is a global PK — without this a scoped user could patch a
      // campaign belonging to a non-eligible (e.g. free-trial) client.
      .where(
        and(
          eq(clientAeoPlansTable.id, planId),
          eq(clientAeoPlansTable.clientId, clientId),
        ),
      )
      .returning();

    if (!updated) return res.status(404).json({ error: "Plan not found" });
    res.json({
      ...updated,
      monthlyAeoBudget:
        updated.monthlyAeoBudget != null
          ? Number(updated.monthlyAeoBudget)
          : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error updating client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* Stop (or resume) ranking work for every keyword attached to one campaign.
   Mirrors the client-level cascade in routes/clients.ts. */
async function setPlanKeywordsActive(planId: number, active: boolean) {
  await db
    .update(keywordsTable)
    .set({ isActive: active })
    .where(eq(keywordsTable.aeoPlanId, planId));

  const planKwIds = await db
    .select({ id: keywordsTable.id })
    .from(keywordsTable)
    .where(eq(keywordsTable.aeoPlanId, planId));
  if (planKwIds.length > 0) {
    await db
      .update(keywordLinksTable)
      .set({ linkActive: active })
      .where(
        inArray(
          keywordLinksTable.keywordId,
          planKwIds.map((k) => k.id),
        ),
      );
  }
}

/**
 * POST /api/clients/:clientId/aeo-plans/:planId/cancel
 * Cancel a campaign instead of deleting it: flips campaign_status to
 * 'canceled', stamps canceled_at + cancel_reason, and stops ranking work on
 * its keywords. When it was the client's last non-canceled campaign the whole
 * client is archived too, so a fully-cancelled account leaves the active list.
 * All history (sessions, audits, ranking reports) is preserved.
 */
router.post("/:planId/cancel", requireScopedAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    if (isNaN(planId)) return res.status(400).json({ error: "Invalid planId" });
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ error: "Invalid clientId" });
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;

    const reason =
      (req.body as { reason?: string } | undefined)?.reason?.trim() || null;

    const [canceled] = await db
      .update(clientAeoPlansTable)
      .set({
        campaignStatus: "canceled",
        canceledAt: new Date().toISOString().slice(0, 10),
        cancelReason: sql`COALESCE(${reason}, ${clientAeoPlansTable.cancelReason})`,
        updatedAt: new Date(),
      })
      // planId is a global PK — constrain to the asserted clientId so a scoped
      // role can't cancel a campaign on a client outside its slice.
      .where(
        and(
          eq(clientAeoPlansTable.id, planId),
          eq(clientAeoPlansTable.clientId, clientId),
        ),
      )
      .returning();
    if (!canceled) return res.status(404).json({ error: "Plan not found" });

    await setPlanKeywordsActive(planId, false);

    const remaining = await db
      .select({ id: clientAeoPlansTable.id })
      .from(clientAeoPlansTable)
      .where(
        and(
          eq(clientAeoPlansTable.clientId, clientId),
          ne(clientAeoPlansTable.campaignStatus, "canceled"),
        ),
      );

    let clientArchived = false;
    if (remaining.length === 0) {
      await db
        .update(clientsTable)
        .set({
          archivedAt: sql`COALESCE(${clientsTable.archivedAt}, now())`,
          archiveReason: sql`COALESCE(${clientsTable.archiveReason}, ${
            reason ?? "All campaigns canceled"
          })`,
        })
        .where(eq(clientsTable.id, clientId));
      // Catch keywords with no aeo_plan_id, which the per-plan cascade misses.
      await db
        .update(keywordsTable)
        .set({ isActive: false })
        .where(eq(keywordsTable.clientId, clientId));
      clientArchived = true;
    }

    res.json({ success: true, plan: canceled, clientArchived });
  } catch (err) {
    req.log.error({ err }, "Error canceling client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/clients/:clientId/aeo-plans/:planId/restore
 * Inverse of cancel: campaign_status back to 'active', cancellation stamps
 * cleared, keywords re-activated. If the client was archived by the cancel
 * cascade it is un-archived too — otherwise the restored campaign would sit
 * on a client that stays invisible everywhere.
 */
router.post("/:planId/restore", requireScopedAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    if (isNaN(planId)) return res.status(400).json({ error: "Invalid planId" });
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId))
      return res.status(400).json({ error: "Invalid clientId" });
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;

    const [restored] = await db
      .update(clientAeoPlansTable)
      .set({
        campaignStatus: "active",
        canceledAt: null,
        cancelReason: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clientAeoPlansTable.id, planId),
          eq(clientAeoPlansTable.clientId, clientId),
        ),
      )
      .returning();
    if (!restored) return res.status(404).json({ error: "Plan not found" });

    await setPlanKeywordsActive(planId, true);

    const [client] = await db
      .update(clientsTable)
      .set({ archivedAt: null, archiveReason: null, status: "active" })
      .where(eq(clientsTable.id, clientId))
      .returning({ id: clientsTable.id });

    res.json({ success: true, plan: restored, clientRestored: !!client });
  } catch (err) {
    req.log.error({ err }, "Error restoring client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/clients/:clientId/aeo-plans/:planId
 * Hard-delete a plan. No longer reachable from the admin UI — the campaign
 * page cancels instead (POST /:planId/cancel). Kept for scripted purges.
 */
router.delete("/:planId", requireScopedAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    if (isNaN(planId)) return res.status(400).json({ error: "Invalid planId" });
    const clientId = parseInt(req.params.clientId);
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;

    const deleted = await db
      .delete(clientAeoPlansTable)
      // Constrain to the asserted clientId: planId alone is a global PK, so
      // without this a scoped role could delete a campaign on a non-eligible
      // (e.g. free-trial) client.
      .where(
        and(
          eq(clientAeoPlansTable.id, planId),
          eq(clientAeoPlansTable.clientId, clientId),
        ),
      )
      .returning({ id: clientAeoPlansTable.id });
    if (deleted.length === 0)
      return res.status(404).json({ error: "Plan not found" });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
