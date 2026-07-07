import { Router } from "express";
import { db } from "@workspace/db";
import { clientAeoPlansTable } from "@workspace/db/schema";
import { and, eq, asc, sql } from "drizzle-orm";
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
    res.json({
      ...plan,
      monthlyAeoBudget:
        plan.monthlyAeoBudget != null ? Number(plan.monthlyAeoBudget) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching AEO plan");
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
    ];
    for (const f of fields) {
      if (f in body) update[f] = body[f] ?? null;
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
      .where(eq(clientAeoPlansTable.id, planId))
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

/**
 * DELETE /api/clients/:clientId/aeo-plans/:planId
 * Delete a specific AEO plan.
 */
router.delete("/:planId", requireScopedAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    if (isNaN(planId)) return res.status(400).json({ error: "Invalid planId" });
    const clientId = parseInt(req.params.clientId);
    if (!(await assertScopedAccessToClient(req, res, clientId))) return;

    await db
      .delete(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.id, planId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
