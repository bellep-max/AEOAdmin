import { Router } from "express";
import { db } from "@workspace/db";
import { rankingRunsTable, rankingReportsTable } from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";

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
    // Get latest from ranking_runs
    const [runRow] = await db
      .select()
      .from(rankingRunsTable)
      .orderBy(desc(rankingRunsTable.startedAt))
      .limit(1);

    // Get latest from ranking_reports — the real source of truth
    const [reportRow] = await db.execute(sql`
      SELECT
        MAX(date) as latest_date,
        COUNT(DISTINCT keyword_id)::int as keyword_count,
        COUNT(*)::int as total_rows,
        COUNT(*) FILTER (WHERE status = 'success')::int as succeeded,
        COUNT(*) FILTER (WHERE status = 'error')::int as failed
      FROM ranking_reports
      WHERE date = (SELECT MAX(date) FROM ranking_reports)
    `);

    const report = reportRow as Record<string, unknown> | undefined;
    const reportDate = report?.latest_date as string | null;

    // If ranking_reports has newer data, use it
    const runDate = runRow?.startedAt ? new Date(runRow.startedAt).toISOString().split("T")[0] : null;
    const useReport = reportDate && (!runDate || reportDate >= runDate);

    if (useReport && report) {
      res.json({
        id: 0,
        startedAt: reportDate ? `${reportDate}T00:00:00Z` : new Date().toISOString(),
        finishedAt: reportDate ? `${reportDate}T23:59:59Z` : null,
        status: (Number(report.failed) > 0) ? "partial" : "success",
        keywordsAttempted: Number(report.keyword_count) || 0,
        keywordsSucceeded: Number(report.succeeded) || 0,
        keywordsFailed: Number(report.failed) || 0,
        notes: `Latest audit push — ${report.total_rows} reports from ranking_reports (${reportDate})`,
      });
    } else {
      res.json(runRow ?? null);
    }
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/latest-detail", async (_req, res) => {
  try {
    const [row] = await db.execute(sql`
      SELECT
        date,
        platform,
        COUNT(DISTINCT keyword_id)::int as keywords,
        COUNT(*) FILTER (WHERE status = 'success')::int as succeeded,
        COUNT(*) FILTER (WHERE status = 'error')::int as failed
      FROM ranking_reports
      WHERE date = (SELECT MAX(date) FROM ranking_reports)
      GROUP BY date, platform
      ORDER BY platform
    `);

    const rows = row as Record<string, unknown>[];
    const date = rows[0]?.date as string ?? "";
    res.json({
      date,
      platforms: rows.map(r => ({
        platform: r.platform as string,
        keywords: r.keywords as number,
        succeeded: r.succeeded as number,
        failed: r.failed as number,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/latest-records", async (_req, res) => {
  try {
    const [row] = await db.execute(sql`
      SELECT
        rr.keyword_id,
        COALESCE(rr.keyword, k.keyword_text) as keyword_text,
        rr.platform,
        rr.ranking_position,
        COALESCE(rr.client_name, cl.business_name) as client_name,
        COALESCE(p.name, p.plan_type) as campaign_name
      FROM ranking_reports rr
      JOIN keywords k ON rr.keyword_id = k.id
      LEFT JOIN clients cl ON rr.client_id = cl.id
      LEFT JOIN client_aeo_plans p ON k.aeo_plan_id = p.id
      WHERE rr.date = (SELECT MAX(date) FROM ranking_reports)
      ORDER BY cl.business_name, k.keyword_text, rr.platform
    `);

    const rows = row as Record<string, unknown>[];
    res.json(rows.map(r => ({
      keywordId: r.keyword_id as number,
      keywordText: r.keyword_text as string,
      platform: r.platform as string,
      rankPosition: r.ranking_position as number | null,
      clientName: r.client_name as string | null,
      campaignName: r.campaign_name as string | null,
    })));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireExecutorToken, async (req, res) => {
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

router.patch("/:id", requireExecutorToken, async (req, res) => {
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

router.delete("/:id", requireExecutorToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [deleted] = await db
      .delete(rankingRunsTable)
      .where(eq(rankingRunsTable.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, deleted });
  } catch (err) {
    req.log.error({ err }, "Error deleting ranking run");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
