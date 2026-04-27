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
import { requireSession } from "../middlewares/session-auth";
import multer from "multer";
import { parse } from "csv-parse/sync";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

const router = Router();

/* Treat a bare YYYY-MM-DD filter as an America/New_York calendar day.
   "start" → that date at 00:00 ET. "end" → next day 00:00 ET (inclusive of
   everything on the given ET day). Anything with a time component is parsed
   as-is. EDT = UTC-4, EST = UTC-5 — Intl handles the transition. */
function parseFilterDate(raw: string, kind: "start" | "end"): Date {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  if (!isDateOnly) return new Date(raw);
  const [y, m, d] = raw.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  /* ET wall-clock for noon UTC of that date, to find the ET offset. */
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", hour12: false,
  }).formatToParts(noon);
  const etHour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
  const offsetHours = 12 - (etHour === 24 ? 0 : etHour); // UTC hours ahead of ET
  const startUtc = Date.UTC(y, m - 1, d, offsetHours);
  if (kind === "start") return new Date(startUtc);
  return new Date(startUtc + 24 * 60 * 60 * 1000);
}

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
    if (from)       conditions.push(gte(sessionsTable.timestamp, parseFilterDate(from, "start")));
    if (to)         conditions.push(lte(sessionsTable.timestamp, parseFilterDate(to,   "end")));

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
        backlinkInjected:  sessionsTable.backlinkInjected,
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
        backlinkInjected:  Boolean(body.backlinkInjected),
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
  "backlinksExpected", "backlinkInjected", "backlinkFound", "backlinkUrl",
] as const;

const NUMERIC_FIELDS = new Set([
  "clientId", "businessId", "campaignId", "keywordId", "deviceId", "proxyId",
  "durationSeconds", "proxyPort", "backlinksExpected",
  "baseLatitude", "baseLongitude", "mockedLatitude", "mockedLongitude",
]);
const BOOLEAN_FIELDS = new Set(["hasFollowUp", "backlinkInjected", "backlinkFound"]);
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

/* ────────────────────────────────────────────────────────────
   POST /api/sessions/import
   Upload a CSV file and import session rows.
   Protected by session auth (admin panel login).
──────────────────────────────────────────────────────────── */
router.post("/import", requireSession, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No CSV file uploaded. Use form field 'file'." });
    }

    const csvText = file.buffer.toString("utf-8");

    let rows: Record<string, string>[];
    try {
      rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      });
    } catch (parseErr) {
      req.log.error({ err: parseErr }, "CSV parse error");
      return res.status(400).json({ error: "Failed to parse CSV. Ensure it's valid CSV with a header row." });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: "CSV file is empty (no data rows)." });
    }

    // Build keyword lookup: "keyword_text|aeo_plan_id" → { keywordId, businessId }
    const allKeywords = await db
      .select({
        id: keywordsTable.id,
        keywordText: keywordsTable.keywordText,
        aeoPlanId: keywordsTable.aeoPlanId,
        businessId: keywordsTable.businessId,
      })
      .from(keywordsTable);

    const kwMap = new Map<string, { keywordId: number; businessId: number | null }>();
    for (const kw of allKeywords) {
      const key = `${(kw.keywordText ?? "").toLowerCase().trim()}|${kw.aeoPlanId}`;
      kwMap.set(key, { keywordId: kw.id, businessId: kw.businessId });
    }

    let imported = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];
    const BATCH_SIZE = 100;

    const toInsert: (typeof sessionsTable.$inferInsert)[] = [];

    for (let i = 0; i < rows.length; i++) {
      const csvRow = rows[i];
      const rowNum = i + 2; // +2 because row 1 is the header

      const keywordText = (csvRow.keyword ?? "").trim();
      const campaignIdRaw = csvRow.campaign_id;
      const campaignId = campaignIdRaw ? parseInt(campaignIdRaw, 10) : null;
      const kwKey = `${keywordText.toLowerCase()}|${campaignId}`;
      const lookup = kwMap.get(kwKey);

      if (!lookup) {
        skipped++;
        if (errors.length < 100) {
          errors.push({ row: rowNum, reason: `Keyword not found: "${keywordText}" for campaign_id=${campaignId}` });
        }
        continue;
      }

      const clientIdRaw = csvRow.client_id;
      if (!clientIdRaw) {
        skipped++;
        if (errors.length < 100) {
          errors.push({ row: rowNum, reason: "Missing client_id" });
        }
        continue;
      }

      const status = (csvRow.status ?? "pending").trim();
      const duration = csvRow.duration_s ? parseFloat(csvRow.duration_s) : null;
      const hasFollowUp = csvRow.has_follow_up === "True";
      const backlinkInjected = csvRow.backlink_injected === "True";
      const backlinkFound = csvRow.backlink_found === "True";
      const backlinksExpected = csvRow.backlinks_expected ? parseInt(csvRow.backlinks_expected, 10) : 0;
      const errorMsg = csvRow.error || null;
      const failureStep = csvRow.failure_step || null;

      const timestampRaw = csvRow.timestamp;
      const timestamp = timestampRaw ? new Date(timestampRaw) : new Date();
      if (timestampRaw && isNaN(timestamp.getTime())) {
        errors.push({ row: rowNum, reason: `Invalid timestamp: "${timestampRaw}"` });
        skipped++;
        continue;
      }

      toInsert.push({
        clientId: parseInt(clientIdRaw, 10),
        businessId: lookup.businessId,
        campaignId,
        keywordId: lookup.keywordId,
        clientName: csvRow.client_name || null,
        bizName: csvRow.biz_name || null,
        campaignName: csvRow.campaign_name || null,
        keywordText,
        timestamp,
        date: csvRow.date || null,
        durationSeconds: isNaN(duration as number) ? null : duration,
        promptText: csvRow.prompt || null,
        followupText: csvRow.follow_up || null,
        hasFollowUp,
        status,
        type: "aeo",
        aiPlatform: (csvRow.platform || "unknown").toLowerCase(),
        errorClass: status === "error" ? (failureStep || "unknown") : null,
        errorMessage: status === "error" ? errorMsg : null,
        proxyStatus: csvRow.proxy_status || null,
        proxyUsername: csvRow.proxy_username || null,
        proxyHost: csvRow.proxy_host || null,
        proxyPort: csvRow.proxy_port ? parseInt(csvRow.proxy_port, 10) : null,
        deviceIdentifier: csvRow.device_id || null,
        baseLatitude: csvRow.base_latitude ? parseFloat(csvRow.base_latitude) : null,
        baseLongitude: csvRow.base_longitude ? parseFloat(csvRow.base_longitude) : null,
        mockedLatitude: csvRow.mocked_latitude ? parseFloat(csvRow.mocked_latitude) : null,
        mockedLongitude: csvRow.mocked_longitude ? parseFloat(csvRow.mocked_longitude) : null,
        mockedTimezone: csvRow.mocked_timezone || null,
        backlinksExpected,
        backlinkInjected,
        backlinkFound,
        backlinkUrl: csvRow.backlink_url || null,
      });
    }

    // Batch insert with fallback to row-by-row on failure
    if (toInsert.length > 0) {
      for (let offset = 0; offset < toInsert.length; offset += BATCH_SIZE) {
        const batch = toInsert.slice(offset, offset + BATCH_SIZE);
        try {
          await db.insert(sessionsTable).values(batch);
          imported += batch.length;
        } catch (batchErr: unknown) {
          const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
          req.log.error({ err: batchErr }, `Batch insert failed at offset ${offset}`);
          for (let j = 0; j < batch.length; j++) {
            try {
              await db.insert(sessionsTable).values(batch[j]);
              imported++;
            } catch (singleErr: unknown) {
              const singleMsg = singleErr instanceof Error ? singleErr.message : String(singleErr);
              errors.push({ row: offset + j + 2, reason: `DB insert error: ${singleMsg}` });
              skipped++;
            }
          }
        }
      }
    }

    res.json({
      imported,
      skipped,
      totalRows: rows.length,
      errors: errors.slice(0, 100),
      ...(errors.length > 100 ? { errorsTruncated: errors.length - 100 } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "Error importing sessions CSV");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
