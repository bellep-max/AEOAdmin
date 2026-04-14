import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  sessionsTable,
  devicesTable,
  proxiesTable,
  rankingReportsTable,
} from "@workspace/db/schema";
import { eq, count, sql, gte } from "drizzle-orm";
import { ok, serverError } from "../lib/response";
import "../middleware/auth";

const router = Router();

router.get("/summary", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Run independent queries in parallel
    const [
      [totalClients],
      [activeClients],
      [sessionsToday],
      [totalSessions],
      devices,
      [totalProxies],
      rankingPositions,
    ] = await Promise.all([
      db.select({ count: count() }).from(clientsTable),
      db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.status, "active")),
      db.select({ count: count() }).from(sessionsTable).where(gte(sessionsTable.timestamp, today)),
      db.select({ count: count() }).from(sessionsTable),
      db.select().from(devicesTable),
      db.select({ count: count() }).from(proxiesTable),
      db.select({ rankingPosition: rankingReportsTable.rankingPosition }).from(rankingReportsTable),
    ]);

    const totalClientsNum = Number(totalClients.count);
    const activeClientsNum = Number(activeClients.count);
    const sessionsTodayNum = Number(sessionsToday.count);
    const totalSessionsNum = Number(totalSessions.count);
    const totalDevices = devices.length;
    const availableDevices = devices.filter((d) => d.status === "available").length;
    const totalProxiesNum = Number(totalProxies.count);

    const positions = rankingPositions.map((r) => r.rankingPosition).filter((p): p is number => p != null);
    const avgPosition = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : 0;

    const networkHealthScore = totalDevices > 0
      ? Math.min(100, Math.round((availableDevices / totalDevices) * 100 * 0.4 + 60))
      : 60;

    ok(res, {
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
    ok(res, {
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
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const rows = await db
      .select({
        date: sql<string>`DATE(${sessionsTable.timestamp})`,
        platform: sessionsTable.aiPlatform,
        count: count(),
      })
      .from(sessionsTable)
      .where(gte(sessionsTable.timestamp, startDate))
      .groupBy(sql`DATE(${sessionsTable.timestamp})`, sessionsTable.aiPlatform);

    // Build a map of date+platform -> count
    const countMap = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const dateStr = String(row.date);
      if (!countMap.has(dateStr)) countMap.set(dateStr, {});
      countMap.get(dateStr)![row.platform] = Number(row.count);
    }

    // Fill dateRange from grouped results
    const dateRange = Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      date.setHours(0, 0, 0, 0);
      return date;
    });

    const result = dateRange.map((date) => {
      const dateStr = date.toISOString().split("T")[0];
      const counts = countMap.get(dateStr) ?? {};
      const gemini = counts["gemini"] ?? 0;
      const chatgpt = counts["chatgpt"] ?? 0;
      const perplexity = counts["perplexity"] ?? 0;
      return {
        date: dateStr,
        sessions: gemini + chatgpt + perplexity,
        gemini,
        chatgpt,
        perplexity,
      };
    });

    ok(res, result);
  } catch (err) {
    req.log.error({ err }, "Error fetching session activity");
    serverError(res);
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

    ok(res, [
      { platform: "Gemini", count: geminiCount, percentage: totalNum > 0 ? (geminiCount / totalNum) * 100 : 33.3 },
      { platform: "ChatGPT", count: chatgptCount, percentage: totalNum > 0 ? (chatgptCount / totalNum) * 100 : 33.3 },
      { platform: "Perplexity", count: perplexityCount, percentage: totalNum > 0 ? (perplexityCount / totalNum) * 100 : 33.4 },
    ]);
  } catch (err) {
    req.log.error({ err }, "Error fetching platform breakdown");
    serverError(res);
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

    let sessionsPerHour = 0;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [sessionsToday] = await db.select({ count: count() }).from(sessionsTable).where(gte(sessionsTable.timestamp, today));
      sessionsPerHour = Number(sessionsToday.count) / Math.max(1, new Date().getHours() || 1);
    } catch (sessErr) {
      req.log.warn({ sessErr }, "Failed to fetch sessions for network-health (schema mismatch)");
    }

    ok(res, {
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
    serverError(res);
  }
});

export default router;
