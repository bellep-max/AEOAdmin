import { Router } from "express";
import { db } from "@workspace/db";
import {
  keywordResearchRunsTable,
  keywordResearchIdeasTable,
  keywordsTable,
  clientAeoPlansTable,
  businessesTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireSession } from "../middlewares/session-auth";
import { runKeywordResearch, suggestSeedFromName, DEFAULT_WEIGHTS, type ScoringWeights } from "../services/keyword-research";

const router = Router();

/* ────────────────────────────────────────────────────────────
   POST /api/keyword-research/runs
   Run the discovery pipeline (autocomplete + DeepSeek), persist a
   run + its ideas, and return them. Session-protected because it
   makes a paid DeepSeek call.
──────────────────────────────────────────────────────────── */
router.post("/runs", requireSession, async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      clientId?: number;
      businessId?: number;
      seed?: string;
      location?: string;
      gl?: string;
      hl?: string;
      maxIdeas?: number;
      aiCount?: number;
      weights?: Partial<ScoringWeights>;
    };

    const seed = typeof body.seed === "string" ? body.seed.trim() : "";
    if (!seed) return res.status(400).json({ error: "seed is required" });

    const weights: ScoringWeights = {
      volume: body.weights?.volume ?? DEFAULT_WEIGHTS.volume,
      intent: body.weights?.intent ?? DEFAULT_WEIGHTS.intent,
      difficulty: body.weights?.difficulty ?? DEFAULT_WEIGHTS.difficulty,
    };

    const result = await runKeywordResearch({
      seed,
      location: body.location,
      gl: body.gl,
      hl: body.hl,
      maxIdeas: body.maxIdeas,
      aiCount: body.aiCount,
      weights,
    });

    const ideaCount = result.traditional.length + result.aiSearch.length;
    if (ideaCount === 0) {
      return res.status(502).json({ error: "No keywords returned — autocomplete may be unreachable. Try a broader seed." });
    }

    const userId = (req.session as unknown as { userId?: number }).userId;

    const [run] = await db
      .insert(keywordResearchRunsTable)
      .values({
        clientId: body.clientId ?? null,
        businessId: body.businessId ?? null,
        seed,
        location: body.location ?? null,
        gl: body.gl ?? "us",
        hl: body.hl ?? "en",
        scoringWeights: weights,
        status: "success",
        costUsd: result.costUsd,
        createdBy: userId != null ? String(userId) : null,
      })
      .returning();

    const ideaRows = [...result.traditional, ...result.aiSearch].map((i) => ({
      runId: run.id,
      keyword: i.keyword,
      listType: i.listType,
      popularity: i.popularity,
      intent: i.intent,
      commercialIntent: i.commercialIntent,
      reasoning: i.reasoning,
      difficulty: i.difficulty,
      difficultyBasis: i.difficultyBasis,
      lvs: i.lvs,
    }));
    const ideas = await db.insert(keywordResearchIdeasTable).values(ideaRows).returning();

    res.status(201).json({ run, ideas });
  } catch (err) {
    req.log.error({ err }, "keyword-research: run failed");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/keyword-research/suggest-seed?businessId=
   Pre-fill the seed + location for a business so the user doesn't
   have to think one up. Source order: category -> existing keyword
   -> AI-derived from the business name.
──────────────────────────────────────────────────────────── */
router.get("/suggest-seed", requireSession, async (req, res) => {
  try {
    const businessId = Number(req.query.businessId);
    if (Number.isNaN(businessId)) return res.status(400).json({ error: "businessId is required" });

    const [biz] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId));
    if (!biz) return res.status(404).json({ error: "Business not found" });

    const location = [biz.city, biz.state].filter(Boolean).join(", ") || biz.zipCode || "";

    // 1. category (rarely populated, but cheapest + most accurate when present)
    if (biz.category && biz.category.trim()) {
      return res.json({ seed: biz.category.trim().toLowerCase(), source: "category", location });
    }
    // 2. an existing keyword on this business (primary first) — researching to expand
    const [kw] = await db
      .select({ keywordText: keywordsTable.keywordText })
      .from(keywordsTable)
      .where(eq(keywordsTable.businessId, businessId))
      .orderBy(desc(keywordsTable.isPrimary))
      .limit(1);
    if (kw?.keywordText) {
      return res.json({ seed: kw.keywordText, source: "existing-keyword", location });
    }
    // 3. derive from the business name via DeepSeek (every business has a name)
    const aiSeed = await suggestSeedFromName(biz.name, biz.websiteUrl ?? undefined);
    return res.json({ seed: aiSeed ?? "", source: aiSeed ? "ai" : "none", location });
  } catch (err) {
    req.log.error({ err }, "keyword-research: suggest-seed failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/keyword-research/runs?clientId=
   List past runs (newest first).
──────────────────────────────────────────────────────────── */
router.get("/runs", async (req, res) => {
  try {
    const { clientId } = req.query as Record<string, string>;
    const base = db.select().from(keywordResearchRunsTable);
    const rows = clientId
      ? await base.where(eq(keywordResearchRunsTable.clientId, parseInt(clientId))).orderBy(desc(keywordResearchRunsTable.createdAt))
      : await base.orderBy(desc(keywordResearchRunsTable.createdAt));
    res.json({ runs: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "keyword-research: list runs failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/keyword-research/runs/:id
   One run + its ideas (traditional first, then ai_search, by LVS).
──────────────────────────────────────────────────────────── */
router.get("/runs/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [run] = await db.select().from(keywordResearchRunsTable).where(eq(keywordResearchRunsTable.id, id));
    if (!run) return res.status(404).json({ error: "Run not found" });

    const ideas = await db
      .select()
      .from(keywordResearchIdeasTable)
      .where(eq(keywordResearchIdeasTable.runId, id))
      .orderBy(desc(keywordResearchIdeasTable.lvs));
    res.json({ run, ideas });
  } catch (err) {
    req.log.error({ err }, "keyword-research: get run failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keyword-research/ideas/:ideaId/promote
   Promote a research idea into the curated keywords pool.
   Body: { aeoPlanId } — keywords must belong to a campaign.
──────────────────────────────────────────────────────────── */
router.post("/ideas/:ideaId/promote", requireSession, async (req, res) => {
  try {
    const ideaId = Number(req.params.ideaId);
    if (Number.isNaN(ideaId)) return res.status(400).json({ error: "Invalid ideaId" });

    const body = (req.body ?? {}) as { aeoPlanId?: number };
    if (body.aeoPlanId == null) {
      return res.status(400).json({ error: "aeoPlanId (campaign) is required — keywords must belong to a campaign" });
    }

    const [idea] = await db.select().from(keywordResearchIdeasTable).where(eq(keywordResearchIdeasTable.id, ideaId));
    if (!idea) return res.status(404).json({ error: "Idea not found" });
    if (idea.promotedKeywordId != null) {
      return res.status(409).json({ error: "Idea already promoted", keywordId: idea.promotedKeywordId });
    }

    const [plan] = await db
      .select()
      .from(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.id, Number(body.aeoPlanId)));
    if (!plan) return res.status(400).json({ error: "aeoPlanId does not reference an existing campaign" });

    const note = `from keyword research (LVS ${idea.lvs ?? "?"}, intent ${idea.intent ?? "?"})`;
    const [keyword] = await db
      .insert(keywordsTable)
      .values({
        clientId: plan.clientId,
        businessId: plan.businessId ?? null,
        aeoPlanId: plan.id,
        keywordText: idea.keyword,
        isActive: true,
        status: "new",
        notes: note,
      })
      .returning();

    await db
      .update(keywordResearchIdeasTable)
      .set({ promotedKeywordId: keyword.id })
      .where(eq(keywordResearchIdeasTable.id, ideaId));

    res.status(201).json({ keyword, ideaId });
  } catch (err) {
    req.log.error({ err }, "keyword-research: promote failed");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

export default router;
