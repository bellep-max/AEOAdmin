import { db } from "@workspace/db";
import { clientsTable, sessionsTable, devicesTable, proxiesTable, rankingReportsTable } from "@workspace/db/schema";
import { eq, count, gte, and, sql } from "drizzle-orm";

export async function getSummary() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Run all independent queries in parallel
  const [
    [totalClients],
    [activeClients],
    [sessionsToday],
    [totalSessions],
    devices,
    [proxyCount],
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
  const availableDevices = devices.filter((d) => d.status === "available").length;
  const totalDevices = devices.length;
  const totalProxiesNum = Number(proxyCount.count);

  const positions = rankingPositions.map((r) => r.rankingPosition).filter((p): p is number => p != null);
  const avgPosition = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : 0;

  const networkHealthScore = totalDevices > 0
    ? Math.min(100, Math.round((availableDevices / totalDevices) * 100 * 0.4 + 60))
    : 60;

  return {
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
  };
}

// Fixed: single query with GROUP BY instead of 56 individual queries
export async function getSessionActivity(days = 14) {
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

  // Build date range and fill in data
  const dateRange = Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - i));
    return date.toISOString().split("T")[0];
  });

  const grouped = new Map<string, { gemini: number; chatgpt: number; perplexity: number; sessions: number }>();
  for (const dateStr of dateRange) {
    grouped.set(dateStr, { gemini: 0, chatgpt: 0, perplexity: 0, sessions: 0 });
  }
  for (const row of rows) {
    const dateStr = String(row.date);
    const entry = grouped.get(dateStr);
    if (!entry) continue;
    const cnt = Number(row.count);
    entry.sessions += cnt;
    if (row.platform === "gemini") entry.gemini = cnt;
    else if (row.platform === "chatgpt") entry.chatgpt = cnt;
    else if (row.platform === "perplexity") entry.perplexity = cnt;
  }

  return dateRange.map((date) => ({ date, ...grouped.get(date)! }));
}

export async function getPlatformBreakdown() {
  const rows = await db
    .select({
      platform: sessionsTable.aiPlatform,
      count: count(),
    })
    .from(sessionsTable)
    .groupBy(sessionsTable.aiPlatform);

  const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
  const platforms = ["gemini", "chatgpt", "perplexity"];

  return platforms.map((p) => {
    const row = rows.find((r) => r.platform === p);
    const cnt = row ? Number(row.count) : 0;
    return {
      platform: p.charAt(0).toUpperCase() + p.slice(1),
      count: cnt,
      percentage: total > 0 ? (cnt / total) * 100 : 33.3,
    };
  });
}

export async function getNetworkHealth() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [devices, [proxyCount], [sessionsToday]] = await Promise.all([
    db.select().from(devicesTable),
    db.select({ count: count() }).from(proxiesTable),
    db.select({ count: count() }).from(sessionsTable).where(gte(sessionsTable.timestamp, today)),
  ]);

  const online = devices.filter((d) => d.status !== "offline").length;
  const offline = devices.filter((d) => d.status === "offline").length;
  const inUse = devices.filter((d) => d.status === "in_use").length;
  const total = devices.length;
  const score = total > 0 ? Math.min(100, Math.round((online / total) * 100 * 0.6 + 40)) : 60;
  const sessionsPerHour = Number(sessionsToday.count) / Math.max(1, new Date().getHours() || 1);

  return {
    score,
    devicesOnline: online,
    devicesOffline: offline,
    devicesInUse: inUse,
    activeProxies: Number(proxyCount.count),
    sessionsPerHour: Math.round(sessionsPerHour * 10) / 10,
    uptime: 0.99,
  };
}
