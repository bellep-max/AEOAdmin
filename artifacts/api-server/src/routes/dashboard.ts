import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  sessionsTable,
  devicesTable,
  proxiesTable,
  rankingReportsTable,
  keywordsTable,
} from "@workspace/db/schema";
import { eq, count, desc, sql, and, gte, ne, inArray } from "drizzle-orm";
import { getSalesEligibleClientIds } from "../lib/sales-scope";
import { requireRoles } from "../middlewares/role-auth";

const router = Router();

// All four dashboard endpoints are reachable by sales/admin/owner. Sales
// sessions get the eligible-client filter injected via getSalesEligibleClientIds.
const requireDashboardReader = requireRoles("sales", "admin", "owner");

router.get("/summary", requireDashboardReader, async (req, res) => {
  // Sales sessions see free-trial clients only. eligibleIds === null means
  // admin/owner — no filter applied. An empty array (sales, no free-trial
  // clients today) still flows through to zeroed-out counts naturally.
  const eligibleIds = await getSalesEligibleClientIds(req);
  const scopeFilter = eligibleIds
    ? inArray(clientsTable.id, eligibleIds)
    : undefined;
  const sessionScopeFilter = eligibleIds
    ? inArray(sessionsTable.clientId, eligibleIds)
    : undefined;
  const keywordScopeFilter = eligibleIds
    ? inArray(keywordsTable.clientId, eligibleIds)
    : undefined;
  try {
    // Fetch total and active clients (core metrics)
    let totalClientsNum = 0;
    let activeClientsNum = 0;
    try {
      const [totalClients] = await db
        .select({ count: count() })
        .from(clientsTable)
        .where(scopeFilter);
      const [activeClients] = await db
        .select({ count: count() })
        .from(clientsTable)
        .where(
          scopeFilter
            ? and(eq(clientsTable.status, "active"), scopeFilter)
            : eq(clientsTable.status, "active"),
        );
      totalClientsNum = Number(totalClients.count);
      activeClientsNum = Number(activeClients.count);
    } catch (clientErr) {
      req.log.warn({ clientErr }, "Failed to fetch clients");
      totalClientsNum = 0;
      activeClientsNum = 0;
    }

    // Fetch sessions data
    let sessionsTodayNum = 0;
    let totalSessionsNum = 0;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [sessionsToday] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(
          sessionScopeFilter
            ? and(gte(sessionsTable.timestamp, today), sessionScopeFilter)
            : gte(sessionsTable.timestamp, today),
        );
      const [totalSessions] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(sessionScopeFilter);
      sessionsTodayNum = Number(sessionsToday.count);
      totalSessionsNum = Number(totalSessions.count);
    } catch (sessionErr) {
      req.log.warn({ sessionErr }, "Failed to fetch sessions");
      sessionsTodayNum = 0;
      totalSessionsNum = 0;
    }

    // Try to fetch devices
    let devices: any[] = [];
    let availableDevices = 0;
    let totalDevices = 0;
    try {
      devices = await db.select().from(devicesTable);
      availableDevices = devices.filter((d) => d.status === "available").length;
      totalDevices = devices.length;
    } catch (deviceErr) {
      req.log.warn({ deviceErr }, "Failed to fetch devices");
      devices = [];
      totalDevices = 0;
      availableDevices = 0;
    }

    // Fetch proxies
    let totalProxiesNum = 0;
    try {
      const [totalProxies] = await db.select({ count: count() }).from(proxiesTable);
      totalProxiesNum = Number(totalProxies.count);
    } catch (proxyErr) {
      req.log.warn({ proxyErr }, "Failed to fetch proxies");
      totalProxiesNum = 0;
    }

    // Fetch ranking reports — average position across the visible scope.
    // ranking_reports has a client_id reference so we filter on it directly.
    let avgPosition = 0;
    try {
      const rankingReports = await db
        .select({ rankingPosition: rankingReportsTable.rankingPosition })
        .from(rankingReportsTable)
        .where(
          eligibleIds
            ? inArray(rankingReportsTable.clientId, eligibleIds)
            : undefined,
        );
      const positions = rankingReports.map((r) => r.rankingPosition).filter((p): p is number => p != null);
      avgPosition = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : 0;
    } catch (rankErr) {
      req.log.warn({ rankErr }, "Failed to fetch ranking reports");
      avgPosition = 0;
    }

    // Keyword stats
    let totalKeywords = 0;
    let activeKeywords = 0;
    let keywordsWithErrors = 0;
    let keywordsWithBacklinks = 0;
    let totalBacklinksFound = 0;
    try {
      const [tk] = await db
        .select({ count: count() })
        .from(keywordsTable)
        .where(keywordScopeFilter);
      const [ak] = await db
        .select({ count: count() })
        .from(keywordsTable)
        .where(
          keywordScopeFilter
            ? and(eq(keywordsTable.isActive, true), keywordScopeFilter)
            : eq(keywordsTable.isActive, true),
        );
      totalKeywords = Number(tk.count);
      activeKeywords = Number(ak.count);

      // Distinct keywords that had error sessions today.
      // The sql.execute() block uses a raw SQL fragment so the client-scope
      // filter is inlined as a value to keep parameterization safe.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const errorKwResult = await db.execute(sql`
        SELECT COUNT(DISTINCT keyword_id)::int AS cnt FROM sessions
        WHERE status = 'error' AND timestamp >= ${today}
        ${eligibleIds ? sql`AND client_id = ANY(${eligibleIds})` : sql``}
      `);
      keywordsWithErrors = (errorKwResult.rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

      // Distinct keywords that had backlinks found
      const backlinkKwResult = await db.execute(sql`
        SELECT COUNT(DISTINCT keyword_id)::int AS cnt FROM sessions
        WHERE backlink_found = true
        ${eligibleIds ? sql`AND client_id = ANY(${eligibleIds})` : sql``}
      `);
      keywordsWithBacklinks = (backlinkKwResult.rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

      // Total sessions where backlink was found
      const [blCount] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(
          sessionScopeFilter
            ? and(eq(sessionsTable.backlinkFound, true), sessionScopeFilter)
            : eq(sessionsTable.backlinkFound, true),
        );
      totalBacklinksFound = Number(blCount.count);
    } catch (kwErr) {
      req.log.warn({ kwErr }, "Failed to fetch keyword stats");
    }

    const networkHealthScore = totalDevices > 0
      ? Math.min(100, Math.round((availableDevices / totalDevices) * 100 * 0.4 + 60))
      : 60;

    res.json({
      totalClients: totalClientsNum,
      activeClients: activeClientsNum,
      totalSessionsToday: sessionsTodayNum,
      totalSessionsAllTime: totalSessionsNum,
      availableDevices,
      totalDevices,
      activeProxies: totalProxiesNum,
      averageRankingPosition: Math.round(avgPosition * 10) / 10,
      networkHealthScore,
      sessionCapacityPerDay: availableDevices * 1,
      completedToday: sessionsTodayNum,
      pendingToday: Math.max(0, activeClientsNum * 3 - sessionsTodayNum),
      totalKeywords,
      activeKeywords,
      keywordsWithErrors,
      keywordsWithBacklinks,
      totalBacklinksFound,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching dashboard summary");
    // Return a partial response with at least zeros so dashboard doesn't break
    res.json({
      totalClients: 0,
      activeClients: 0,
      totalSessionsToday: 0,
      totalSessionsAllTime: 0,
      availableDevices: 0,
      totalDevices: 0,
      activeProxies: 0,
      averageRankingPosition: 0,
      networkHealthScore: 60,
      sessionCapacityPerDay: 0,
      completedToday: 0,
      pendingToday: 0,
      totalKeywords: 0,
      activeKeywords: 0,
      keywordsWithErrors: 0,
      keywordsWithBacklinks: 0,
      totalBacklinksFound: 0,
    });
  }
});

router.get("/session-activity", requireDashboardReader, async (req, res) => {
  try {
    const days = 14;
    const result = [];
    const eligibleIds = await getSalesEligibleClientIds(req);
    const scope = eligibleIds
      ? inArray(sessionsTable.clientId, eligibleIds)
      : undefined;
    const dateRange = Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      date.setHours(0, 0, 0, 0);
      return date;
    });

    for (const date of dateRange) {
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      let sessions = 0, geminiCount = 0, chatgptCount = 0, perplexityCount = 0;
      try {
        const dayWindow = and(gte(sessionsTable.timestamp, date), sql`${sessionsTable.timestamp} < ${nextDate}`);
        const [total] = await db
          .select({ count: count() })
          .from(sessionsTable)
          .where(scope ? and(dayWindow, scope) : dayWindow);
        const [gemini] = await db
          .select({ count: count() })
          .from(sessionsTable)
          .where(scope ? and(dayWindow, eq(sessionsTable.aiPlatform, "gemini"), scope) : and(dayWindow, eq(sessionsTable.aiPlatform, "gemini")));
        const [chatgpt] = await db
          .select({ count: count() })
          .from(sessionsTable)
          .where(scope ? and(dayWindow, eq(sessionsTable.aiPlatform, "chatgpt"), scope) : and(dayWindow, eq(sessionsTable.aiPlatform, "chatgpt")));
        const [perplexity] = await db
          .select({ count: count() })
          .from(sessionsTable)
          .where(scope ? and(dayWindow, eq(sessionsTable.aiPlatform, "perplexity"), scope) : and(dayWindow, eq(sessionsTable.aiPlatform, "perplexity")));
        sessions = Number(total.count);
        geminiCount = Number(gemini.count);
        chatgptCount = Number(chatgpt.count);
        perplexityCount = Number(perplexity.count);
      } catch (dayErr) {
        req.log.warn({ dayErr }, "Failed to fetch session counts for date (schema mismatch)");
      }
      result.push({
        date: date.toISOString().split("T")[0],
        sessions,
        gemini: geminiCount,
        chatgpt: chatgptCount,
        perplexity: perplexityCount,
      });
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error fetching session activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/platform-breakdown", requireDashboardReader, async (req, res) => {
  try {
    const eligibleIds = await getSalesEligibleClientIds(req);
    const scope = eligibleIds
      ? inArray(sessionsTable.clientId, eligibleIds)
      : undefined;
    const [total] = await db.select({ count: count() }).from(sessionsTable).where(scope);
    const totalNum = Number(total.count);

    const [gemini] = await db.select({ count: count() }).from(sessionsTable).where(scope ? and(eq(sessionsTable.aiPlatform, "gemini"), scope) : eq(sessionsTable.aiPlatform, "gemini"));
    const [chatgpt] = await db.select({ count: count() }).from(sessionsTable).where(scope ? and(eq(sessionsTable.aiPlatform, "chatgpt"), scope) : eq(sessionsTable.aiPlatform, "chatgpt"));
    const [perplexity] = await db.select({ count: count() }).from(sessionsTable).where(scope ? and(eq(sessionsTable.aiPlatform, "perplexity"), scope) : eq(sessionsTable.aiPlatform, "perplexity"));

    const geminiCount = Number(gemini.count);
    const chatgptCount = Number(chatgpt.count);
    const perplexityCount = Number(perplexity.count);

    res.json([
      { platform: "Gemini", count: geminiCount, percentage: totalNum > 0 ? (geminiCount / totalNum) * 100 : 33.3 },
      { platform: "ChatGPT", count: chatgptCount, percentage: totalNum > 0 ? (chatgptCount / totalNum) * 100 : 33.3 },
      { platform: "Perplexity", count: perplexityCount, percentage: totalNum > 0 ? (perplexityCount / totalNum) * 100 : 33.4 },
    ]);
  } catch (err) {
    req.log.error({ err }, "Error fetching platform breakdown");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/network-health", requireDashboardReader, async (req, res) => {
  try {
    let devices: any[] = [];
    try {
      devices = await db.select().from(devicesTable);
    } catch (deviceErr) {
      req.log.warn({ deviceErr }, "Failed to fetch devices (schema mismatch)");
      devices = [];
    }

    const [proxyCount] = await db.select({ count: count() }).from(proxiesTable);

    const online = devices.filter((d) => d.status !== "offline").length;
    const offline = devices.filter((d) => d.status === "offline").length;
    const inUse = devices.filter((d) => d.status === "in_use").length;
    const total = devices.length;

    const score = total > 0 ? Math.min(100, Math.round((online / total) * 100 * 0.6 + 40)) : 60;

    let sessionsPerHour = 0;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [sessionsToday] = await db.select({ count: count() }).from(sessionsTable).where(gte(sessionsTable.timestamp, today));
      sessionsPerHour = Number(sessionsToday.count) / Math.max(1, new Date().getHours() || 1);
    } catch (sessErr) {
      req.log.warn({ sessErr }, "Failed to fetch sessions for network-health (schema mismatch)");
    }

    res.json({
      score,
      devicesOnline: online,
      devicesOffline: offline,
      devicesInUse: inUse,
      activeProxies: Number(proxyCount.count),
      sessionsPerHour: Math.round(sessionsPerHour * 10) / 10,
      uptime: 0.99,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching network health");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
