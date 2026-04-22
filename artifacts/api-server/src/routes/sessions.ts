import { Router } from "express";
import { db } from "@workspace/db";
import {
  sessionsTable,
  clientsTable,
  businessesTable,
  clientAeoPlansTable,
  keywordsTable,
  devicesTable,
  proxiesTable,
} from "@workspace/db/schema";
import { eq, and, desc, count, sql, gte, lte } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";

const router = Router();

/* ────────────────────────────────────────────────────────────
   GET /api/sessions
   Daily session log listing with filters + pagination.
──────────────────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    const {
      clientId,
      businessId,
      campaignId,
      deviceId,
      platform,
      status,
      from,
      to,
      limit = "50",
      offset = "0",
    } = req.query as Record<string, string>;

    const conditions = [] as ReturnType<typeof eq>[];
    if (clientId)   conditions.push(eq(sessionsTable.clientId,   parseInt(clientId)));
    if (businessId) conditions.push(eq(sessionsTable.businessId, parseInt(businessId)));
    if (campaignId) conditions.push(eq(sessionsTable.campaignId, parseInt(campaignId)));
    if (deviceId)   conditions.push(eq(sessionsTable.deviceId,   parseInt(deviceId)));
    if (platform)   conditions.push(eq(sessionsTable.aiPlatform, platform));
    if (status)     conditions.push(eq(sessionsTable.status,     status));
    if (from)       conditions.push(gte(sessionsTable.timestamp, new Date(from)));
    if (to)         conditions.push(lte(sessionsTable.timestamp, new Date(to)));

    const lim = Math.min(parseInt(limit), 200);
    const off = parseInt(offset);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(sessionsTable)
      .where(where);

    const sessions = await db
      .select({
        id:               sessionsTable.id,
        clientId:         sessionsTable.clientId,
        businessId:       sessionsTable.businessId,
        campaignId:       sessionsTable.campaignId,
        keywordId:        sessionsTable.keywordId,
        deviceId:         sessionsTable.deviceId,
        proxyId:          sessionsTable.proxyId,
        clientName:       sessionsTable.clientName,
        bizName:          sessionsTable.bizName,
        campaignName:     sessionsTable.campaignName,
        keywordText:      sessionsTable.keywordText,
        city:             sessionsTable.city,
        state:            sessionsTable.state,
        date:             sessionsTable.date,
        timestamp:        sessionsTable.timestamp,
        durationSeconds:  sessionsTable.durationSeconds,
        promptText:       sessionsTable.promptText,
        followupText:     sessionsTable.followupText,
        hasFollowUp:      sessionsTable.hasFollowUp,
        status:           sessionsTable.status,
        type:             sessionsTable.type,
        errorClass:       sessionsTable.errorClass,
        errorMessage:     sessionsTable.errorMessage,
        aiPlatform:       sessionsTable.aiPlatform,
        screenshotUrl:    sessionsTable.screenshotUrl,
        deviceIdentifier: sessionsTable.deviceIdentifier,
        proxyStatus:      sessionsTable.proxyStatus,
        proxySessionId:   sessionsTable.proxySessionId,
        proxyUsername:    sessionsTable.proxyUsername,
        proxyHost:        sessionsTable.proxyHost,
        proxyPort:        sessionsTable.proxyPort,
        proxyIp:          sessionsTable.proxyIp,
        proxyCity:        sessionsTable.proxyCity,
        proxyRegion:      sessionsTable.proxyRegion,
        proxyCountry:     sessionsTable.proxyCountry,
        proxyZip:         sessionsTable.proxyZip,
        baseLatitude:     sessionsTable.baseLatitude,
        baseLongitude:    sessionsTable.baseLongitude,
        mockedLatitude:   sessionsTable.mockedLatitude,
        mockedLongitude:  sessionsTable.mockedLongitude,
        mockedTimezone:   sessionsTable.mockedTimezone,
        backlinksExpected: sessionsTable.backlinksExpected,
        backlinkFound:     sessionsTable.backlinkFound,
        backlinkUrl:       sessionsTable.backlinkUrl,
        /* joins for denormalized fallback */
        joinedClientName:    clientsTable.businessName,
        joinedBusinessName:  businessesTable.name,
        joinedCampaignName:  clientAeoPlansTable.name,
        joinedKeywordText:   keywordsTable.keywordText,
      })
      .from(sessionsTable)
      .leftJoin(clientsTable,        eq(sessionsTable.clientId,   clientsTable.id))
      .leftJoin(businessesTable,     eq(sessionsTable.businessId, businessesTable.id))
      .leftJoin(clientAeoPlansTable, eq(sessionsTable.campaignId, clientAeoPlansTable.id))
      .leftJoin(keywordsTable,       eq(sessionsTable.keywordId,  keywordsTable.id))
      .where(where)
      .orderBy(desc(sessionsTable.timestamp))
      .limit(lim)
      .offset(off);

    res.json({
      sessions: sessions.map((s) => ({
        ...s,
        clientName:   s.clientName   ?? s.joinedClientName   ?? null,
        bizName:      s.bizName      ?? s.joinedBusinessName ?? null,
        campaignName: s.campaignName ?? s.joinedCampaignName ?? null,
        keywordText:  s.keywordText  ?? s.joinedKeywordText  ?? null,
      })),
      total:  Number(totalResult.count),
      offset: off,
      limit:  lim,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching sessions");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/sessions
   Accepts executor's payload (mix of FKs and name snapshots).
──────────────────────────────────────────────────────────── */
router.post("/", requireExecutorToken, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const clientId = body.clientId != null ? Number(body.clientId) : null;
    if (clientId == null) return res.status(400).json({ error: "clientId is required" });

    const [session] = await db
      .insert(sessionsTable)
      .values({
        clientId,
        businessId:       body.businessId  != null ? Number(body.businessId)  : null,
        campaignId:       body.campaignId  != null ? Number(body.campaignId)  : null,
        keywordId:        body.keywordId   != null ? Number(body.keywordId)   : null,
        deviceId:         body.deviceId    != null ? Number(body.deviceId)    : null,
        proxyId:          body.proxyId     != null ? Number(body.proxyId)     : null,
        clientName:       (body.clientName       as string | null | undefined) ?? null,
        bizName:          (body.bizName          as string | null | undefined) ?? null,
        campaignName:     (body.campaignName     as string | null | undefined) ?? null,
        keywordText:      (body.keywordText      as string | null | undefined) ?? null,
        city:             (body.city             as string | null | undefined) ?? null,
        state:            (body.state            as string | null | undefined) ?? null,
        date:             (body.date             as string | null | undefined) ?? null,
        timestamp:        body.timestamp ? new Date(body.timestamp as string) : undefined,
        durationSeconds:  body.durationSeconds != null ? Number(body.durationSeconds) : null,
        promptText:       (body.promptText ?? body.prompt) as string | null ?? null,
        followupText:     (body.followupText ?? body.followUp) as string | null ?? null,
        hasFollowUp:      Boolean(body.hasFollowUp),
        status:           (body.status as string) ?? "pending",
        type:             (body.type   as string) ?? "aeo",
        errorClass:       (body.errorClass       as string | null | undefined) ?? null,
        errorMessage:     (body.errorMessage     as string | null | undefined) ?? null,
        aiPlatform:       (body.aiPlatform ?? body.platform) as string ?? "gemini",
        screenshotUrl:    (body.screenshotUrl    as string | null | undefined) ?? null,
        deviceIdentifier: (body.deviceIdentifier as string | null | undefined) ?? null,
        proxyStatus:      (body.proxyStatus      as string | null | undefined) ?? null,
        proxySessionId:   (body.proxySessionId   as string | null | undefined) ?? null,
        proxyUsername:    (body.proxyUsername    as string | null | undefined) ?? null,
        proxyHost:        (body.proxyHost        as string | null | undefined) ?? null,
        proxyPort:        body.proxyPort != null ? Number(body.proxyPort) : null,
        proxyIp:          (body.proxyIp          as string | null | undefined) ?? null,
        proxyCity:        (body.proxyCity        as string | null | undefined) ?? null,
        proxyRegion:      (body.proxyRegion      as string | null | undefined) ?? null,
        proxyCountry:     (body.proxyCountry     as string | null | undefined) ?? null,
        proxyZip:         (body.proxyZip         as string | null | undefined) ?? null,
        baseLatitude:     body.baseLatitude    != null ? Number(body.baseLatitude)    : null,
        baseLongitude:    body.baseLongitude   != null ? Number(body.baseLongitude)   : null,
        mockedLatitude:   body.mockedLatitude  != null ? Number(body.mockedLatitude)  : null,
        mockedLongitude:  body.mockedLongitude != null ? Number(body.mockedLongitude) : null,
        mockedTimezone:   (body.mockedTimezone as string | null | undefined) ?? null,
        backlinksExpected: body.backlinksExpected != null ? Number(body.backlinksExpected) : null,
        backlinkFound:     Boolean(body.backlinkFound),
        backlinkUrl:       (body.backlinkUrl as string | null | undefined) ?? null,
      })
      .returning();
    res.status(201).json(session);
  } catch (err) {
    req.log.error({ err }, "Error creating session");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   PATCH /api/sessions/:id
   Generic field updater for backfills. Only whitelisted keys
   are copied from the body. Auth-gated.
──────────────────────────────────────────────────────────── */
const PATCHABLE_SESSION_FIELDS = [
  "clientId", "businessId", "campaignId", "keywordId", "deviceId", "proxyId",
  "clientName", "bizName", "campaignName", "keywordText",
  "city", "state", "date", "timestamp", "durationSeconds",
  "promptText", "followupText", "hasFollowUp",
  "status", "type", "errorClass", "errorMessage",
  "aiPlatform", "screenshotUrl", "deviceIdentifier",
  "proxyStatus", "proxySessionId", "proxyUsername", "proxyHost", "proxyPort",
  "proxyIp", "proxyCity", "proxyRegion", "proxyCountry", "proxyZip",
  "baseLatitude", "baseLongitude", "mockedLatitude", "mockedLongitude", "mockedTimezone",
  "backlinksExpected", "backlinkFound", "backlinkUrl",
] as const;

const NUMERIC_FIELDS = new Set([
  "clientId", "businessId", "campaignId", "keywordId", "deviceId", "proxyId",
  "durationSeconds", "proxyPort", "backlinksExpected",
  "baseLatitude", "baseLongitude", "mockedLatitude", "mockedLongitude",
]);
const BOOLEAN_FIELDS = new Set(["hasFollowUp", "backlinkFound"]);
const DATE_FIELDS   = new Set(["timestamp"]);

router.patch("/:id", requireExecutorToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of PATCHABLE_SESSION_FIELDS) {
      if (!(key in body)) continue;
      const v = body[key];
      if (v === null) { patch[key] = null; continue; }
      if (NUMERIC_FIELDS.has(key)) {
        const n = Number(v);
        if (Number.isNaN(n)) return res.status(400).json({ error: `${key} must be a number` });
        patch[key] = n;
      } else if (BOOLEAN_FIELDS.has(key)) {
        patch[key] = Boolean(v);
      } else if (DATE_FIELDS.has(key)) {
        const d = new Date(v as string);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `${key} must be a valid ISO 8601 string` });
        patch[key] = d;
      } else {
        patch[key] = v;
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No updatable fields in body" });
    }

    const [row] = await db
      .update(sessionsTable)
      .set(patch)
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Session not found" });
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Error patching session");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id/timestamp", requireExecutorToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { timestamp } = req.body as { timestamp?: string };
    if (!timestamp) return res.status(400).json({ error: "timestamp required" });
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "timestamp must be a valid ISO 8601 string" });
    }
    const [row] = await db
      .update(sessionsTable)
      .set({ timestamp: parsed })
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Session not found" });
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Error updating session timestamp");
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
      .set({ followupText: followupText.trim() || null, hasFollowUp: followupText.trim().length > 0 })
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
    const maxSessionsPerDay = availableDevices * 1;
    const estimatedCapacityPerHour = maxSessionsPerDay / 16;
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
