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
  clientsTable,
  businessesTable,
  clientAeoPlansTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";
import {
  requireOwner,
  requireExecutorOrOwner,
  requireRoles,
} from "../middlewares/role-auth";
import { requireSession } from "../middlewares/session-auth";
import { PROMPT_TEMPLATES } from "../services/prompt-templates";
import { regenerateForKeyword } from "../services/variant-rotation";
import {
  assembleContext,
  runAuditReport,
  type AnalystScope,
} from "../services/daily-analyst";
import {
  buildSession,
  buildSessionStatic,
  type VoiceKey,
} from "../services/session-prompt-builder";
import {
  buildAuditPrompt,
  buildAuditPromptStatic,
} from "../services/audit-prompt-builder";

const router = Router();

const VALID_VOICES: ReadonlyArray<VoiceKey> = [
  "observer",
  "researcher",
  "rec_seeker",
  "local",
  "quick_asker",
];
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

/* GET /api/llm/variants-overview — one row per active keyword with
   variant count and last-generated time. Powers the admin variants page. */
router.get("/variants-overview", requireOwner, async (req, res) => {
  try {
    const rows = await db
      .select({
        keywordId: keywordsTable.id,
        keywordText: keywordsTable.keywordText,
        clientId: keywordsTable.clientId,
        clientName: clientsTable.businessName,
        businessId: keywordsTable.businessId,
        businessName: businessesTable.name,
        aeoPlanId: keywordsTable.aeoPlanId,
        campaignName: clientAeoPlansTable.name,
        isActive: keywordsTable.isActive,
        activeVariants: sql<number>`(
          SELECT COUNT(*)::int FROM keyword_variants kv
          WHERE kv.keyword_id = ${keywordsTable.id} AND kv.is_active = true
        )`.as("active_variants"),
        totalVariants: sql<number>`(
          SELECT COUNT(*)::int FROM keyword_variants kv
          WHERE kv.keyword_id = ${keywordsTable.id}
        )`.as("total_variants"),
        lastGeneratedAt: sql<string | null>`(
          SELECT MAX(kv.generated_at) FROM keyword_variants kv
          WHERE kv.keyword_id = ${keywordsTable.id}
        )`.as("last_generated_at"),
        lastUsedAt: sql<string | null>`(
          SELECT MAX(kv.last_used_at) FROM keyword_variants kv
          WHERE kv.keyword_id = ${keywordsTable.id}
        )`.as("last_used_at"),
      })
      .from(keywordsTable)
      .leftJoin(clientsTable, eq(keywordsTable.clientId, clientsTable.id))
      .leftJoin(
        businessesTable,
        eq(keywordsTable.businessId, businessesTable.id),
      )
      .leftJoin(
        clientAeoPlansTable,
        eq(keywordsTable.aeoPlanId, clientAeoPlansTable.id),
      )
      .where(eq(keywordsTable.isActive, true))
      .orderBy(keywordsTable.id);
    res.json({ rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Error building variants overview");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/llm/variants/:keywordId — list variants for one keyword */
router.get("/variants/:keywordId", async (req, res) => {
  try {
    const keywordId = Number(req.params.keywordId);
    if (Number.isNaN(keywordId))
      return res.status(400).json({ error: "Invalid keywordId" });

    const includeInactive = req.query.includeInactive === "true";
    const where = includeInactive
      ? eq(keywordVariantsTable.keywordId, keywordId)
      : and(
          eq(keywordVariantsTable.keywordId, keywordId),
          eq(keywordVariantsTable.isActive, true),
        );

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
router.post(
  "/variants/:keywordId/regenerate",
  requireOwner,
  async (req, res) => {
    try {
      const keywordId = Number(req.params.keywordId);
      if (Number.isNaN(keywordId))
        return res.status(400).json({ error: "Invalid keywordId" });

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
  },
);

/* GET /api/llm/variants/:keywordId/random — pick + bump times_used */
router.get(
  "/variants/:keywordId/random",
  requireExecutorToken,
  async (req, res) => {
    try {
      const keywordId = Number(req.params.keywordId);
      if (Number.isNaN(keywordId))
        return res.status(400).json({ error: "Invalid keywordId" });

      const [pick] = await db
        .select()
        .from(keywordVariantsTable)
        .where(
          and(
            eq(keywordVariantsTable.keywordId, keywordId),
            eq(keywordVariantsTable.isActive, true),
          ),
        )
        .orderBy(sql`RANDOM()`)
        .limit(1);

      if (!pick)
        return res
          .status(404)
          .json({ error: "No active variants for keyword" });

      await db
        .update(keywordVariantsTable)
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
  },
);

/* DELETE /api/llm/variants/by-id/:id — admin override delete */
router.delete("/variants/by-id/:id", requireSession, async (req, res) => {
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

/* POST /api/llm/variants/regenerate-all — weekly cron entry. Owner UI also calls. */
router.post(
  "/variants/regenerate-all",
  requireExecutorOrOwner,
  async (req, res) => {
    try {
      const body = (req.body ?? {}) as { campaignId?: number; count?: number };
      const campaignId =
        body.campaignId != null ? Number(body.campaignId) : null;
      const count = body.count != null ? Number(body.count) : undefined;

      const conditions = [eq(keywordsTable.isActive, true)];
      if (campaignId != null)
        conditions.push(eq(keywordsTable.aeoPlanId, campaignId));

      const keywords = await db
        .select({
          id: keywordsTable.id,
          keywordText: keywordsTable.keywordText,
        })
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
  },
);

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
      return res.status(400).json({
        error: "keyword_id is required and must be a positive integer",
      });
    }

    const platformRaw = (body.platform ?? "").toString().toLowerCase();
    if (!VALID_PLATFORMS.has(platformRaw)) {
      return res.status(400).json({
        error: `platform must be one of ${[...VALID_PLATFORMS].join(", ")}`,
      });
    }

    const voiceRaw = body.voice;
    let voice: VoiceKey | undefined;
    if (voiceRaw != null && voiceRaw !== "") {
      if (
        typeof voiceRaw !== "string" ||
        !VALID_VOICES.includes(voiceRaw as VoiceKey)
      ) {
        return res
          .status(400)
          .json({ error: `voice must be one of ${VALID_VOICES.join(", ")}` });
      }
      voice = voiceRaw as VoiceKey;
    }

    // Archived/locked keywords must not be ranked. This is the enforcement point:
    // every ranking job is enriched here first, so a "skip" stops it being dispatched.
    const [kwRow] = await db
      .select({
        archivedAt: keywordsTable.archivedAt,
        isActive: keywordsTable.isActive,
      })
      .from(keywordsTable)
      .where(eq(keywordsTable.id, keywordId));
    if (!kwRow) return res.status(404).json({ error: "keyword not found" });
    if (kwRow.archivedAt != null || kwRow.isActive === false) {
      return res.json({
        skip: true,
        reason: "keyword locked/inactive — not ranking",
      });
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
   /api/llm/keyword/:id/rank-eligibility — lock enforcement for audit jobs
   ════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/llm/keyword/:id/rank-eligibility
 *
 * Lightweight gate for ranking/audit jobs, which never hit build-session and
 * so don't pass through its enforcement guard. A locked keyword
 * (archivedAt != null OR isActive === false) must NOT be dispatched for
 * ranking. Mirrors the build-session guard's select.
 *
 * Response: { keywordId, skip, reason? }
 *   skip=true when the keyword is not found, archived, or inactive.
 *   Never 500s on a missing keyword — returns { skip:true, reason:"not found" }.
 */
router.get(
  "/keyword/:id/rank-eligibility",
  requireExecutorToken,
  async (req, res) => {
    try {
      const keywordId = Number(req.params.id);
      if (!Number.isFinite(keywordId) || keywordId <= 0) {
        return res.json({ keywordId, skip: true, reason: "not found" });
      }

      const [kwRow] = await db
        .select({
          archivedAt: keywordsTable.archivedAt,
          isActive: keywordsTable.isActive,
        })
        .from(keywordsTable)
        .where(eq(keywordsTable.id, keywordId));

      if (!kwRow) {
        return res.json({ keywordId, skip: true, reason: "not found" });
      }
      if (kwRow.archivedAt != null || kwRow.isActive === false) {
        return res.json({
          keywordId,
          skip: true,
          reason: "keyword locked/inactive — not ranking",
        });
      }
      res.json({ keywordId, skip: false });
    } catch (err) {
      req.log.error({ err }, "Error checking rank eligibility");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ════════════════════════════════════════════════════════════════════════
   /api/llm/build-audit — render audit-ranking prompt with variant rotation
   ════════════════════════════════════════════════════════════════════════ */

/**
 * POST /api/llm/build-audit
 *
 * Returns the rendered audit prompt + business context for one (keyword
 * × platform) audit run. Rotates a keyword variant into the lead question
 * so consecutive audits don't send identical text. The [RANK: X/Y]
 * contract that the runner's parser depends on is preserved.
 *
 * Body:
 *   keyword_id (required, int)
 *   platform   (optional, one of chatgpt|gemini|perplexity — informational)
 *   variant_id (optional, int — pin a specific variant; ignores rotation)
 */
router.post("/build-audit", requireExecutorToken, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const keywordId = Number(body.keyword_id ?? body.keywordId);
    if (!Number.isFinite(keywordId) || keywordId <= 0) {
      return res.status(400).json({
        error: "keyword_id is required and must be a positive integer",
      });
    }

    let platform: string | null = null;
    if (body.platform != null && body.platform !== "") {
      platform = String(body.platform).toLowerCase();
      if (!VALID_PLATFORMS.has(platform)) {
        return res.status(400).json({
          error: `platform must be one of ${[...VALID_PLATFORMS].join(", ")}`,
        });
      }
    }

    const variantIdRaw = body.variant_id ?? body.variantId;
    const variantId =
      variantIdRaw != null && variantIdRaw !== "" ? Number(variantIdRaw) : null;
    if (variantId != null && (!Number.isFinite(variantId) || variantId <= 0)) {
      return res
        .status(400)
        .json({ error: "variant_id must be a positive integer" });
    }

    const start = Date.now();
    const out = await buildAuditPrompt({ keywordId, platform, variantId });
    res.json({ ...out, _elapsedMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "Error building audit prompt");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   /api/llm/build-session-static — stateless daily prompt
   /api/llm/build-audit-static   — stateless audit prompt

   Same outputs as build-session / build-audit, but the caller supplies all
   context (keyword text, variant text, biz info, optional backlinks). No
   DB lookup, no variant rotation, no times_used bump.
   ════════════════════════════════════════════════════════════════════════ */

router.post("/build-session-static", requireExecutorToken, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const keywordText = body.keyword_text ?? body.keywordText;
    if (typeof keywordText !== "string" || keywordText.trim() === "") {
      return res.status(400).json({
        error: "keyword_text is required and must be a non-empty string",
      });
    }

    let platform: string | undefined;
    if (body.platform != null && body.platform !== "") {
      platform = String(body.platform).toLowerCase();
      if (!VALID_PLATFORMS.has(platform)) {
        return res.status(400).json({
          error: `platform must be one of ${[...VALID_PLATFORMS].join(", ")}`,
        });
      }
    }

    let voice: VoiceKey | undefined;
    if (body.voice != null && body.voice !== "") {
      if (
        typeof body.voice !== "string" ||
        !VALID_VOICES.includes(body.voice as VoiceKey)
      ) {
        return res
          .status(400)
          .json({ error: `voice must be one of ${VALID_VOICES.join(", ")}` });
      }
      voice = body.voice as VoiceKey;
    }

    let backlinks:
      | Array<{
          url: string | null;
          link_type_label?: string | null;
          embedded_url?: string | null;
        }>
      | undefined;
    if (body.backlinks != null) {
      if (!Array.isArray(body.backlinks)) {
        return res.status(400).json({ error: "backlinks must be an array" });
      }
      backlinks = body.backlinks as Array<{
        url: string | null;
        link_type_label?: string | null;
        embedded_url?: string | null;
      }>;
    }

    const variantText = body.variant_text ?? body.variantText;
    const optStr = (v: unknown): string | null | undefined =>
      v == null
        ? undefined
        : typeof v === "string"
          ? v === ""
            ? null
            : v
          : null;

    const start = Date.now();
    const out = await buildSessionStatic({
      keyword_text: keywordText,
      variant_text: typeof variantText === "string" ? variantText : undefined,
      platform,
      voice,
      biz_name: optStr(body.biz_name ?? body.bizName),
      biz_category: optStr(body.biz_category ?? body.bizCategory),
      city: optStr(body.city),
      state: optStr(body.state),
      zip: optStr(body.zip),
      published_address: optStr(
        body.published_address ?? body.publishedAddress,
      ),
      search_address: optStr(body.search_address ?? body.searchAddress),
      gmb_url: optStr(body.gmb_url ?? body.gmbUrl),
      website_url: optStr(body.website_url ?? body.websiteUrl),
      backlinks,
    });
    res.json({ ...out, _elapsedMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "Error building static session prompt");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/build-audit-static", requireExecutorToken, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const keywordPhrase = body.keyword_phrase ?? body.keywordPhrase;
    if (typeof keywordPhrase !== "string" || keywordPhrase.trim() === "") {
      return res.status(400).json({
        error: "keyword_phrase is required and must be a non-empty string",
      });
    }

    const optStr = (v: unknown): string | null | undefined =>
      v == null
        ? undefined
        : typeof v === "string"
          ? v === ""
            ? null
            : v
          : null;

    const start = Date.now();
    const out = buildAuditPromptStatic({
      keyword_phrase: keywordPhrase,
      city: optStr(body.city),
      state: optStr(body.state),
      biz_name: optStr(body.biz_name ?? body.bizName),
      biz_url: optStr(body.biz_url ?? body.bizUrl),
    });
    res.json({ ...out, _elapsedMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "Error building static audit prompt");
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

function parseQuery(
  q: Record<string, string>,
): ParsedQuery | { error: string } {
  const { date, clientId, businessId, campaignId, lookbackDays } = q;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "date query param required (YYYY-MM-DD)" };
  }
  const scope: AnalystScope = {};
  if (clientId != null) scope.clientId = Number(clientId);
  if (businessId != null) scope.businessId = Number(businessId);
  if (campaignId != null) scope.campaignId = Number(campaignId);
  if (
    (scope.clientId != null && Number.isNaN(scope.clientId)) ||
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

/* POST /api/llm/audit-report/run — run analyst, persist (or dryRun). Owner UI + executor. */
router.post("/audit-report/run", requireExecutorOrOwner, async (req, res) => {
  try {
    const src = {
      ...(req.query as Record<string, string>),
      ...(req.body as Record<string, string>),
    };
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
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* GET /api/llm/audit-reports — list (owner only) */
router.get("/audit-reports", requireOwner, async (req, res) => {
  try {
    const {
      scope: scopeKind,
      scopeId,
      from,
      to,
      limit = "50",
    } = req.query as Record<string, string>;
    const conditions = [] as ReturnType<typeof eq>[];
    if (scopeKind) conditions.push(eq(dailyReportsTable.scope, scopeKind));
    if (scopeId && !Number.isNaN(Number(scopeId)))
      conditions.push(eq(dailyReportsTable.scopeId, Number(scopeId)));
    if (from)
      conditions.push(
        sql`${dailyReportsTable.reportDate} >= ${from}` as ReturnType<
          typeof eq
        >,
      );
    if (to)
      conditions.push(
        sql`${dailyReportsTable.reportDate} <= ${to}` as ReturnType<typeof eq>,
      );

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const rows = await db
      .select({
        id: dailyReportsTable.id,
        reportDate: dailyReportsTable.reportDate,
        scope: dailyReportsTable.scope,
        scopeId: dailyReportsTable.scopeId,
        modelUsed: dailyReportsTable.modelUsed,
        inputSummary: dailyReportsTable.inputSummary,
        generatedAt: dailyReportsTable.generatedAt,
        durationMs: dailyReportsTable.durationMs,
        costUsd: dailyReportsTable.costUsd,
      })
      .from(dailyReportsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(dailyReportsTable.generatedAt))
      .limit(lim);
    res.json({ reports: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Error listing audit reports");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* GET /api/llm/audit-reports/:id — full report including markdown + recs (owner only) */
router.get("/audit-reports/:id", requireOwner, async (req, res) => {
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
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* DELETE /api/llm/audit-reports/:id — remove a report (owner only) */
router.delete("/audit-reports/:id", requireOwner, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [deleted] = await db
      .delete(dailyReportsTable)
      .where(eq(dailyReportsTable.id, id))
      .returning({ id: dailyReportsTable.id });
    if (!deleted) return res.status(404).json({ error: "Report not found" });
    res.json({ ok: true, deletedId: deleted.id });
  } catch (err) {
    req.log.error({ err }, "Error deleting audit report");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* POST /api/llm/audit-context — raw context (no LLM call). Same as legacy
   /api/analytics/audit-context but lives under the LLM namespace because
   it's the input the LLM agent reads from. Useful for prompt iteration. */
router.get("/audit-context", requireExecutorOrOwner, async (req, res) => {
  try {
    const parsed = parseQuery(req.query as Record<string, string>);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const start = Date.now();
    const ctx = await assembleContext(
      parsed.date,
      parsed.scope,
      parsed.lookbackDays,
    );
    res.json({
      reportDate: ctx.reportDate,
      scope: ctx.scope,
      lookbackDays: ctx.lookbackDays,
      rankChanges: ctx.rankChanges,
      rankHistory: ctx.rankHistory,
      similarityFlags: ctx.similarityFlags,
      gmbMismatches: ctx.gmbMismatches,
      windowActivity: ctx.windowActivity,
      movementCohort: ctx.movementCohort,
      inputSummary: ctx.inputSummary,
      _elapsedMs: Date.now() - start,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching audit context");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/* POST /api/llm/sales-ai/stream
   Browser-facing proxy for the Sales AI page so the DeepSeek key stays
   server-side. Accepts { messages, stream? } in the OpenAI chat format and
   pipes the streamed SSE response straight back. The FE owns the system
   prompt and conversation history; this endpoint is a thin authenticated
   forwarder. Auth: logged-in owner, sales, or chuckslocal (mirrors the sidebar
   gate). */
router.post(
  "/sales-ai/stream",
  requireRoles("owner", "sales", "chuckslocal"),
  async (req, res) => {
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        return res
          .status(503)
          .json({ error: "DEEPSEEK_API_KEY not configured" });
      }

      const body = req.body as { messages?: unknown; stream?: unknown };
      const messages = Array.isArray(body.messages) ? body.messages : null;
      if (!messages || messages.length === 0) {
        return res.status(400).json({ error: "messages array required" });
      }
      const wantsStream = body.stream !== false;

      const upstream = await fetch(
        "https://api.deepseek.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages,
            stream: wantsStream,
          }),
        },
      );

      if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => "");
        return res.status(upstream.status || 502).json({
          error: `DeepSeek ${upstream.status}: ${errText.slice(0, 200) || upstream.statusText}`,
        });
      }

      // Pass through whatever content-type DeepSeek replies with — SSE for
      // streaming, application/json for non-streaming. FE parsers handle both.
      const upstreamType =
        upstream.headers.get("content-type") ??
        "text/event-stream; charset=utf-8";
      res.setHeader("Content-Type", upstreamType);
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const reader = upstream.body.getReader();
      req.on("close", () => reader.cancel().catch(() => {}));
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      req.log.error({ err }, "Error streaming Sales AI response");
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Unknown error",
        });
      } else {
        res.end();
      }
    }
  },
);

/* POST /api/llm/aeo-reporter/stream
   Browser-facing proxy for the AEO Reporter page so it doesn't ship the
   DeepSeek key to the client. Forwards `{ prompt }` to DeepSeek's chat
   completions API as a streamed (SSE) request and pipes the raw bytes
   back so the FE's existing `data: {...}` parser continues to work
   unchanged. Auth is a logged-in admin session (no executor token; this
   is a UI feature, not a runner). */
router.post(
  "/aeo-reporter/stream",
  requireRoles("owner", "sales"),
  async (req, res) => {
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        return res
          .status(503)
          .json({ error: "DEEPSEEK_API_KEY not configured" });
      }
      const body = req.body as { prompt?: unknown };
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        return res.status(400).json({ error: "prompt required" });
      }

      const upstream = await fetch(
        "https://api.deepseek.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
            stream: true,
          }),
        },
      );

      if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => "");
        return res.status(upstream.status || 502).json({
          error: `DeepSeek ${upstream.status}: ${errText.slice(0, 200) || upstream.statusText}`,
        });
      }

      /* Pipe the SSE stream straight through. Express's res supports
       writing chunks; we manually set the headers DeepSeek sends so the
       FE's reader sees the same wire format. */
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const reader = upstream.body.getReader();
      req.on("close", () => reader.cancel().catch(() => {}));
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      req.log.error({ err }, "Error streaming AEO Reporter response");
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Unknown error",
        });
      } else {
        res.end();
      }
    }
  },
);

/* ── helpers for full-audit ─────────────────────────────────────────────── */

interface SiteData {
  ssl: boolean;
  mobile: boolean;
  wordCount: number;
  title: string;
  description: string;
  h1s: string[];
  bodyExcerpt: string;
}

async function fetchSiteData(url: string): Promise<SiteData | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 AEO-Audit-Bot/1.0" },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const html = await resp.text();

    const ssl = url.startsWith("https");
    const title =
      html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const description =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1]?.trim() ??
      html.match(/<meta[^>]+content=["']([^"']*)[^>]+name=["']description["']/i)?.[1]?.trim() ?? "";
    const h1s = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gis)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    const mobile = /<meta[^>]+name=["']viewport["']/i.test(html);

    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const bodyExcerpt = text.slice(0, 2000);

    return { ssl, mobile, wordCount, title, description, h1s, bodyExcerpt };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/* POST /api/llm/sales-ai/full-audit
   Server-side AEO audit: pre-computes LA + YMYL, optionally fetches the
   website, then asks DeepSeek to produce a structured JSON report (ARS
   score, ICE keywords, website analysis, local market, recommendations).
   Auth mirrors /sales-ai/stream. */
router.post(
  "/sales-ai/full-audit",
  requireRoles("owner", "sales", "chuckslocal"),
  async (req, res) => {
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: "DEEPSEEK_API_KEY not configured" });
      }

      const body = req.body as {
        bizName?: string;
        description?: string;
        bizType?: string;
        bizSize?: string;
        competitors?: string;
        website?: string;
        location?: string;
      };

      const bizName     = (body.bizName     ?? "").trim();
      const description = (body.description ?? "").trim();
      const bizType     = (body.bizType     ?? "Other").trim();
      const bizSize     = (body.bizSize     ?? "Small (<50)").trim();
      const competitors = (body.competitors ?? "").trim();
      const website     = (body.website     ?? "").trim();
      const location    = (body.location    ?? "").trim();

      if (!bizName && !description) {
        return res.status(400).json({ error: "bizName or description required" });
      }

      /* ── Server-side pre-calc ── */
      const LOCAL_TYPES = ["Local Service", "Restaurant / Hospitality"];
      const isLocal  = LOCAL_TYPES.includes(bizType);
      const hasLoc   = location.length > 0;
      const la       = isLocal && hasLoc  ? 1.0
                     : isLocal && !hasLoc ? 0.2
                     : !isLocal && hasLoc ? 0.5
                     : 0.0;
      const laLabel  = isLocal && hasLoc  ? "local service + location"
                     : isLocal && !hasLoc ? "local service, no location"
                     : !isLocal && hasLoc ? "non-local + location"
                     : "non-local, no location";

      const YMYL_TYPES = ["Healthcare", "Legal / Financial"];
      const ymyl = YMYL_TYPES.includes(bizType) ? 1 : 0;

      /* ── Optional website fetch ── */
      let site: SiteData | null = null;
      if (website) {
        try {
          site = await fetchSiteData(website);
        } catch {
          /* non-fatal */
        }
      }

      /* ── Build LLM prompt ── */
      const siteBlock = site
        ? `
## Real Website Data (server-fetched — use this, do not invent)
URL: ${website}
SSL/HTTPS: ${site.ssl}
Mobile Viewport: ${site.mobile}
Word Count: ${site.wordCount}
Title: ${site.title || "(none found)"}
Meta Description: ${site.description || "(none found)"}
H1s: ${site.h1s.length ? site.h1s.join(" | ") : "(none found)"}
Body Excerpt (first 2000 chars):
${site.bodyExcerpt}
`
        : website
        ? `\n## Website\nURL provided (${website}) but could not be fetched — infer from business description.\n`
        : `\n## Website\nNone provided — infer from business description.\n`;

      const systemPrompt = `You are an AEO audit engine. Return ONLY valid JSON — no prose, no markdown fences, no text outside the JSON object. Follow the 9 steps below in order.`;

      const userPrompt = `## Business Context
Business Name: ${bizName || "(not provided)"}
Description: ${description || "(not provided)"}
Type: ${bizType}
Size: ${bizSize}
Competitors: ${competitors || "unknown"}
Location: ${location || "not provided"}
Website: ${website || "not provided"}
${siteBlock}

## Pre-computed Server Values (treat these as ground truth — do not recalculate)
Local Advantage (LA): ${la}   // Rule: ${laLabel}
YMYL Penalty: ${ymyl}         // ${ymyl ? "health/legal/finance — add +30 to prompt volume" : "no YMYL penalty"}

## Steps — follow in order:

Step 1 — KEYWORDS
Generate 5–7 AEO-relevant keywords for this business.

Step 2 — ICE SCORES (per keyword)
  impact (1–5): revenue/visibility potential on AI answer engines
  confidence (1–5): likelihood this business can rank
  ease (1–5): ease of content creation (5 = easiest)
  ease_adj = ease + (0.5 if LA ≥ 0.5, else 0)
  ice = (impact × 0.4) + (confidence × 0.3) + (ease_adj × 0.3)
  priority: "high" if ice ≥ 3.5 | "medium" if 2.5–3.49 | "low" if < 2.5
  on_site: true if keyword/topic clearly appears in website data above, false otherwise

Step 3 — CCS (Content Coverage Score)
  Percentage of keywords where on_site = true. Round to 1 decimal. If no site data, estimate from description.

Step 4 — PROMPT VOLUME
  Parse "${competitors}" as a number (use 5 if unparseable).
  total = (competitor_count × 100) + (${ymyl} × 30) − (${la} × 20)
  weekly = ceil(total / 4)

Step 5 — ARS SCORE (AEO Readiness Score)
  avg_ice = average of all ice scores
  norm_ice = avg_ice / 5 × 100
  Use pc_avg and rc_avg from Step 6 (example_prompt).
  norm_pqs = pqs / 5 × 100
  ars = (ccs × 0.3) + (norm_ice × 0.4) + (norm_pqs × 0.2) + (${la} × 10)
  rating: "Green" if ars ≥ 80 | "Amber" if ≥ 60 | "Red" if < 60
  formula: write the full substituted formula string, e.g. "(CCS × 0.3) + (norm_ice × 0.4) + (norm_pqs × 0.2) + (LA × 10) = (28.6 × 0.3) + ..."
  summary: 2–3 sentence executive summary explaining the score and the #1 gap

Step 6 — EXAMPLE PROMPT + PQS
  Write one realistic AEO search query for the top keyword.
  pc_avg (1–5): prompt clarity
  rc_avg (1–5): likelihood this business is cited in AI answers right now
  pqs = (pc_avg × 0.4) + (rc_avg × 0.6)
  threshold_met: pqs ≥ 4.0

Step 7 — WEBSITE ANALYSIS
  ${site ? "Use the real fetched data above." : "Infer from business description (no live data)."}
  summary: 3–4 sentences on AEO readiness of the web presence
  ssl_note, mobile_note, content_note: short scoring observations (e.g. "SSL/HTTPS gives +1 Confidence")
  Fill ssl/mobile/word_count/title/description/h1 from the fetched data if available, else use null/0/"".

Step 8 — LOCAL MARKET
  location: "${location || "not specified"}"
  optimization_score: "X/10" — rate the local AEO opportunity
  summary: 3–4 sentences on local market dynamics and missed opportunities
  recommendations: 3 concise bullet strings (action items for local AEO)

Step 9 — RECOMMENDATIONS
  4–6 prioritized action items sorted by priority (high first).
  Each: { priority, action, impact, effort, rationale }

Return this exact JSON (no other text):
{
  "keywords": [
    { "keyword": "...", "impact": 4, "confidence": 3, "ease": 4, "ease_adj": 4.5, "ice": 3.75, "on_site": true, "priority": "high" }
  ],
  "ccs": 28.6,
  "search_volume": {
    "total": 280,
    "weekly": 70,
    "competitor_count": 3,
    "ymyl_penalty": ${ymyl},
    "la_used": ${la},
    "formula": "..."
  },
  "ars": {
    "score": 69.2,
    "rating": "Amber",
    "formula": "...",
    "summary": "..."
  },
  "example_prompt": {
    "text": "...",
    "pqs": 4.20,
    "pc_avg": 4.00,
    "rc_avg": 4.33,
    "threshold_met": true
  },
  "website_analysis": {
    "ssl": ${site ? site.ssl : null},
    "mobile": ${site ? site.mobile : null},
    "word_count": ${site ? site.wordCount : 0},
    "title": ${JSON.stringify(site?.title ?? "")},
    "description": ${JSON.stringify(site?.description ?? "")},
    "h1": ${JSON.stringify(site?.h1s[0] ?? "")},
    "summary": "...",
    "ssl_note": "...",
    "mobile_note": "...",
    "content_note": "..."
  },
  "local_market": {
    "location": "${location || "General"}",
    "optimization_score": "5/10",
    "summary": "...",
    "recommendations": ["...", "...", "..."]
  },
  "recommendations": [
    { "priority": "high", "action": "...", "impact": "...", "effort": "low", "rationale": "..." }
  ]
}`;

      const upstream = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
          stream: false,
        }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return res.status(upstream.status || 502).json({
          error: `DeepSeek ${upstream.status}: ${errText.slice(0, 200)}`,
        });
      }

      const data = (await upstream.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = data.choices?.[0]?.message?.content ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(502).json({ error: "Could not parse audit JSON from model response" });
      }

      const parsed = JSON.parse(jsonMatch[0]);

      /* Attach the server-fetched site metadata so the FE can trust it */
      if (site) {
        parsed._site = {
          ssl: site.ssl,
          mobile: site.mobile,
          wordCount: site.wordCount,
          title: site.title,
          description: site.description,
          h1: site.h1s[0] ?? "",
        };
      }
      parsed._la   = la;
      parsed._ymyl = ymyl;

      return res.json(parsed);
    } catch (err) {
      req.log.error({ err }, "Error running full AEO audit");
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },
);

export default router;
