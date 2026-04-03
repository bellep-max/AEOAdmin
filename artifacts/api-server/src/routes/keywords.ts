import { Router } from "express";
import { db } from "@workspace/db";
import { keywordsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { clientId, tierLabel } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId) conditions.push(eq(keywordsTable.clientId, parseInt(clientId)));
    if (tierLabel && ["aeo", "seo", "both"].includes(tierLabel)) {
      conditions.push(eq(keywordsTable.tierLabel, tierLabel));
    }
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
        keywordText: body.keywordText.trim(),
        tierLabel: body.tierLabel ?? "aeo",
        isActive: body.isActive !== false,
        isPrimary: body.isPrimary ? 1 : 0,
        webType: Number(body.webType ?? 1),
        keywordType: Number(body.keywordType ?? 1),
        backlinkCount: Number(body.backlinkCount ?? 0),
        verificationStatus: body.verificationStatus ?? "pending",
      })
      .returning();
    res.status(201).json(keyword);
  } catch (err) {
    req.log.error({ err }, "Error creating keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const body = req.body as Record<string, unknown>;

    // Only pass safe, typed fields — never passthrough raw body to Drizzle
    const allowed: Record<string, unknown> = {};

    if (body.keywordText      !== undefined) allowed.keywordText      = String(body.keywordText).trim();
    if (body.isActive         !== undefined) allowed.isActive         = Boolean(body.isActive);
    if (body.isPrimary        !== undefined) allowed.isPrimary        = Number(body.isPrimary) ? 1 : 0;
    if (body.keywordType      !== undefined) allowed.keywordType      = Number(body.keywordType);
    if (body.backlinkCount    !== undefined) allowed.backlinkCount    = Number(body.backlinkCount);
    if (body.tierLabel        !== undefined) allowed.tierLabel        = String(body.tierLabel);
    if (body.verificationStatus !== undefined) allowed.verificationStatus = String(body.verificationStatus);
    if (body.linkTypeLabel    !== undefined) allowed.linkTypeLabel    = body.linkTypeLabel === null ? null : String(body.linkTypeLabel);
    if (body.linkActive       !== undefined) allowed.linkActive       = Boolean(body.linkActive);
    if (body.initialRankReportLink  !== undefined) allowed.initialRankReportLink  = body.initialRankReportLink  === null ? null : String(body.initialRankReportLink);
    if (body.currentRankReportLink  !== undefined) allowed.currentRankReportLink  = body.currentRankReportLink  === null ? null : String(body.currentRankReportLink);
    if (body.initialSearchCount30Days  !== undefined) allowed.initialSearchCount30Days  = Number(body.initialSearchCount30Days);
    if (body.followupSearchCount30Days !== undefined) allowed.followupSearchCount30Days = Number(body.followupSearchCount30Days);
    if (body.initialSearchCountLife    !== undefined) allowed.initialSearchCountLife    = Number(body.initialSearchCountLife);
    if (body.followupSearchCountLife   !== undefined) allowed.followupSearchCountLife   = Number(body.followupSearchCountLife);

    // dateAdded: coerce string → Date for the timestamp column
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
