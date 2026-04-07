import { Router } from "express";
import { db } from "@workspace/db";
import { clientAeoPlansTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";

const router = Router({ mergeParams: true }); // gives access to :clientId from parent

/**
 * GET /api/clients/:clientId/aeo-plans
 * Returns all AEO plans for a client.
 */
router.get("/", async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId)) return res.status(400).json({ error: "Invalid clientId" });

    const plans = await db
      .select()
      .from(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.clientId, clientId))
      .orderBy(asc(clientAeoPlansTable.createdAt));

    res.json(plans.map((p) => ({ ...p, monthlyAeoBudget: p.monthlyAeoBudget != null ? Number(p.monthlyAeoBudget) : null })));
  } catch (err) {
    req.log.error({ err }, "Error fetching client AEO plans");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/clients/:clientId/aeo-plans
 * Create a new AEO plan for a client.
 */
router.post("/", async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId)) return res.status(400).json({ error: "Invalid clientId" });

    const body = req.body as Record<string, unknown>;
    if (!body.planType) return res.status(400).json({ error: "planType is required" });

    const [plan] = await db
      .insert(clientAeoPlansTable)
      .values({
        clientId,
        businessName:          (body.businessName          as string)  ?? null,
        planType:              body.planType               as string,
        serviceCategory:       (body.serviceCategory       as string)  ?? null,
        targetCityRadius:      (body.targetCityRadius      as string)  ?? null,
        sampleQuestion1:       (body.sampleQuestion1       as string)  ?? null,
        sampleQuestion2:       (body.sampleQuestion2       as string)  ?? null,
        sampleQuestion3:       (body.sampleQuestion3       as string)  ?? null,
        sampleQuestion4:       (body.sampleQuestion4       as string)  ?? null,
        sampleQuestion5:       (body.sampleQuestion5       as string)  ?? null,
        sampleQuestion6:       (body.sampleQuestion6       as string)  ?? null,
        sampleQuestion7:       (body.sampleQuestion7       as string)  ?? null,
        sampleQuestion8:       (body.sampleQuestion8       as string)  ?? null,
        sampleQuestion9:       (body.sampleQuestion9       as string)  ?? null,
        sampleQuestion10:      (body.sampleQuestion10      as string)  ?? null,
        currentAnswerPresence: (body.currentAnswerPresence as string)  ?? null,
        searchBoostTarget:     body.searchBoostTarget != null ? Number(body.searchBoostTarget) : null,
        monthlyAeoBudget:      body.monthlyAeoBudget  != null ? String(body.monthlyAeoBudget)  : null,
        schemaImplementor:     (body.schemaImplementor     as string)  ?? null,
      })
      .returning();

    res.status(201).json({ ...plan, monthlyAeoBudget: plan.monthlyAeoBudget != null ? Number(plan.monthlyAeoBudget) : null });
  } catch (err) {
    req.log.error({ err }, "Error creating client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/clients/:clientId/aeo-plans/:planId
 * Update a specific AEO plan.
 */
router.patch("/:planId", async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    const planId   = parseInt(req.params.planId);
    if (isNaN(clientId) || isNaN(planId)) return res.status(400).json({ error: "Invalid id" });

    const body = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };

    const fields = [
      "businessName", "planType", "serviceCategory", "targetCityRadius",
      "sampleQuestion1", "sampleQuestion2", "sampleQuestion3", "sampleQuestion4",
      "sampleQuestion5", "sampleQuestion6", "sampleQuestion7", "sampleQuestion8",
      "sampleQuestion9", "sampleQuestion10", "currentAnswerPresence",
      "schemaImplementor",
    ];
    for (const f of fields) {
      if (f in body) update[f] = body[f] ?? null;
    }
    if ("searchBoostTarget" in body) update.searchBoostTarget = body.searchBoostTarget != null ? Number(body.searchBoostTarget) : null;
    if ("monthlyAeoBudget"  in body) update.monthlyAeoBudget  = body.monthlyAeoBudget  != null ? String(body.monthlyAeoBudget)  : null;

    const [updated] = await db
      .update(clientAeoPlansTable)
      .set(update as Partial<typeof clientAeoPlansTable.$inferInsert>)
      .where(eq(clientAeoPlansTable.id, planId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Plan not found" });
    res.json({ ...updated, monthlyAeoBudget: updated.monthlyAeoBudget != null ? Number(updated.monthlyAeoBudget) : null });
  } catch (err) {
    req.log.error({ err }, "Error updating client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/clients/:clientId/aeo-plans/:planId
 * Delete a specific AEO plan.
 */
router.delete("/:planId", async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    if (isNaN(planId)) return res.status(400).json({ error: "Invalid planId" });

    await db.delete(clientAeoPlansTable).where(eq(clientAeoPlansTable.id, planId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting client AEO plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
