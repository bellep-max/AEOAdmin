import { Router } from "express";
import { db } from "@workspace/db";
import { sessionsTable, insertSessionSchema, clientsTable, keywordsTable, devicesTable, proxiesTable } from "@workspace/db/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { clientId, deviceId, aiPlatform, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId) conditions.push(eq(sessionsTable.clientId, parseInt(clientId)));
    if (deviceId) conditions.push(eq(sessionsTable.deviceId, parseInt(deviceId)));
    if (aiPlatform) conditions.push(eq(sessionsTable.aiPlatform, aiPlatform as typeof sessionsTable.aiPlatform.enumValues[number]));

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

    ok(res, {
      sessions: sessions.map((s) => ({ ...s, durationSeconds: null })),
      total: Number(totalResult.count),
      offset: off,
      limit: lim,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching sessions");
    serverError(res);
  }
});

router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertSessionSchema);
    if (!data) return;

    const [session] = await db
      .insert(sessionsTable)
      .values(data)
      .returning();
    created(res, session);
  } catch (err) {
    req.log.error({ err }, "Error creating session");
    serverError(res);
  }
});

// /stress-test BEFORE /:id routes
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

    ok(res, {
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
    serverError(res);
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
    if (!updated) return notFound(res, "Session not found");
    ok(res, updated);
  } catch (err) {
    req.log.error({ err }, "Error updating session screenshot");
    serverError(res);
  }
});

router.patch("/:id/followup", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { followupText } = req.body;
    if (typeof followupText !== "string") {
      return badRequest(res, "followupText must be a string");
    }
    const [updated] = await db
      .update(sessionsTable)
      .set({ followupText: followupText.trim() || null })
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!updated) return notFound(res, "Session not found");
    ok(res, updated);
  } catch (err) {
    req.log.error({ err }, "Error updating session followup");
    serverError(res);
  }
});

export default router;
