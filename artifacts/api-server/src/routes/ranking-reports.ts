import { Router } from "express";
import { db } from "@workspace/db";
import { rankingReportsTable, clientsTable, keywordsTable, businessesTable, clientAeoPlansTable } from "@workspace/db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { clientId, businessId, aeoPlanId, keywordId } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId)   conditions.push(eq(rankingReportsTable.clientId,   parseInt(clientId)));
    if (businessId) conditions.push(eq(rankingReportsTable.businessId, parseInt(businessId)));
    if (aeoPlanId)  conditions.push(eq(keywordsTable.aeoPlanId,        parseInt(aeoPlanId)));
    if (keywordId)  conditions.push(eq(rankingReportsTable.keywordId,  parseInt(keywordId)));

    const reports = await db
      .select({
        id: rankingReportsTable.id,
        clientId: rankingReportsTable.clientId,
        businessId: rankingReportsTable.businessId,
        keywordId: rankingReportsTable.keywordId,
        rankingPosition: rankingReportsTable.rankingPosition,
        reasonRecommended: rankingReportsTable.reasonRecommended,
        mapsPresence: rankingReportsTable.mapsPresence,
        mapsUrl: rankingReportsTable.mapsUrl,
        screenshotUrl: rankingReportsTable.screenshotUrl,
        textRanking: rankingReportsTable.textRanking,
        isInitialRanking: rankingReportsTable.isInitialRanking,
        platform: rankingReportsTable.platform,
        createdAt: rankingReportsTable.createdAt,
        clientName: clientsTable.businessName,
        businessName: businessesTable.name,
        keywordText: keywordsTable.keywordText,
        aeoPlanId: keywordsTable.aeoPlanId,
      })
      .from(rankingReportsTable)
      .leftJoin(clientsTable, eq(rankingReportsTable.clientId, clientsTable.id))
      .leftJoin(businessesTable, eq(rankingReportsTable.businessId, businessesTable.id))
      .leftJoin(keywordsTable, eq(rankingReportsTable.keywordId, keywordsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(rankingReportsTable.createdAt));

    res.json(reports);
  } catch (err) {
    req.log.error({ err }, "Error fetching ranking reports");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireExecutorToken, async (req, res) => {
  try {
    const body = req.body;

    // Upsert per (keywordId, platform, day): if a report already exists
    // for this keyword+platform today, update it instead of inserting a new row.
    // Prevents accidental duplicates from re-running the same batch.
    const existing = await db
      .select({ id: rankingReportsTable.id })
      .from(rankingReportsTable)
      .where(and(
        eq(rankingReportsTable.keywordId, body.keywordId),
        body.platform != null
          ? eq(rankingReportsTable.platform, body.platform)
          : sql`${rankingReportsTable.platform} IS NULL`,
        sql`DATE(${rankingReportsTable.createdAt}) = CURRENT_DATE`,
      ))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(rankingReportsTable)
        .set({
          rankingPosition: body.rankingPosition ?? null,
          reasonRecommended: body.reasonRecommended ?? null,
          mapsPresence: body.mapsPresence ?? null,
          mapsUrl: body.mapsUrl ?? null,
          isInitialRanking: body.isInitialRanking ?? false,
        })
        .where(eq(rankingReportsTable.id, existing[0].id))
        .returning();
      return res.status(200).json({ ...updated, upserted: true });
    }

    const [report] = await db
      .insert(rankingReportsTable)
      .values({
        clientId: body.clientId,
        businessId: body.businessId != null ? Number(body.businessId) : null,
        keywordId: body.keywordId,
        rankingPosition: body.rankingPosition ?? null,
        reasonRecommended: body.reasonRecommended ?? null,
        mapsPresence: body.mapsPresence ?? null,
        mapsUrl: body.mapsUrl ?? null,
        isInitialRanking: body.isInitialRanking ?? false,
        platform: body.platform ?? null,
      })
      .returning();
    res.status(201).json(report);
  } catch (err) {
    req.log.error({ err }, "Error creating ranking report");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/ranking-reports/dedupe — one-time cleanup: for each
   (keywordId, platform, day), keep only the latest row and delete older dupes. */
router.post("/dedupe", requireExecutorToken, async (req, res) => {
  try {
    const result = await db.execute(sql`
      DELETE FROM ranking_reports a
      USING ranking_reports b
      WHERE a.keyword_id = b.keyword_id
        AND (
          (a.platform = b.platform) OR
          (a.platform IS NULL AND b.platform IS NULL)
        )
        AND DATE(a.created_at) = DATE(b.created_at)
        AND a.id < b.id
      RETURNING a.id;
    `);
    const deletedCount = Array.isArray(result) ? result.length : (result?.rowCount ?? 0);
    res.json({ deletedRows: deletedCount });
  } catch (err) {
    req.log.error({ err }, "Error deduping ranking reports");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/ranking-reports/:id — update mapsUrl / mapsPresence / position */
router.patch("/:id", requireExecutorToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body;
    const updates: Record<string, unknown> = {};
    if (body.mapsUrl          !== undefined) updates.mapsUrl          = body.mapsUrl ?? null;
    if (body.mapsPresence     !== undefined) updates.mapsPresence     = body.mapsPresence;
    if (body.rankingPosition  !== undefined) updates.rankingPosition  = body.rankingPosition;
    if (body.reasonRecommended !== undefined) updates.reasonRecommended = body.reasonRecommended;
    if (body.screenshotUrl    !== undefined) updates.screenshotUrl    = body.screenshotUrl ?? null;
    if (body.textRanking      !== undefined) updates.textRanking      = body.textRanking ?? null;

    const [report] = await db
      .update(rankingReportsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(rankingReportsTable.id, id))
      .returning();
    if (!report) return res.status(404).json({ error: "Not found" });
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Error updating ranking report");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", requireExecutorToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [deleted] = await db
      .delete(rankingReportsTable)
      .where(eq(rankingReportsTable.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, deleted });
  } catch (err) {
    req.log.error({ err }, "Error deleting ranking report");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/ranking-reports/platform-summary
   Returns per-platform initial-vs-current comparison rows */
router.get("/platform-summary", async (req, res) => {
  try {
    const PLATFORMS = ["chatgpt", "gemini", "perplexity"] as const;
    const [clients, keywords, businesses, platformRows] = await Promise.all([
      db.select().from(clientsTable),
      db.select().from(keywordsTable),
      db.select().from(businessesTable),
      db
        .select({
          clientId: rankingReportsTable.clientId,
          keywordId: rankingReportsTable.keywordId,
          rankingPosition: rankingReportsTable.rankingPosition,
          isInitialRanking: rankingReportsTable.isInitialRanking,
          platform: rankingReportsTable.platform,
          createdAt: rankingReportsTable.createdAt,
        })
        .from(rankingReportsTable)
        .orderBy(asc(rankingReportsTable.createdAt)),
    ]);

    const clientMap   = new Map(clients.map((c) => [c.id, c]));
    const keywordMap  = new Map(keywords.map((k) => [k.id, k]));
    const businessMap = new Map(businesses.map((b) => [b.id, b]));

    // Build summary per platform
    const summary = PLATFORMS.map((platform) => {
      const rows = platformRows.filter((r) => r.platform === platform);

      // Group by clientId-keywordId
      const grouped = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = `${r.clientId}-${r.keywordId}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(r);
      }

      const comparisons = [...grouped.entries()].map(([, grpRows]) => {
        const initial = grpRows.find((r) => r.isInitialRanking) ?? grpRows[0];
        const current = grpRows[grpRows.length - 1];
        const client  = clientMap.get(initial.clientId);
        const keyword = keywordMap.get(initial.keywordId);
        const change  =
          initial?.rankingPosition != null && current?.rankingPosition != null
            ? initial.rankingPosition - current.rankingPosition
            : null;
        const business = keyword?.businessId != null ? businessMap.get(keyword.businessId) : null;
        return {
          clientId:        initial.clientId,
          clientName:      client?.businessName ?? `Client #${initial.clientId}`,
          businessId:      keyword?.businessId ?? null,
          businessName:    business?.name ?? null,
          aeoPlanId:       keyword?.aeoPlanId ?? null,
          keywordId:       initial.keywordId,
          keywordText:     keyword?.keywordText ?? `Keyword #${initial.keywordId}`,
          initialPosition: initial?.rankingPosition ?? null,
          currentPosition: current?.rankingPosition ?? null,
          positionChange:  change,
        };
      });

      const withData   = comparisons.filter((c) => c.currentPosition != null);
      const improving  = comparisons.filter((c) => (c.positionChange ?? 0) > 0);
      const declining  = comparisons.filter((c) => (c.positionChange ?? 0) < 0);
      const steady     = comparisons.filter((c) => c.positionChange === 0);
      const avgPos     = withData.length > 0
        ? Math.round(withData.reduce((s, c) => s + (c.currentPosition ?? 0), 0) / withData.length)
        : null;
      const topTen     = withData.filter((c) => (c.currentPosition ?? 99) <= 10);
      const bestKw     = withData.sort((a, b) => (a.currentPosition ?? 99) - (b.currentPosition ?? 99))[0] ?? null;

      return {
        platform,
        totalKeywords:  comparisons.length,
        withData:       withData.length,
        improving:      improving.length,
        steady:         steady.length,
        declining:      declining.length,
        avgCurrentRank: avgPos,
        topTenCount:    topTen.length,
        bestKeyword:    bestKw ? { text: bestKw.keywordText, position: bestKw.currentPosition, change: bestKw.positionChange } : null,
        keywords:       comparisons,
      };
    });

    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "Error fetching platform summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/ranking-reports/per-keyword-platform
   Returns per-keyword, per-platform latest ranking position.
   Shape: [{ keywordId, chatgpt, gemini, perplexity }] */
router.get("/per-keyword-platform", async (req, res) => {
  try {
    const allReports = await db
      .select({
        keywordId:       rankingReportsTable.keywordId,
        platform:        rankingReportsTable.platform,
        rankingPosition: rankingReportsTable.rankingPosition,
        createdAt:       rankingReportsTable.createdAt,
      })
      .from(rankingReportsTable)
      .orderBy(asc(rankingReportsTable.createdAt));

    // Group by keywordId + platform, keep only the latest
    const latest = new Map<string, { keywordId: number; platform: string; rankingPosition: number | null }>();
    for (const r of allReports) {
      if (!r.platform) continue;
      const key = `${r.keywordId}-${r.platform}`;
      latest.set(key, { keywordId: r.keywordId, platform: r.platform, rankingPosition: r.rankingPosition });
    }

    // Pivot: keywordId → { chatgpt, gemini, perplexity }
    const pivot = new Map<number, Record<string, number | null>>();
    for (const row of latest.values()) {
      if (!pivot.has(row.keywordId)) pivot.set(row.keywordId, {});
      pivot.get(row.keywordId)![row.platform] = row.rankingPosition;
    }

    const result = [...pivot.entries()].map(([keywordId, platforms]) => ({
      keywordId,
      chatgpt:    platforms["chatgpt"]    ?? null,
      gemini:     platforms["gemini"]     ?? null,
      perplexity: platforms["perplexity"] ?? null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error fetching per-keyword platform rankings");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/ranking-reports/period-comparison?period=weekly|monthly|quarterly|lifetime
   One row per (keyword × platform) with current window vs previous window.
   For lifetime, "previous" = first ever, "current" = latest ever. */
type PeriodKey = "weekly" | "monthly" | "quarterly" | "lifetime";

/* America/New_York midnight for the calendar date that contains `d`.
   Returns a UTC Date aligned to that ET midnight. EDT = UTC-4 (Mar–Nov),
   EST = UTC-5 (Nov–Mar). Uses Intl to get the correct offset for the date. */
function startOfDayET(d: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  /* ET wall-clock for `d`. Compute the offset (UTC minus ET) from the
     difference between ET wall-clock and UTC wall-clock of the same instant. */
  const etWall = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute), Number(map.second),
  );
  const offsetMs = etWall - d.getTime();
  /* ET midnight of that calendar date, expressed as a UTC instant. */
  const etMidnight = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day));
  return new Date(etMidnight - offsetMs);
}

function windowsFor(period: PeriodKey, now: Date): { curStart: Date; curEnd: Date; prevStart: Date; prevEnd: Date } {
  if (period === "weekly") {
    /* Biweekly windows aligned to ET midnight. "weekly" key kept for
       backwards-compat with the FE; semantically it's the last 14 days. */
    const todayStart = startOfDayET(now);
    const curStart = new Date(todayStart.getTime() - 14 * 24 * 60 * 60 * 1000);
    const curEnd   = new Date(todayStart.getTime() + 1  * 24 * 60 * 60 * 1000);
    const prevStart = new Date(curStart.getTime() - 14 * 24 * 60 * 60 * 1000);
    const prevEnd   = curStart;
    return { curStart, curEnd, prevStart, prevEnd };
  }
  if (period === "monthly") {
    const curStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const curEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevEnd = curStart;
    return { curStart, curEnd, prevStart, prevEnd };
  }
  // quarterly
  const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  const curStart = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1));
  const curEnd = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth + 3, 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth - 3, 1));
  const prevEnd = curStart;
  return { curStart, curEnd, prevStart, prevEnd };
}

router.get("/period-comparison", async (req, res) => {
  try {
    const period = ((req.query.period as string) ?? "weekly") as PeriodKey;
    if (!["weekly", "monthly", "quarterly", "lifetime"].includes(period)) {
      return res.status(400).json({ error: "Invalid period" });
    }
    const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : null;
    const businessId = req.query.businessId ? parseInt(req.query.businessId as string, 10) : null;
    const aeoPlanId = req.query.aeoPlanId ? parseInt(req.query.aeoPlanId as string, 10) : null;

    const isLifetime = period === "lifetime";
    const { curStart, curEnd, prevStart, prevEnd } = isLifetime
      ? { curStart: new Date(0), curEnd: new Date("9999-12-31"), prevStart: new Date(0), prevEnd: new Date("9999-12-31") }
      : windowsFor(period as Exclude<PeriodKey, "lifetime">, new Date());

    const [clients, keywords, businesses, plans, reports] = await Promise.all([
      db.select().from(clientsTable),
      db.select().from(keywordsTable),
      db.select().from(businessesTable),
      db.select().from(clientAeoPlansTable),
      db
        .select({
          id: rankingReportsTable.id,
          clientId: rankingReportsTable.clientId,
          businessId: rankingReportsTable.businessId,
          keywordId: rankingReportsTable.keywordId,
          rankingPosition: rankingReportsTable.rankingPosition,
          platform: rankingReportsTable.platform,
          createdAt: rankingReportsTable.createdAt,
        })
        .from(rankingReportsTable)
        .orderBy(asc(rankingReportsTable.createdAt)),
    ]);

    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const keywordMap = new Map(keywords.map((k) => [k.id, k]));
    const businessMap = new Map(businesses.map((b) => [b.id, b]));
    const planMap = new Map(plans.map((p) => [p.id, p]));

    // filter by cascade if provided, applied to the keyword, not the report
    const keywordAllowed = (kid: number): boolean => {
      const kw = keywordMap.get(kid);
      if (!kw) return false;
      if (clientId != null && kw.clientId !== clientId) return false;
      if (businessId != null && kw.businessId !== businessId) return false;
      if (aeoPlanId != null && kw.aeoPlanId !== aeoPlanId) return false;
      return true;
    };

    type PairKey = string; // `${keywordId}|${platform}`
    const latestInWindow = (from: Date, to: Date) => {
      const map = new Map<PairKey, typeof reports[number]>();
      for (const r of reports) {
        if (!r.platform) continue;
        if (!keywordAllowed(r.keywordId)) continue;
        const t = new Date(r.createdAt as unknown as string).getTime();
        if (t < from.getTime() || t >= to.getTime()) continue;
        const key = `${r.keywordId}|${r.platform}`;
        map.set(key, r); // reports are asc-ordered, so last wins
      }
      return map;
    };
    const everLatest = () => {
      const map = new Map<PairKey, typeof reports[number]>();
      for (const r of reports) {
        if (!r.platform) continue;
        if (!keywordAllowed(r.keywordId)) continue;
        const key = `${r.keywordId}|${r.platform}`;
        map.set(key, r);
      }
      return map;
    };

    // For lifetime, previous = first-ever, current = latest-ever per (keyword × platform)
    const firstEver = () => {
      const map = new Map<PairKey, typeof reports[number]>();
      for (const r of reports) {
        if (!r.platform) continue;
        if (!keywordAllowed(r.keywordId)) continue;
        const key = `${r.keywordId}|${r.platform}`;
        if (!map.has(key)) map.set(key, r); // reports are asc, first wins
      }
      return map;
    };

    const ever = everLatest();
    const current = isLifetime ? ever : latestInWindow(curStart, curEnd);
    const previous = isLifetime ? firstEver() : latestInWindow(prevStart, prevEnd);

    const allKeys = new Set<PairKey>([...current.keys(), ...previous.keys(), ...ever.keys()]);

    const rows = [...allKeys].map((key) => {
      const [kidStr, platform] = key.split("|");
      const keywordId = parseInt(kidStr, 10);
      const kw = keywordMap.get(keywordId);
      const client = kw ? clientMap.get(kw.clientId) : null;
      const business = kw?.businessId != null ? businessMap.get(kw.businessId) : null;
      const plan = kw?.aeoPlanId != null ? planMap.get(kw.aeoPlanId) : null;
      const cur = current.get(key);
      const prev = previous.get(key);
      const lastEver = ever.get(key);
      const change =
        cur?.rankingPosition != null && prev?.rankingPosition != null
          ? prev.rankingPosition - cur.rankingPosition
          : null;

      let status: "new" | "improved" | "steady" | "declined" | "missing" | "pending" = "pending";
      if (cur && !prev) status = "new";
      else if (cur && prev && change != null) {
        if (change > 0) status = "improved";
        else if (change < 0) status = "declined";
        else status = "steady";
      } else if (!cur && prev) status = "missing";
      else status = "pending";

      const lastRunAt = lastEver?.createdAt ?? null;
      let freshness: "fresh" | "stale" | "cold" | "never" = "never";
      if (cur) freshness = "fresh";
      else if (prev) freshness = "stale";
      else if (lastEver) freshness = "cold";

      return {
        keywordId,
        keywordText: kw?.keywordText ?? `Keyword #${keywordId}`,
        platform,
        clientId: kw?.clientId ?? null,
        clientName: client?.businessName ?? null,
        businessId: kw?.businessId ?? null,
        businessName: business?.name ?? null,
        aeoPlanId: kw?.aeoPlanId ?? null,
        campaignName: plan?.name ?? plan?.planType ?? null,
        currentReportId: cur?.id ?? null,
        currentPosition: cur?.rankingPosition ?? null,
        currentDate: cur?.createdAt ?? null,
        previousReportId: prev?.id ?? null,
        previousPosition: prev?.rankingPosition ?? null,
        previousDate: prev?.createdAt ?? null,
        change,
        status,
        freshness,
        lastRunAt,
      };
    });

    res.json({
      period,
      window: { currentStart: curStart, currentEnd: curEnd, previousStart: prevStart, previousEnd: prevEnd },
      rows,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching period comparison");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/initial-vs-current", async (req, res) => {
  try {
    const clients    = await db.select().from(clientsTable);
    const keywords   = await db.select().from(keywordsTable);
    const businesses = await db.select().from(businessesTable);
    const allReports = await db
      .select({
        id: rankingReportsTable.id,
        clientId: rankingReportsTable.clientId,
        keywordId: rankingReportsTable.keywordId,
        rankingPosition: rankingReportsTable.rankingPosition,
        isInitialRanking: rankingReportsTable.isInitialRanking,
        mapsPresence: rankingReportsTable.mapsPresence,
        mapsUrl: rankingReportsTable.mapsUrl,
        screenshotUrl: rankingReportsTable.screenshotUrl,
        textRanking: rankingReportsTable.textRanking,
        createdAt: rankingReportsTable.createdAt,
      })
      .from(rankingReportsTable)
      .orderBy(asc(rankingReportsTable.createdAt));

    const clientMap   = new Map(clients.map((c) => [c.id, c]));
    const keywordMap  = new Map(keywords.map((k) => [k.id, k]));
    const businessMap = new Map(businesses.map((b) => [b.id, b]));

    const grouped: Record<string, {
      clientId: number;
      clientName: string;
      businessId: number | null;
      businessName: string | null;
      aeoPlanId: number | null;
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
        const business = keyword.businessId != null ? businessMap.get(keyword.businessId) : null;
        grouped[key] = {
          clientId: report.clientId,
          clientName: client.businessName,
          businessId: keyword.businessId ?? null,
          businessName: business?.name ?? null,
          aeoPlanId: keyword.aeoPlanId ?? null,
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
        businessId:      g.businessId,
        businessName:    g.businessName,
        aeoPlanId:       g.aeoPlanId,
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
        screenshotUrl:   currentReport?.screenshotUrl ?? null,
        textRanking:     currentReport?.textRanking ?? null,
      };
    });

    res.json(comparisons);
  } catch (err) {
    req.log.error({ err }, "Error fetching initial vs current rankings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
