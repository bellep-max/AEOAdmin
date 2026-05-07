import { Router } from "express";
import { requireExecutorToken } from "../middlewares/executor-auth";
import { assembleContext, type AnalystScope, type AnalystContext } from "../services/daily-analyst";

const router = Router();

interface ParsedQuery {
  date: string;
  scope: AnalystScope;
  lookbackDays: number | undefined;
  error?: string;
}

function parseQuery(q: Record<string, string>): ParsedQuery | { error: string } {
  const { date, clientId, businessId, campaignId, lookbackDays } = q;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "date query param required (YYYY-MM-DD)" };
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
    return { error: "scope ids must be integers" };
  }
  let lb: number | undefined;
  if (lookbackDays != null) {
    lb = Number(lookbackDays);
    if (!Number.isFinite(lb) || lb < 1 || lb > 90) {
      return { error: "lookbackDays must be 1-90" };
    }
  }
  return { date, scope, lookbackDays: lb };
}

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/daily-context
   Combined context (legacy, kept for backward compat). Returns
   ALL 9 datasets — both session and audit. Prefer the split
   endpoints below for new work.
──────────────────────────────────────────────────────────── */
router.get("/daily-context", requireExecutorToken, async (req, res) => {
  try {
    const parsed = parseQuery(req.query as Record<string, string>);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const start = Date.now();
    const context = await assembleContext(parsed.date, parsed.scope, parsed.lookbackDays);
    res.json({ ...context, _elapsedMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "Error assembling daily context");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/session-context
   Subset of the analyst context relevant to the DAILY session-ops
   report. Pulls only datasets that update every day:
     sessionSummary, timeOfDay, platformSkew.
──────────────────────────────────────────────────────────── */
router.get("/session-context", requireExecutorToken, async (req, res) => {
  try {
    const parsed = parseQuery(req.query as Record<string, string>);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const start = Date.now();
    const ctx = await assembleContext(parsed.date, parsed.scope, parsed.lookbackDays);
    const sessionContext: Pick<
      AnalystContext,
      "reportDate" | "scope" | "sessionSummary" | "timeOfDay" | "platformSkew"
    > & { inputSummary: { sessionCount: number } } = {
      reportDate:     ctx.reportDate,
      scope:          ctx.scope,
      sessionSummary: ctx.sessionSummary,
      timeOfDay:      ctx.timeOfDay,
      platformSkew:   ctx.platformSkew,
      inputSummary:   { sessionCount: ctx.inputSummary.sessionCount },
    };
    res.json({ ...sessionContext, _elapsedMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "Error assembling session context");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/analytics/audit-context
   Subset of the analyst context relevant to the BI-WEEKLY
   ranking/audit report. Pulls only rank-related datasets:
     rankChanges, rankHistory, similarityFlags, gmbMismatches,
     windowActivity, movementCohort.
──────────────────────────────────────────────────────────── */
router.get("/audit-context", requireExecutorToken, async (req, res) => {
  try {
    const parsed = parseQuery(req.query as Record<string, string>);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const start = Date.now();
    const ctx = await assembleContext(parsed.date, parsed.scope, parsed.lookbackDays);
    const auditContext: Pick<
      AnalystContext,
      "reportDate" | "scope" | "lookbackDays" | "rankChanges" | "rankHistory"
        | "similarityFlags" | "gmbMismatches" | "windowActivity" | "movementCohort"
    > & {
      inputSummary: {
        declineCount: number;
        improvementCount: number;
        similarPairs: number;
        gmbMismatches: number;
        windowSessionCount: number;
      };
    } = {
      reportDate:      ctx.reportDate,
      scope:           ctx.scope,
      lookbackDays:    ctx.lookbackDays,
      rankChanges:     ctx.rankChanges,
      rankHistory:     ctx.rankHistory,
      similarityFlags: ctx.similarityFlags,
      gmbMismatches:   ctx.gmbMismatches,
      windowActivity:  ctx.windowActivity,
      movementCohort:  ctx.movementCohort,
      inputSummary: {
        declineCount:       ctx.inputSummary.declineCount,
        improvementCount:   ctx.inputSummary.improvementCount,
        similarPairs:       ctx.inputSummary.similarPairs,
        gmbMismatches:      ctx.inputSummary.gmbMismatches,
        windowSessionCount: ctx.inputSummary.windowSessionCount,
      },
    };
    res.json({ ...auditContext, _elapsedMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "Error assembling audit context");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
