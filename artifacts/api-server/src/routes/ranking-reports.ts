import { Router } from "express";
import { db } from "@workspace/db";
import { rankingReportsTable, clientsTable, keywordsTable } from "@workspace/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { clientId, keywordId } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId) conditions.push(eq(rankingReportsTable.clientId, parseInt(clientId)));
    if (keywordId) conditions.push(eq(rankingReportsTable.keywordId, parseInt(keywordId)));

    const reports = await db
      .select({
        id: rankingReportsTable.id,
        clientId: rankingReportsTable.clientId,
        keywordId: rankingReportsTable.keywordId,
        rankingPosition: rankingReportsTable.rankingPosition,
        reasonRecommended: rankingReportsTable.reasonRecommended,
        mapsPresence: rankingReportsTable.mapsPresence,
        mapsUrl: rankingReportsTable.mapsUrl,
        isInitialRanking: rankingReportsTable.isInitialRanking,
        createdAt: rankingReportsTable.createdAt,
        clientName: clientsTable.businessName,
        keywordText: keywordsTable.keywordText,
      })
      .from(rankingReportsTable)
      .leftJoin(clientsTable, eq(rankingReportsTable.clientId, clientsTable.id))
      .leftJoin(keywordsTable, eq(rankingReportsTable.keywordId, keywordsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(rankingReportsTable.createdAt));

    res.json(reports);
  } catch (err) {
    req.log.error({ err }, "Error fetching ranking reports");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body;
    const [report] = await db
      .insert(rankingReportsTable)
      .values({
        clientId: body.clientId,
        keywordId: body.keywordId,
        rankingPosition: body.rankingPosition ?? null,
        reasonRecommended: body.reasonRecommended ?? null,
        mapsPresence: body.mapsPresence ?? null,
        mapsUrl: body.mapsUrl ?? null,
        isInitialRanking: body.isInitialRanking ?? false,
      })
      .returning();
    res.status(201).json(report);
  } catch (err) {
    req.log.error({ err }, "Error creating ranking report");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/ranking-reports/:id — update mapsUrl / mapsPresence / position */
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body;
    const updates: Record<string, unknown> = {};
    if (body.mapsUrl        !== undefined) updates.mapsUrl        = body.mapsUrl ?? null;
    if (body.mapsPresence   !== undefined) updates.mapsPresence   = body.mapsPresence;
    if (body.rankingPosition !== undefined) updates.rankingPosition = body.rankingPosition;
    if (body.reasonRecommended !== undefined) updates.reasonRecommended = body.reasonRecommended;

    const [report] = await db
      .update(rankingReportsTable)
      .set(updates as Parameters<typeof db.update>[0])
      .where(eq(rankingReportsTable.id, id))
      .returning();
    if (!report) return res.status(404).json({ error: "Not found" });
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Error updating ranking report");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/initial-vs-current", async (req, res) => {
  try {
    const clients = await db.select().from(clientsTable);
    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.tierLabel, "aeo"));
    const allReports = await db
      .select({
        id: rankingReportsTable.id,
        clientId: rankingReportsTable.clientId,
        keywordId: rankingReportsTable.keywordId,
        rankingPosition: rankingReportsTable.rankingPosition,
        isInitialRanking: rankingReportsTable.isInitialRanking,
        mapsPresence: rankingReportsTable.mapsPresence,
        mapsUrl: rankingReportsTable.mapsUrl,
        createdAt: rankingReportsTable.createdAt,
      })
      .from(rankingReportsTable)
      .orderBy(asc(rankingReportsTable.createdAt));

    const clientMap  = new Map(clients.map((c) => [c.id, c]));
    const keywordMap = new Map(keywords.map((k) => [k.id, k]));

    const grouped: Record<string, {
      clientId: number;
      clientName: string;
      keywordId: number;
      keywordText: string;
      reports: typeof allReports;
    }> = {};

    for (const report of allReports) {
      const key     = `${report.clientId}-${report.keywordId}`;
      const client  = clientMap.get(report.clientId);
      const keyword = keywordMap.get(report.keywordId);
      if (!client || !keyword) continue;
      if (!grouped[key]) {
        grouped[key] = {
          clientId: report.clientId,
          clientName: client.businessName,
          keywordId: report.keywordId,
          keywordText: keyword.keywordText,
          reports: [],
        };
      }
      grouped[key].reports.push(report);
    }

    const comparisons = Object.values(grouped).map((g) => {
      const initialReport = g.reports.find((r) => r.isInitialRanking) ?? g.reports[0];
      const currentReport = g.reports[g.reports.length - 1];
      const posChange =
        initialReport?.rankingPosition != null && currentReport?.rankingPosition != null
          ? initialReport.rankingPosition - currentReport.rankingPosition
          : null;
      return {
        clientId:        g.clientId,
        clientName:      g.clientName,
        keywordId:       g.keywordId,
        keywordText:     g.keywordText,
        currentReportId: currentReport?.id ?? null,
        initialDate:     initialReport?.createdAt ?? null,
        initialPosition: initialReport?.rankingPosition ?? null,
        currentDate:     currentReport?.createdAt ?? null,
        currentPosition: currentReport?.rankingPosition ?? null,
        positionChange:  posChange,
        isInTopTen:      currentReport?.rankingPosition != null && currentReport.rankingPosition <= 10,
        mapsPresence:    currentReport?.mapsPresence ?? null,
        mapsUrl:         currentReport?.mapsUrl ?? null,
      };
    });

    res.json(comparisons);
  } catch (err) {
    req.log.error({ err }, "Error fetching initial vs current rankings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
