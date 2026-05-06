import { Router } from "express";
import { db } from "@workspace/db";
import {
  keywordVariantsTable,
  keywordsTable,
  businessesTable,
  clientAeoPlansTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";
import { generateVariants } from "../services/variant-generator";
import { PROMPT_TEMPLATES } from "../services/prompt-templates";

const router = Router();

const VARIANT_TTL_DAYS = 7;

interface KeywordContext {
  id: number;
  keywordText: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  businessName: string | null;
}

async function loadKeywordContext(keywordId: number): Promise<KeywordContext | null> {
  const [row] = await db
    .select({
      id: keywordsTable.id,
      keywordText: keywordsTable.keywordText,
      city: businessesTable.city,
      state: businessesTable.state,
      zipCode: businessesTable.zipCode,
      businessName: businessesTable.name,
    })
    .from(keywordsTable)
    .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
    .where(eq(keywordsTable.id, keywordId));
  return row ?? null;
}

function thisMondayET(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

function expiresAtFromNow(): Date {
  return new Date(Date.now() + VARIANT_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function regenerateForKeyword(keywordId: number, count?: number) {
  const ctx = await loadKeywordContext(keywordId);
  if (!ctx) throw new Error(`Keyword ${keywordId} not found`);

  const result = await generateVariants({
    keyword: ctx.keywordText,
    zipCode: ctx.zipCode,
    city: ctx.city,
    state: ctx.state,
    businessName: ctx.businessName,
    count,
  });

  const weekOf = thisMondayET();
  const expiresAt = expiresAtFromNow();

  await db.update(keywordVariantsTable)
    .set({ isActive: false })
    .where(eq(keywordVariantsTable.keywordId, keywordId));

  const inserted = await db.insert(keywordVariantsTable).values(
    result.variants.map((variant) => ({
      keywordId,
      variantText: variant,
      isActive: true,
      weekOf,
      sourceModel: result.model,
      generationParams: result.generationParams,
      expiresAt,
    })),
  ).returning();

  return { variants: inserted, count: inserted.length };
}

/* ────────────────────────────────────────────────────────────
   GET /api/keywords/:keywordId/variants
   List variants for a keyword. Defaults to active only.
──────────────────────────────────────────────────────────── */
router.get("/keywords/:keywordId/variants", async (req, res) => {
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

/* ────────────────────────────────────────────────────────────
   POST /api/keywords/:keywordId/variants/regenerate
   Generate fresh variants for one keyword. Marks prior active
   variants inactive (kept for history) and inserts new batch.
──────────────────────────────────────────────────────────── */
router.post("/keywords/:keywordId/variants/regenerate", async (req, res) => {
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

/* ────────────────────────────────────────────────────────────
   GET /api/keywords/:keywordId/variants/random
   Picks a random active variant; bumps times_used + last_used_at.
   Used by the executor when building the search prompt for a daily run.
──────────────────────────────────────────────────────────── */
router.get("/keywords/:keywordId/variants/random", requireExecutorToken, async (req, res) => {
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

/* ────────────────────────────────────────────────────────────
   DELETE /api/keyword-variants/:id
──────────────────────────────────────────────────────────── */
router.delete("/keyword-variants/:id", async (req, res) => {
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
router.post("/keyword-variants/regenerate-all", requireExecutorToken, async (req, res) => {
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
