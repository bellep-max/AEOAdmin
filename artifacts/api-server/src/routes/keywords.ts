import { Router } from "express";
import { db } from "@workspace/db";
import { keywordsTable, keywordLinksTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

/* ────────────────────────────────────────────────────────────
   GET /api/keywords
   Returns all AEO keywords, optionally filtered by clientId
──────────────────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    const { clientId, aeoPlanId } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId)  conditions.push(eq(keywordsTable.clientId,  parseInt(clientId)));
    if (aeoPlanId) conditions.push(eq(keywordsTable.aeoPlanId, parseInt(aeoPlanId)));
    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    res.json(keywords);
  } catch (err) {
    req.log.error({ err }, "Error fetching keywords");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords
   Create a new keyword for a business
──────────────────────────────────────────────────────────── */
router.post("/", async (req, res) => {
  try {
    const body = req.body;
    if (!body.clientId || !body.keywordText?.trim()) {
      return res.status(400).json({ error: "clientId and keywordText are required" });
    }
    const [keyword] = await db
      .insert(keywordsTable)
      .values({
        clientId: Number(body.clientId),
        aeoPlanId: body.aeoPlanId != null ? Number(body.aeoPlanId) : null,
        keywordText: body.keywordText.trim(),
        keywordType: body.keywordType ? Number(body.keywordType) : 3,
        isActive:   body.isActive !== false,
        isPrimary:  body.isPrimary ? Number(body.isPrimary) : 0,
        verificationStatus: body.verificationStatus ?? null,
        initialSearchCount30Days:  body.initialSearchCount30Days  ?? null,
        followupSearchCount30Days: body.followupSearchCount30Days ?? null,
        initialSearchCountLife:    body.initialSearchCountLife    ?? null,
        followupSearchCountLife:   body.followupSearchCountLife   ?? null,
        initialRankReportCount:    body.initialRankReportCount    ?? null,
        currentRankReportCount:    body.currentRankReportCount    ?? null,
        linkTypeLabel:         body.linkTypeLabel         ?? null,
        linkActive:            body.linkActive !== false,
        initialRankReportLink: body.initialRankReportLink ?? null,
        currentRankReportLink: body.currentRankReportLink ?? null,
      })
      .returning();
    res.status(201).json(keyword);
  } catch (err) {
    req.log.error({ err }, "Error creating keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/keywords/:id/links
   Returns all associated links for a keyword
──────────────────────────────────────────────────────────── */
router.get("/:id/links", async (req, res) => {
  try {
    const keywordId = parseInt(req.params.id);
    const links = await db
      .select()
      .from(keywordLinksTable)
      .where(eq(keywordLinksTable.keywordId, keywordId))
      .orderBy(keywordLinksTable.createdAt);
    res.json(links);
  } catch (err) {
    req.log.error({ err }, "Error fetching keyword links");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords/:id/links
   Add a new associated link to a keyword
──────────────────────────────────────────────────────────── */
router.post("/:id/links", async (req, res) => {
  try {
    const keywordId = parseInt(req.params.id);
    const body      = req.body;
    const [link] = await db
      .insert(keywordLinksTable)
      .values({
        keywordId,
        linkUrl:               body.linkUrl               ?? null,
        linkTypeLabel:         body.linkTypeLabel         ?? null,
        linkActive:            body.linkActive !== false,
        initialRankReportLink: body.initialRankReportLink ?? null,
        currentRankReportLink: body.currentRankReportLink ?? null,
      })
      .returning();
    // Ensure keyword is marked as type 4 (Keywords with Backlinks)
    await db.update(keywordsTable)
      .set({ keywordType: 4 })
      .where(eq(keywordsTable.id, keywordId));
    res.status(201).json(link);
  } catch (err) {
    req.log.error({ err }, "Error creating keyword link");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   PATCH /api/keywords/:id/links/:linkId
   Update an associated link
──────────────────────────────────────────────────────────── */
router.patch("/:id/links/:linkId", async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const body   = req.body as Record<string, unknown>;
    const allowed: Record<string, unknown> = {};
    if (body.linkUrl                !== undefined) allowed.linkUrl                = body.linkUrl ?? null;
    if (body.linkTypeLabel         !== undefined) allowed.linkTypeLabel         = body.linkTypeLabel ?? null;
    if (body.linkActive            !== undefined) allowed.linkActive            = Boolean(body.linkActive);
    if (body.initialRankReportLink !== undefined) allowed.initialRankReportLink = body.initialRankReportLink ?? null;
    if (body.currentRankReportLink !== undefined) allowed.currentRankReportLink = body.currentRankReportLink ?? null;
    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    const [link] = await db
      .update(keywordLinksTable)
      .set(allowed)
      .where(eq(keywordLinksTable.id, linkId))
      .returning();
    if (!link) return res.status(404).json({ error: "Not found" });
    res.json(link);
  } catch (err) {
    req.log.error({ err }, "Error updating keyword link");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   DELETE /api/keywords/:id/links/:linkId
   Remove an associated link from a keyword
──────────────────────────────────────────────────────────── */
router.delete("/:id/links/:linkId", async (req, res) => {
  try {
    const keywordId = parseInt(req.params.id);
    const linkId    = parseInt(req.params.linkId);
    await db.delete(keywordLinksTable).where(eq(keywordLinksTable.id, linkId));
    // If no links remain, revert keyword to type 3 (Keywords)
    const remaining = await db.select().from(keywordLinksTable)
      .where(eq(keywordLinksTable.keywordId, keywordId));
    if (remaining.length === 0) {
      await db.update(keywordsTable)
        .set({ keywordType: 3 })
        .where(eq(keywordsTable.id, keywordId));
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting keyword link");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   PATCH /api/keywords/:id
   Update keyword fields
──────────────────────────────────────────────────────────── */
router.patch("/:id", async (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const body = req.body as Record<string, unknown>;

    const allowed: Record<string, unknown> = {};
    if (body.keywordText      !== undefined) allowed.keywordText      = String(body.keywordText).trim();
    if (body.keywordType      !== undefined) allowed.keywordType      = Number(body.keywordType);
    if (body.isActive         !== undefined) allowed.isActive         = Boolean(body.isActive);
    if (body.isPrimary        !== undefined) allowed.isPrimary        = Number(body.isPrimary);
    if (body.aeoPlanId        !== undefined) allowed.aeoPlanId        = body.aeoPlanId === null ? null : Number(body.aeoPlanId);
    if (body.verificationStatus !== undefined) allowed.verificationStatus = body.verificationStatus === null ? null : String(body.verificationStatus);
    if (body.linkTypeLabel    !== undefined) allowed.linkTypeLabel    = body.linkTypeLabel === null ? null : String(body.linkTypeLabel);
    if (body.linkActive       !== undefined) allowed.linkActive       = Boolean(body.linkActive);
    if (body.initialRankReportLink  !== undefined) allowed.initialRankReportLink  = body.initialRankReportLink  === null ? null : String(body.initialRankReportLink);
    if (body.currentRankReportLink  !== undefined) allowed.currentRankReportLink  = body.currentRankReportLink  === null ? null : String(body.currentRankReportLink);
    if (body.initialSearchCount30Days  !== undefined) allowed.initialSearchCount30Days  = body.initialSearchCount30Days === null ? null : Number(body.initialSearchCount30Days);
    if (body.followupSearchCount30Days !== undefined) allowed.followupSearchCount30Days = body.followupSearchCount30Days === null ? null : Number(body.followupSearchCount30Days);
    if (body.initialSearchCountLife    !== undefined) allowed.initialSearchCountLife    = body.initialSearchCountLife === null ? null : Number(body.initialSearchCountLife);
    if (body.followupSearchCountLife   !== undefined) allowed.followupSearchCountLife   = body.followupSearchCountLife === null ? null : Number(body.followupSearchCountLife);
    if (body.initialRankReportCount    !== undefined) allowed.initialRankReportCount    = body.initialRankReportCount === null ? null : Number(body.initialRankReportCount);
    if (body.currentRankReportCount    !== undefined) allowed.currentRankReportCount    = body.currentRankReportCount === null ? null : Number(body.currentRankReportCount);

    if (body.dateAdded !== undefined && body.dateAdded !== null) {
      const d = new Date(body.dateAdded as string);
      if (!isNaN(d.getTime())) allowed.dateAdded = d;
    }

    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const [keyword] = await db
      .update(keywordsTable)
      .set(allowed)
      .where(eq(keywordsTable.id, id))
      .returning();

    if (!keyword) return res.status(404).json({ error: "Not found" });
    res.json(keyword);
  } catch (err) {
    req.log.error({ err }, "Error updating keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   DELETE /api/keywords/:id
   Remove a keyword and its linked data
──────────────────────────────────────────────────────────── */
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(keywordsTable).where(eq(keywordsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
