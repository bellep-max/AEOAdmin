import { Router } from "express";
import { requireExecutorToken } from "../middlewares/executor-auth";
import { assembleContext, type AnalystScope } from "../services/daily-analyst";

const router = Router();

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/daily-context
   Smoke-test endpoint for the daily analyst data layer.
   Returns the 7 datasets the LLM analyst will read from.
   Auth: executor token (no UI exposure yet).
──────────────────────────────────────────────────────────── */
router.get("/daily-context", requireExecutorToken, async (req, res) => {
  try {
    const { date, clientId, businessId, campaignId } = req.query as Record<string, string>;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
    }

    const scope: AnalystScope = {};
    if (clientId   != null) scope.clientId   = Number(clientId);
    if (businessId != null) scope.businessId = Number(businessId);
    if (campaignId != null) scope.campaignId = Number(campaignId);

    if (
      (scope.clientId   != null && Number.isNaN(scope.clientId))   ||
      (scope.businessId != null && Number.isNaN(scope.businessId)) ||
      (scope.campaignId != null && Number.isNaN(scope.campaignId))
    ) {
      return res.status(400).json({ error: "scope ids must be integers" });
    }

    const start = Date.now();
    const context = await assembleContext(date, scope);
    res.json({ ...context, _elapsedMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "Error assembling daily context");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
