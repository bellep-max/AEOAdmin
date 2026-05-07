/**
 * /api/llm/* — single namespace for everything that calls an LLM.
 *
 * What lives here:
 *   - Variant generation + rotation     (DeepSeek V3)
 *   - Audit-report runner               (DeepSeek R1)
 *   - Prompt-template registry          (read-only mirror for admin UI)
 *   - (later) build-session             (port of executor's prompt_generator.py)
 *   - (later) build-follow-up
 *
 * Why a single namespace: device-agent and any future runner only need to
 * know one URL prefix to get LLM-generated content. No DeepSeek client,
 * no prompt templates, no model picking on the consumer side.
 *
 * Legacy paths (/api/keywords/:id/variants/*, /api/analytics/audit-report/*,
 * /api/prompt-templates) still work — they call the same service functions.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  keywordVariantsTable,
  keywordsTable,
  dailyReportsTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";
import { PROMPT_TEMPLATES } from "../services/prompt-templates";
import { regenerateForKeyword } from "../services/variant-rotation";
import {
  assembleContext,
  runAuditReport,
  type AnalystScope,
} from "../services/daily-analyst";
import { buildSession, type VoiceKey } from "../services/session-prompt-builder";

const router = Router();

const VALID_VOICES: ReadonlyArray<VoiceKey> = ["observer", "researcher", "rec_seeker", "local", "quick_asker"];
const VALID_PLATFORMS = new Set(["chatgpt", "gemini", "perplexity"]);

/* ════════════════════════════════════════════════════════════════════════
   /api/llm/prompt-templates
   ════════════════════════════════════════════════════════════════════════ */
router.get("/prompt-templates", async (_req, res) => {
  res.json({ templates: PROMPT_TEMPLATES });
});

/* ════════════════════════════════════════════════════════════════════════
   /api/llm/variants/*
   ════════════════════════════════════════════════════════════════════════ */

/* GET /api/llm/variants/:keywordId — list variants for one keyword */
router.get("/variants/:keywordId", async (req, res) => {
  try {
    const keywordId = Number(req.params.keywordId);
    if (Number.isNaN(keywordId)) return res.status(400).json({ error: "Invalid keywordId" });

    const includeInactive = req.query.includeInactive === "true";
    const where = includeInactive
      ? eq(keywordVariantsTable.keywordId, keywordId)
      : and(eq(keywordVariantsTable.keywordId, keywordId), eq(keywordVariantsTable.isActive, true));

    const rows = await db
      .select()
      .from(keywordVariantsTable)
      .where(where)
      .orderBy(desc(keywordVariantsTable.generatedAt));
    res.json({ variants: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Error listing variants");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/llm/variants/:keywordId/regenerate — refresh variants for one keyword */
router.post("/variants/:keywordId/regenerate", async (req, res) => {
  try {
    const keywordId = Number(req.params.keywordId);
    if (Number.isNaN(keywordId)) return res.status(400).json({ error: "Invalid keywordId" });

    const body = (req.body ?? {}) as { count?: number };
    const count = body.count != null ? Number(body.count) : undefined;
    if (count != null && (Number.isNaN(count) || count <= 0 || count > 100)) {
      return res.status(400).json({ error: "count must be 1-100" });
    }

    const out = await regenerateForKeyword(keywordId, count);
    res.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Error regenerating variants");
    res.status(500).json({ error: message });
  }
});

/* GET /api/llm/variants/:keywordId/random — pick + bump times_used */
router.get("/variants/:keywordId/random", requireExecutorToken, async (req, res) => {
  try {
    const keywordId = Number(req.params.keywordId);
    if (Number.isNaN(keywordId)) return res.status(400).json({ error: "Invalid keywordId" });

    const [pick] = await db
      .select()
      .from(keywordVariantsTable)
      .where(and(
        eq(keywordVariantsTable.keywordId, keywordId),
        eq(keywordVariantsTable.isActive, true),
      ))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (!pick) return res.status(404).json({ error: "No active variants for keyword" });

    await db.update(keywordVariantsTable)
      .set({
        timesUsed: sql`${keywordVariantsTable.timesUsed} + 1`,
        lastUsedAt: new Date(),
      })
      .where(eq(keywordVariantsTable.id, pick.id));

    res.json({ ...pick, timesUsed: pick.timesUsed + 1 });
  } catch (err) {
    req.log.error({ err }, "Error picking random variant");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* DELETE /api/llm/variants/by-id/:id — admin override delete */
router.delete("/variants/by-id/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [deleted] = await db
      .delete(keywordVariantsTable)
      .where(eq(keywordVariantsTable.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Variant not found" });
    res.json({ ok: true, deleted });
  } catch (err) {
    req.log.error({ err }, "Error deleting variant");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/llm/variants/regenerate-all — weekly cron entry */
router.post("/variants/regenerate-all", requireExecutorToken, async (req, res) => {
  try {
    const body = (req.body ?? {}) as { campaignId?: number; count?: number };
    const campaignId = body.campaignId != null ? Number(body.campaignId) : null;
    const count = body.count != null ? Number(body.count) : undefined;

    const conditions = [eq(keywordsTable.isActive, true)];
    if (campaignId != null) conditions.push(eq(keywordsTable.aeoPlanId, campaignId));

    const keywords = await db
      .select({ id: keywordsTable.id, keywordText: keywordsTable.keywordText })
      .from(keywordsTable)
      .where(and(...conditions));

    const succeeded: number[] = [];
    const failed: { keywordId: number; error: string }[] = [];

    for (const kw of keywords) {
      try {
        await regenerateForKeyword(kw.id, count);
        succeeded.push(kw.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        req.log.error({ keywordId: kw.id, err }, "Variant regen failed");
        failed.push({ keywordId: kw.id, error: message });
      }
    }

    res.json({
      total: keywords.length,
      succeeded: succeeded.length,
      failed: failed.length,
      failures: failed.slice(0, 50),
    });
  } catch (err) {
    req.log.error({ err }, "Error in regenerate-all");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   /api/llm/build-session — single-call session prompt builder
   ════════════════════════════════════════════════════════════════════════ */

/**
 * POST /api/llm/build-session
 *
 * Single call returns everything a runner needs to dispatch one session
 * to a phone: prompt, follow-up, voice, variant_id, backlink decision,
 * business GPS context. Replaces the executor-side prompt_generator.py.
 *
 * Body:
 *   keyword_id (required, int)
 *   platform   (required, one of chatgpt|gemini|perplexity)
 *   voice      (optional, one of the 5 archetypes; auto-picks if absent)
 */
router.post("/build-session", requireExecutorToken, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const keywordId = Number(body.keyword_id ?? body.keywordId);
    if (!Number.isFinite(keywordId) || keywordId <= 0) {
      return res.status(400).json({ error: "keyword_id is required and must be a positive integer" });
    }

    const platformRaw = (body.platform ?? "").toString().toLowerCase();
    if (!VALID_PLATFORMS.has(platformRaw)) {
      return res.status(400).json({ error: `platform must be one of ${[...VALID_PLATFORMS].join(", ")}` });
    }

    const voiceRaw = body.voice;
    let voice: VoiceKey | undefined;
    if (voiceRaw != null && voiceRaw !== "") {
      if (typeof voiceRaw !== "string" || !VALID_VOICES.includes(voiceRaw as VoiceKey)) {
        return res.status(400).json({ error: `voice must be one of ${VALID_VOICES.join(", ")}` });
      }
      voice = voiceRaw as VoiceKey;
    }

    const start = Date.now();
    const out = await buildSession({ keywordId, platform: platformRaw, voice });
    res.json({ ...out, _elapsedMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "Error building session");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   /api/llm/audit-report/* and /api/llm/audit-reports
   ════════════════════════════════════════════════════════════════════════ */

interface ParsedQuery {
  date: string;
  scope: AnalystScope;
  lookbackDays: number | undefined;
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

/* POST /api/llm/audit-report/run — run analyst, persist (or dryRun) */
router.post("/audit-report/run", requireExecutorToken, async (req, res) => {
  try {
    const src = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };
    const parsed = parseQuery(src);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const dryRun = src.dryRun === "true" || (src.dryRun as unknown) === true;
    const result = await runAuditReport({
      reportDate: parsed.date,
      scope: parsed.scope,
      lookbackDays: parsed.lookbackDays,
      dryRun,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error running audit report");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* GET /api/llm/audit-reports — list */
router.get("/audit-reports", async (req, res) => {
  try {
    const { scope: scopeKind, scopeId, from, to, limit = "50" } = req.query as Record<string, string>;
    const conditions = [] as ReturnType<typeof eq>[];
    if (scopeKind) conditions.push(eq(dailyReportsTable.scope, scopeKind));
    if (scopeId && !Number.isNaN(Number(scopeId))) conditions.push(eq(dailyReportsTable.scopeId, Number(scopeId)));
    if (from) conditions.push(sql`${dailyReportsTable.reportDate} >= ${from}` as ReturnType<typeof eq>);
    if (to)   conditions.push(sql`${dailyReportsTable.reportDate} <= ${to}` as ReturnType<typeof eq>);

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const rows = await db
      .select({
        id:           dailyReportsTable.id,
        reportDate:   dailyReportsTable.reportDate,
        scope:        dailyReportsTable.scope,
        scopeId:      dailyReportsTable.scopeId,
        modelUsed:    dailyReportsTable.modelUsed,
        inputSummary: dailyReportsTable.inputSummary,
        generatedAt:  dailyReportsTable.generatedAt,
        durationMs:   dailyReportsTable.durationMs,
        costUsd:      dailyReportsTable.costUsd,
      })
      .from(dailyReportsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(dailyReportsTable.generatedAt))
      .limit(lim);
    res.json({ reports: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Error listing audit reports");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* GET /api/llm/audit-reports/:id — full report including markdown + recs */
router.get("/audit-reports/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db
      .select()
      .from(dailyReportsTable)
      .where(eq(dailyReportsTable.id, id))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Report not found" });
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Error fetching audit report");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* POST /api/llm/audit-context — raw context (no LLM call). Same as legacy
   /api/analytics/audit-context but lives under the LLM namespace because
   it's the input the LLM agent reads from. Useful for prompt iteration. */
router.get("/audit-context", requireExecutorToken, async (req, res) => {
  try {
    const parsed = parseQuery(req.query as Record<string, string>);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const start = Date.now();
    const ctx = await assembleContext(parsed.date, parsed.scope, parsed.lookbackDays);
    res.json({
      reportDate:      ctx.reportDate,
      scope:           ctx.scope,
      lookbackDays:    ctx.lookbackDays,
      rankChanges:     ctx.rankChanges,
      rankHistory:     ctx.rankHistory,
      similarityFlags: ctx.similarityFlags,
      gmbMismatches:   ctx.gmbMismatches,
      windowActivity:  ctx.windowActivity,
      movementCohort:  ctx.movementCohort,
      inputSummary:    ctx.inputSummary,
      _elapsedMs:      Date.now() - start,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching audit context");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
