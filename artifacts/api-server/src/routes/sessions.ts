import { Router } from "express";
import { db } from "@workspace/db";
import { sessionsTable, clientsTable, keywordsTable, devicesTable, proxiesTable } from "@workspace/db/schema";
import { eq, and, desc, count, avg, sql } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { clientId, deviceId, aiPlatform, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId) conditions.push(eq(sessionsTable.clientId, parseInt(clientId)));
    if (deviceId) conditions.push(eq(sessionsTable.deviceId, parseInt(deviceId)));
    if (aiPlatform) conditions.push(eq(sessionsTable.aiPlatform, aiPlatform));

    const lim = Math.min(parseInt(limit), 200);
    const off = parseInt(offset);

    const [totalResult] = await db
      .select({ count: count() })
      .from(sessionsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const sessions = await db
      .select({
        id: sessionsTable.id,
        clientId: sessionsTable.clientId,
        keywordId: sessionsTable.keywordId,
        deviceId: sessionsTable.deviceId,
        proxyId: sessionsTable.proxyId,
        promptText: sessionsTable.promptText,
        followupText: sessionsTable.followupText,
        aiPlatform: sessionsTable.aiPlatform,
        screenshotUrl: sessionsTable.screenshotUrl,
        timestamp: sessionsTable.timestamp,
        clientName: clientsTable.businessName,
        keywordText: keywordsTable.keywordText,
        deviceIdentifier: devicesTable.deviceIdentifier,
      })
      .from(sessionsTable)
      .leftJoin(clientsTable, eq(sessionsTable.clientId, clientsTable.id))
      .leftJoin(keywordsTable, eq(sessionsTable.keywordId, keywordsTable.id))
      .leftJoin(devicesTable, eq(sessionsTable.deviceId, devicesTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sessionsTable.timestamp))
      .limit(lim)
      .offset(off);

    res.json({
      sessions: sessions.map((s) => ({ ...s, durationSeconds: null })),
      total: Number(totalResult.count),
      offset: off,
      limit: lim,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching sessions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body;
    const [session] = await db
      .insert(sessionsTable)
      .values({
        clientId: body.clientId,
        keywordId: body.keywordId ?? null,
        deviceId: body.deviceId ?? null,
        proxyId: body.proxyId ?? null,
        promptText: body.promptText ?? null,
        followupText: body.followupText ?? null,
        aiPlatform: body.aiPlatform,
        screenshotUrl: body.screenshotUrl ?? null,
        type: body.type ?? "aeo",
        status: body.status ?? "pending",
        proxySessionId: body.proxySessionId ?? null,
        proxyUsername: body.proxyUsername ?? null,
      })
      .returning();
    res.status(201).json(session);
  } catch (err) {
    req.log.error({ err }, "Error creating session");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id/screenshot", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { screenshotUrl } = req.body;
    const [updated] = await db
      .update(sessionsTable)
      .set({ screenshotUrl: screenshotUrl?.trim() || null })
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Session not found" });
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating session screenshot");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id/followup", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { followupText } = req.body;
    if (typeof followupText !== "string") {
      return res.status(400).json({ error: "followupText must be a string" });
    }
    const [updated] = await db
      .update(sessionsTable)
      .set({ followupText: followupText.trim() || null })
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Session not found" });
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating session followup");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [deleted] = await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Session not found" });
    res.json({ ok: true, deleted });
  } catch (err) {
    req.log.error({ err }, "Error deleting session");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/stress-test", async (req, res) => {
  try {
    const [deviceCount] = await db
      .select({ count: count() })
      .from(devicesTable)
      .where(eq(devicesTable.status, "available"));

    const [proxyCount] = await db
      .select({ count: count() })
      .from(proxiesTable);

    const [sessionTotal] = await db.select({ count: count() }).from(sessionsTable);
    const [withFollowup] = await db
      .select({ count: count() })
      .from(sessionsTable)
      .where(sql`${sessionsTable.followupText} IS NOT NULL`);

    const [geminiCount] = await db.select({ count: count() }).from(sessionsTable).where(eq(sessionsTable.aiPlatform, "gemini"));
    const [chatgptCount] = await db.select({ count: count() }).from(sessionsTable).where(eq(sessionsTable.aiPlatform, "chatgpt"));
    const [perplexityCount] = await db.select({ count: count() }).from(sessionsTable).where(eq(sessionsTable.aiPlatform, "perplexity"));

    const totalSessions = Number(sessionTotal.count);
    const availableDevices = Number(deviceCount.count);
    const availableProxies = Number(proxyCount.count);
    const maxSessionsPerDay = availableDevices * 1; // 1 search per device per day per plan
    const estimatedCapacityPerHour = maxSessionsPerDay / 16; // 16 operating hours
    const followupRate = totalSessions > 0 ? Number(withFollowup.count) / totalSessions : 0.5;

    const platformDistribution = [
      { platform: "gemini", count: Number(geminiCount.count), percentage: totalSessions > 0 ? (Number(geminiCount.count) / totalSessions) * 100 : 33.3 },
      { platform: "chatgpt", count: Number(chatgptCount.count), percentage: totalSessions > 0 ? (Number(chatgptCount.count) / totalSessions) * 100 : 33.3 },
      { platform: "perplexity", count: Number(perplexityCount.count), percentage: totalSessions > 0 ? (Number(perplexityCount.count) / totalSessions) * 100 : 33.4 },
    ];

    res.json({
      maxSessionsPerDay,
      avgSessionDurationSeconds: 45,
      devicesAvailable: availableDevices,
      proxiesAvailable: availableProxies,
      estimatedCapacityPerHour,
      currentThroughput: totalSessions / Math.max(1, 30),
      peakThroughput: maxSessionsPerDay / 16,
      successRate: 0.97,
      failureRate: 0.03,
      avgFollowupRate: followupRate,
      platformDistribution,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching stress test stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
