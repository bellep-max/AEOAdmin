import { Router } from "express";
import { db } from "@workspace/db";
import { clientAeoPlansTable, insertClientAeoPlanSchema } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { ok, created, noContent, badRequest, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router({ mergeParams: true }); // gives access to :clientId from parent

/**
 * GET /api/clients/:clientId/aeo-plans
 * Returns all AEO plans for a client.
 */
router.get("/", async (req, res) => {
  try {
    const clientId = parseInt((req.params as Record<string, string>).clientId);
    if (isNaN(clientId)) return badRequest(res, "Invalid clientId");

    const plans = await db
      .select()
      .from(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.clientId, clientId))
      .orderBy(asc(clientAeoPlansTable.createdAt));

    ok(res, plans.map((p) => ({ ...p, monthlyAeoBudget: p.monthlyAeoBudget != null ? Number(p.monthlyAeoBudget) : null })));
  } catch (err) {
    req.log.error({ err }, "Error fetching client AEO plans");
    serverError(res);
  }
});

/**
 * POST /api/clients/:clientId/aeo-plans
 * Create a new AEO plan for a client.
 */
router.post("/", async (req, res) => {
  try {
    const clientId = parseInt((req.params as Record<string, string>).clientId);
    if (isNaN(clientId)) return badRequest(res, "Invalid clientId");

    const data = validateBody(req, res, insertClientAeoPlanSchema);
    if (!data) return;

    const [plan] = await db
      .insert(clientAeoPlansTable)
      .values({
        ...data,
        clientId,
        monthlyAeoBudget: data.monthlyAeoBudget != null ? String(data.monthlyAeoBudget) : null,
      })
      .returning();

    created(res, { ...plan, monthlyAeoBudget: plan.monthlyAeoBudget != null ? Number(plan.monthlyAeoBudget) : null });
  } catch (err) {
    req.log.error({ err }, "Error creating client AEO plan");
    serverError(res);
  }
});

/**
 * PATCH /api/clients/:clientId/aeo-plans/:planId
 * Update a specific AEO plan.
 */
router.patch("/:planId", async (req, res) => {
  try {
    const clientId = parseInt((req.params as Record<string, string>).clientId);
    const planId   = parseInt(req.params.planId);
    if (isNaN(clientId) || isNaN(planId)) return badRequest(res, "Invalid id");

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

    if (!updated) return notFound(res, "Plan not found");
    ok(res, { ...updated, monthlyAeoBudget: updated.monthlyAeoBudget != null ? Number(updated.monthlyAeoBudget) : null });
  } catch (err) {
    req.log.error({ err }, "Error updating client AEO plan");
    serverError(res);
  }
});

/**
 * DELETE /api/clients/:clientId/aeo-plans/:planId
 * Delete a specific AEO plan.
 */
router.delete("/:planId", async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    if (isNaN(planId)) return badRequest(res, "Invalid planId");

    await db.delete(clientAeoPlansTable).where(eq(clientAeoPlansTable.id, planId));
    noContent(res);
  } catch (err) {
    req.log.error({ err }, "Error deleting client AEO plan");
    serverError(res);
  }
});

export default router;
