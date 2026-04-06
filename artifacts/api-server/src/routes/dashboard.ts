import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  sessionsTable,
  devicesTable,
  proxiesTable,
  rankingReportsTable,
} from "@workspace/db/schema";
import { eq, count, desc, sql, and, gte } from "drizzle-orm";

const router = Router();

router.get("/summary", async (req, res) => {
  try {
    // Fetch total and active clients (core metrics)
    let totalClientsNum = 0;
    let activeClientsNum = 0;
    try {
      const [totalClients] = await db.select({ count: count() }).from(clientsTable);
      const [activeClients] = await db
        .select({ count: count() })
        .from(clientsTable)
        .where(eq(clientsTable.status, "active"));
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
        .where(gte(sessionsTable.timestamp, today));
      const [totalSessions] = await db.select({ count: count() }).from(sessionsTable);
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

    // Fetch ranking reports
    let avgPosition = 0;
    try {
      const rankingReports = await db.select({ rankingPosition: rankingReportsTable.rankingPosition }).from(rankingReportsTable);
      const positions = rankingReports.map((r) => r.rankingPosition).filter((p): p is number => p != null);
      avgPosition = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : 0;
    } catch (rankErr) {
      req.log.warn({ rankErr }, "Failed to fetch ranking reports");
      avgPosition = 0;
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
    });
  }
});

router.get("/session-activity", async (req, res) => {
  try {
    const days = 14;
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const [total] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(and(gte(sessionsTable.timestamp, date), sql`${sessionsTable.timestamp} < ${nextDate}`));

      const [gemini] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(and(gte(sessionsTable.timestamp, date), sql`${sessionsTable.timestamp} < ${nextDate}`, eq(sessionsTable.aiPlatform, "gemini")));
      const [chatgpt] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(and(gte(sessionsTable.timestamp, date), sql`${sessionsTable.timestamp} < ${nextDate}`, eq(sessionsTable.aiPlatform, "chatgpt")));
      const [perplexity] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(and(gte(sessionsTable.timestamp, date), sql`${sessionsTable.timestamp} < ${nextDate}`, eq(sessionsTable.aiPlatform, "perplexity")));

      result.push({
        date: date.toISOString().split("T")[0],
        sessions: Number(total.count),
        gemini: Number(gemini.count),
        chatgpt: Number(chatgpt.count),
        perplexity: Number(perplexity.count),
      });
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error fetching session activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/platform-breakdown", async (req, res) => {
  try {
    const [total] = await db.select({ count: count() }).from(sessionsTable);
    const totalNum = Number(total.count);

    const [gemini] = await db.select({ count: count() }).from(sessionsTable).where(eq(sessionsTable.aiPlatform, "gemini"));
    const [chatgpt] = await db.select({ count: count() }).from(sessionsTable).where(eq(sessionsTable.aiPlatform, "chatgpt"));
    const [perplexity] = await db.select({ count: count() }).from(sessionsTable).where(eq(sessionsTable.aiPlatform, "perplexity"));

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

router.get("/network-health", async (req, res) => {
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [sessionsToday] = await db.select({ count: count() }).from(sessionsTable).where(gte(sessionsTable.timestamp, today));
    const sessionsPerHour = Number(sessionsToday.count) / Math.max(1, new Date().getHours() || 1);

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
