import { Router } from "express";
import { db } from "@workspace/db";
import { rankingRunsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? "10", 10) || 10, 100);
    const rows = await db
      .select()
      .from(rankingRunsTable)
      .orderBy(desc(rankingRunsTable.startedAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching ranking runs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/latest", async (_req, res) => {
  try {
    const [row] = await db
      .select()
      .from(rankingRunsTable)
      .orderBy(desc(rankingRunsTable.startedAt))
      .limit(1);
    res.json(row ?? null);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const [row] = await db
      .insert(rankingRunsTable)
      .values({
        status: body.status ?? "running",
        keywordsAttempted: body.keywordsAttempted ?? 0,
        keywordsSucceeded: body.keywordsSucceeded ?? 0,
        keywordsFailed: body.keywordsFailed ?? 0,
        notes: body.notes ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Error creating ranking run");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.finishedAt !== undefined) updates.finishedAt = body.finishedAt ? new Date(body.finishedAt) : null;
    if (body.keywordsAttempted !== undefined) updates.keywordsAttempted = body.keywordsAttempted;
    if (body.keywordsSucceeded !== undefined) updates.keywordsSucceeded = body.keywordsSucceeded;
    if (body.keywordsFailed !== undefined) updates.keywordsFailed = body.keywordsFailed;
    if (body.notes !== undefined) updates.notes = body.notes;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [row] = await db.update(rankingRunsTable).set(updates as any).where(eq(rankingRunsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Error updating ranking run");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
