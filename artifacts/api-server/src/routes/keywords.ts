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
    const id = parseInt(req.params.id);
    const [keyword] = await db
      .update(keywordsTable)
      .set(req.body)
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
