import { Router } from "express";
import { db } from "@workspace/db";
import { keywordVariantsTable, keywordsTable } from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";
import { requireAdmin } from "../middlewares/role-auth";
import { PROMPT_TEMPLATES } from "../services/prompt-templates";
import { regenerateForKeyword } from "../services/variant-rotation";

const router = Router();

/**
 * NOTE: legacy paths preserved for back-compat. New work should call the
 * /api/llm/* equivalents in routes/llm.ts — both share the same service
 * functions, so the legacy paths will keep working until consumers migrate.
 */

/* ────────────────────────────────────────────────────────────
   GET /api/keywords/:keywordId/variants
   List variants for a keyword. Defaults to active only.
──────────────────────────────────────────────────────────── */
router.get("/keywords/:keywordId/variants", async (req, res) => {
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

/* ────────────────────────────────────────────────────────────
   POST /api/keywords/:keywordId/variants/regenerate
   Generate fresh variants for one keyword. Marks prior active
   variants inactive (kept for history) and inserts new batch.
──────────────────────────────────────────────────────────── */
router.post("/keywords/:keywordId/variants/regenerate", async (req, res) => {
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
});

/* ────────────────────────────────────────────────────────────
   GET /api/keywords/:keywordId/variants/random
   Picks a random active variant; bumps times_used + last_used_at.
   Used by the executor when building the search prompt for a daily run.
──────────────────────────────────────────────────────────── */
router.get(
  "/keywords/:keywordId/variants/random",
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

/* ────────────────────────────────────────────────────────────
   DELETE /api/keyword-variants/:id
──────────────────────────────────────────────────────────── */
router.delete("/keyword-variants/:id", requireAdmin, async (req, res) => {
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

/* ────────────────────────────────────────────────────────────
   POST /api/keyword-variants/regenerate-all
   Weekly cron entry. Walks all active keywords (optionally
   filtered by campaignId) and regenerates variants for each.
   Auth: executor token (called from cron).
──────────────────────────────────────────────────────────── */
router.post(
  "/keyword-variants/regenerate-all",
  requireExecutorToken,
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

/* ────────────────────────────────────────────────────────────
   GET /api/prompt-templates
   Read-only list of the 3 prompt templates that drive the
   variant + search + followup pipeline. Surfaces them in the
   admin /prompts page so Mary/Russ can audit what is shipping.
──────────────────────────────────────────────────────────── */
router.get("/prompt-templates", async (_req, res) => {
  res.json({ templates: PROMPT_TEMPLATES });
});

export default router;
