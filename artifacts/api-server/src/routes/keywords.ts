import { Router } from "express";
import { db } from "@workspace/db";
import { keywordsTable, insertKeywordSchema, keywordLinksTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { ok, created, noContent, badRequest, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

/* ────────────────────────────────────────────────────────────
   GET /api/keywords
   Returns all AEO keywords, optionally filtered by clientId
──────────────────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    const { clientId } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId) conditions.push(eq(keywordsTable.clientId, parseInt(clientId)));
    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    ok(res, keywords);
  } catch (err) {
    req.log.error({ err }, "Error fetching keywords");
    serverError(res);
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords
   Create a new keyword for a business
──────────────────────────────────────────────────────────── */
router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertKeywordSchema);
    if (!data) return;

    const [keyword] = await db
      .insert(keywordsTable)
      .values(data)
      .returning();
    created(res, keyword);
  } catch (err) {
    req.log.error({ err }, "Error creating keyword");
    serverError(res);
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
    ok(res, links);
  } catch (err) {
    req.log.error({ err }, "Error fetching keyword links");
    serverError(res);
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
    created(res, link);
  } catch (err) {
    req.log.error({ err }, "Error creating keyword link");
    serverError(res);
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
      return badRequest(res, "No valid fields to update");
    }
    const [link] = await db
      .update(keywordLinksTable)
      .set(allowed)
      .where(eq(keywordLinksTable.id, linkId))
      .returning();
    if (!link) return notFound(res);
    ok(res, link);
  } catch (err) {
    req.log.error({ err }, "Error updating keyword link");
    serverError(res);
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
    noContent(res);
  } catch (err) {
    req.log.error({ err }, "Error deleting keyword link");
    serverError(res);
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
      return badRequest(res, "No valid fields to update");
    }

    const [keyword] = await db
      .update(keywordsTable)
      .set(allowed)
      .where(eq(keywordsTable.id, id))
      .returning();

    if (!keyword) return notFound(res);
    ok(res, keyword);
  } catch (err) {
    req.log.error({ err }, "Error updating keyword");
    serverError(res);
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
    noContent(res);
  } catch (err) {
    req.log.error({ err }, "Error deleting keyword");
    serverError(res);
  }
});

export default router;
