import { Router } from "express";
import { db, pool } from "@workspace/db";
import {
  rankingReportsTable,
  clientsTable,
  keywordsTable,
  businessesTable,
  clientAeoPlansTable,
} from "@workspace/db/schema";
import { eq, and, desc, asc, sql, gte, lte, inArray } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";
import { requireApiToken } from "../middlewares/api-token";
import {
  requireSalesAllowed,
  requireRoles,
  isSales,
} from "../middlewares/role-auth";
import { getSalesEligibleClientIds } from "../lib/sales-scope";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { rotateWinners, TOP3_THRESHOLD } from "../services/keyword-rotation";
import { exportProofIfQualifies } from "../services/proof-export";
import { logger } from "../lib/logger";

const router = Router();

/* Auto-lock-on-win: when a ranking report records a top-3 position for a
   keyword, immediately lock it (archive + status='locked') and rotate in an
   AI replacement. Fire-and-forget so it never blocks/fails report ingestion;
   rotateWinners is idempotent (it only touches active, non-archived keywords).

   Kill switch: set AUTO_ROTATION_DISABLED=1 (any truthy value) to no-op this
   call. Used to suppress retroactive rotation during back-fill imports — the
   rotation otherwise stamps `now()` regardless of the rank's actual date. */
function maybeAutoLock(keywordId: unknown, rankingPosition: unknown): void {
  if (process.env.AUTO_ROTATION_DISABLED) return;
  const kid = Number(keywordId);
  const pos = Number(rankingPosition);
  if (!Number.isFinite(kid) || kid <= 0) return;
  if (!Number.isFinite(pos) || pos < 1 || pos > TOP3_THRESHOLD) return;
  rotateWinners({ keywordId: kid, dryRun: false })
    .then((r) => {
      if (r.locked.length > 0) {
        logger.info(
          { keywordId: kid, locked: r.locked },
          "auto-rotation: locked keyword on win",
        );
      }
    })
    .catch((err) =>
      logger.warn({ err, keywordId: kid }, "auto-rotation: lock-on-win failed"),
    );
}

/* Shared S3 client. Credentials are resolved from the App Runner instance role
   in prod or AWS_PROFILE/env vars locally. Region defaults to us-east-1. */
const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
});

/* GET /api/ranking-reports
   Read endpoint exposed to external teams via API token. The FE still works
   via session cookie. Supports filters:
     - clientId, businessId, aeoPlanId, keywordId  (numeric ids)
     - dateFrom, dateTo                            (YYYY-MM-DD, inclusive)
     - status                                      (success|error)
     - platform                                    (chatgpt|gemini|perplexity, comma-separated ok)
     - isActive                                    (true|false — joins keywords.is_active)
     - limit (default 1000, max 5000) + offset    (pagination)
   Filters are combined with AND. Sorted newest first. */
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
const intInRange = (
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
) => {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

router.get("/", requireApiToken, async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const conditions: ReturnType<typeof eq>[] = [];

    if (q.clientId)
      conditions.push(eq(rankingReportsTable.clientId, parseInt(q.clientId)));
    if (q.businessId)
      conditions.push(
        eq(rankingReportsTable.businessId, parseInt(q.businessId)),
      );
    if (q.aeoPlanId)
      conditions.push(eq(keywordsTable.aeoPlanId, parseInt(q.aeoPlanId)));
    if (q.keywordId)
      conditions.push(eq(rankingReportsTable.keywordId, parseInt(q.keywordId)));

    /* date is a TEXT column 'YYYY-MM-DD' — lexicographic compare works. */
    if (q.dateFrom && ymdRe.test(q.dateFrom))
      conditions.push(gte(rankingReportsTable.date, q.dateFrom));
    if (q.dateTo && ymdRe.test(q.dateTo))
      conditions.push(lte(rankingReportsTable.date, q.dateTo));

    if (q.status === "success" || q.status === "error")
      conditions.push(eq(rankingReportsTable.status, q.status));

    if (q.platform) {
      const platforms = q.platform
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p === "chatgpt" || p === "gemini" || p === "perplexity");
      if (platforms.length === 1)
        conditions.push(eq(rankingReportsTable.platform, platforms[0]));
      else if (platforms.length > 1)
        conditions.push(inArray(rankingReportsTable.platform, platforms));
    }

    if (q.isActive === "true" || q.isActive === "false")
      conditions.push(eq(keywordsTable.isActive, q.isActive === "true"));

    const limit = intInRange(q.limit, 1, 5000, 1000);
    const offset = intInRange(q.offset, 0, Number.MAX_SAFE_INTEGER, 0);

    const reports = await db
      .select({
        id: rankingReportsTable.id,
        clientId: rankingReportsTable.clientId,
        businessId: rankingReportsTable.businessId,
        keywordId: rankingReportsTable.keywordId,
        clientName: rankingReportsTable.clientName,
        bizName: rankingReportsTable.bizName,
        searchAddress: rankingReportsTable.searchAddress,
        keyword: rankingReportsTable.keyword,
        timestamp: rankingReportsTable.timestamp,
        date: rankingReportsTable.date,
        platform: rankingReportsTable.platform,
        deviceIdentifier: rankingReportsTable.deviceIdentifier,
        status: rankingReportsTable.status,
        durationSeconds: rankingReportsTable.durationSeconds,
        rankingPosition: rankingReportsTable.rankingPosition,
        rankingTotal: rankingReportsTable.rankingTotal,
        reasonRecommended: rankingReportsTable.reasonRecommended,
        mapsPresence: rankingReportsTable.mapsPresence,
        mapsUrl: rankingReportsTable.mapsUrl,
        screenshotUrl: rankingReportsTable.screenshotUrl,
        textRanking: rankingReportsTable.textRanking,
        isInitialRanking: rankingReportsTable.isInitialRanking,
        proxyStatus: rankingReportsTable.proxyStatus,
        proxyUsername: rankingReportsTable.proxyUsername,
        proxyHost: rankingReportsTable.proxyHost,
        proxyPort: rankingReportsTable.proxyPort,
        proxyIp: rankingReportsTable.proxyIp,
        proxyCity: rankingReportsTable.proxyCity,
        proxyRegion: rankingReportsTable.proxyRegion,
        proxyCountry: rankingReportsTable.proxyCountry,
        proxyZip: rankingReportsTable.proxyZip,
        baseLatitude: rankingReportsTable.baseLatitude,
        baseLongitude: rankingReportsTable.baseLongitude,
        mockedLatitude: rankingReportsTable.mockedLatitude,
        mockedLongitude: rankingReportsTable.mockedLongitude,
        mockedTimezone: rankingReportsTable.mockedTimezone,
        failureStep: rankingReportsTable.failureStep,
        error: rankingReportsTable.error,
        createdAt: rankingReportsTable.createdAt,
        joinedClientName: clientsTable.businessName,
        joinedBusinessName: businessesTable.name,
        joinedKeywordText: keywordsTable.keywordText,
        aeoPlanId: keywordsTable.aeoPlanId,
      })
      .from(rankingReportsTable)
      .leftJoin(clientsTable, eq(rankingReportsTable.clientId, clientsTable.id))
      .leftJoin(
        businessesTable,
        eq(rankingReportsTable.businessId, businessesTable.id),
      )
      .leftJoin(
        keywordsTable,
        eq(rankingReportsTable.keywordId, keywordsTable.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(rankingReportsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(rankingReportsTable)
      .leftJoin(
        keywordsTable,
        eq(rankingReportsTable.keywordId, keywordsTable.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    const total = totalRows[0]?.n ?? 0;

    res.json({
      meta: { total, limit, offset, returned: reports.length },
      data: reports.map((r) => ({
        ...r,
        clientName: r.clientName ?? r.joinedClientName ?? null,
        bizName: r.bizName ?? r.joinedBusinessName ?? null,
        keyword: r.keyword ?? r.joinedKeywordText ?? null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching ranking reports");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireExecutorToken, async (req, res) => {
  try {
    const body = req.body;
    const platform =
      typeof body.platform === "string" ? body.platform.toLowerCase() : null;

    /* Upsert key: prefer body.date for backfills (so re-running an import for
       a past day finds yesterday's row), else fall back to today's date. */
    const upsertDate =
      typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : null;

    /* timestamp without time zone needs a Date for Drizzle; importers
       and the python pusher send an ISO string. */
    const ts: Date | null = body.timestamp ? new Date(body.timestamp) : null;

    const existing = await db
      .select({ id: rankingReportsTable.id })
      .from(rankingReportsTable)
      .where(
        and(
          eq(rankingReportsTable.keywordId, body.keywordId),
          platform != null
            ? eq(rankingReportsTable.platform, platform)
            : sql`${rankingReportsTable.platform} IS NULL`,
          upsertDate
            ? eq(rankingReportsTable.date, upsertDate)
            : sql`DATE(${rankingReportsTable.createdAt}) = CURRENT_DATE`,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(rankingReportsTable)
        .set({
          clientName: body.clientName ?? null,
          bizName: body.bizName ?? null,
          searchAddress: body.searchAddress ?? null,
          keyword: body.keyword ?? null,
          keywordVariant: body.keywordVariant ?? null,
          timestamp: ts,
          date: body.date ?? null,
          platform: platform,
          deviceIdentifier: body.deviceIdentifier ?? null,
          status: body.status ?? null,
          durationSeconds: body.durationSeconds ?? null,
          rankingPosition: body.rankingPosition ?? null,
          rankingTotal: body.rankingTotal ?? null,
          reasonRecommended: body.reasonRecommended ?? null,
          ...(body.createdAt ? { createdAt: new Date(body.createdAt) } : {}),
          mapsPresence: body.mapsPresence ?? null,
          mapsUrl: body.mapsUrl ?? null,
          isInitialRanking: body.isInitialRanking ?? false,
          screenshotUrl: body.screenshotUrl ?? null,
          textRanking: body.textRanking ?? null,
          proxyStatus: body.proxyStatus ?? null,
          proxyUsername: body.proxyUsername ?? null,
          proxyHost: body.proxyHost ?? null,
          proxyPort: body.proxyPort ?? null,
          proxyIp: body.proxyIp ?? null,
          proxyCity: body.proxyCity ?? null,
          proxyRegion: body.proxyRegion ?? null,
          proxyCountry: body.proxyCountry ?? null,
          proxyZip: body.proxyZip ?? null,
          baseLatitude: body.baseLatitude ?? null,
          baseLongitude: body.baseLongitude ?? null,
          mockedLatitude: body.mockedLatitude ?? null,
          mockedLongitude: body.mockedLongitude ?? null,
          mockedTimezone: body.mockedTimezone ?? null,
          failureStep: body.failureStep ?? null,
          error: body.error ?? null,
        })
        .where(eq(rankingReportsTable.id, existing[0].id))
        .returning();
      res.status(200).json({ ...updated, upserted: true });
      maybeAutoLock(body.keywordId, body.rankingPosition);
      exportProofIfQualifies(body.keywordId, body.date);
      return;
    }

    const [report] = await db
      .insert(rankingReportsTable)
      .values({
        clientId: body.clientId,
        businessId: body.businessId != null ? Number(body.businessId) : null,
        keywordId: body.keywordId,
        clientName: body.clientName ?? null,
        bizName: body.bizName ?? null,
        searchAddress: body.searchAddress ?? null,
        keyword: body.keyword ?? null,
        keywordVariant: body.keywordVariant ?? null,
        timestamp: ts,
        date: body.date ?? null,
        platform: platform,
        ...(body.createdAt ? { createdAt: new Date(body.createdAt) } : {}),
        deviceIdentifier: body.deviceIdentifier ?? null,
        status: body.status ?? null,
        durationSeconds: body.durationSeconds ?? null,
        rankingPosition: body.rankingPosition ?? null,
        rankingTotal: body.rankingTotal ?? null,
        reasonRecommended: body.reasonRecommended ?? null,
        mapsPresence: body.mapsPresence ?? null,
        mapsUrl: body.mapsUrl ?? null,
        isInitialRanking: body.isInitialRanking ?? false,
        screenshotUrl: body.screenshotUrl ?? null,
        textRanking: body.textRanking ?? null,
        proxyStatus: body.proxyStatus ?? null,
        proxyUsername: body.proxyUsername ?? null,
        proxyHost: body.proxyHost ?? null,
        proxyPort: body.proxyPort ?? null,
        proxyIp: body.proxyIp ?? null,
        proxyCity: body.proxyCity ?? null,
        proxyRegion: body.proxyRegion ?? null,
        proxyCountry: body.proxyCountry ?? null,
        proxyZip: body.proxyZip ?? null,
        baseLatitude: body.baseLatitude ?? null,
        baseLongitude: body.baseLongitude ?? null,
        mockedLatitude: body.mockedLatitude ?? null,
        mockedLongitude: body.mockedLongitude ?? null,
        mockedTimezone: body.mockedTimezone ?? null,
        failureStep: body.failureStep ?? null,
        error: body.error ?? null,
      })
      .returning();
    res.status(201).json(report);
    maybeAutoLock(body.keywordId, body.rankingPosition);
    exportProofIfQualifies(body.keywordId, body.date);
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
    const deletedCount = Array.isArray(result)
      ? result.length
      : (result?.rowCount ?? 0);
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
    if (body.mapsUrl !== undefined) updates.mapsUrl = body.mapsUrl ?? null;
    if (body.mapsPresence !== undefined)
      updates.mapsPresence = body.mapsPresence;
    if (body.rankingPosition !== undefined)
      updates.rankingPosition = body.rankingPosition;
    if (body.reasonRecommended !== undefined)
      updates.reasonRecommended = body.reasonRecommended;
    if (body.screenshotUrl !== undefined)
      updates.screenshotUrl = body.screenshotUrl ?? null;
    if (body.textRanking !== undefined)
      updates.textRanking = body.textRanking ?? null;
    if (body.rankingTotal !== undefined)
      updates.rankingTotal = body.rankingTotal ?? null;
    if (body.durationSeconds !== undefined)
      updates.durationSeconds = body.durationSeconds ?? null;
    if (body.proxyIp !== undefined) updates.proxyIp = body.proxyIp ?? null;
    if (body.proxyCity !== undefined)
      updates.proxyCity = body.proxyCity ?? null;
    if (body.proxyRegion !== undefined)
      updates.proxyRegion = body.proxyRegion ?? null;
    if (body.proxyCountry !== undefined)
      updates.proxyCountry = body.proxyCountry ?? null;
    if (body.proxyZip !== undefined) updates.proxyZip = body.proxyZip ?? null;
    if (body.baseLatitude !== undefined)
      updates.baseLatitude = body.baseLatitude ?? null;
    if (body.baseLongitude !== undefined)
      updates.baseLongitude = body.baseLongitude ?? null;
    if (body.mockedLatitude !== undefined)
      updates.mockedLatitude = body.mockedLatitude ?? null;
    if (body.mockedLongitude !== undefined)
      updates.mockedLongitude = body.mockedLongitude ?? null;
    if (body.deviceIdentifier !== undefined)
      updates.deviceIdentifier = body.deviceIdentifier ?? null;
    if (body.clientName !== undefined)
      updates.clientName = body.clientName ?? null;
    if (body.bizName !== undefined) updates.bizName = body.bizName ?? null;
    if (body.searchAddress !== undefined)
      updates.searchAddress = body.searchAddress ?? null;
    if (body.keyword !== undefined) updates.keyword = body.keyword ?? null;
    if (body.timestamp !== undefined)
      updates.timestamp = body.timestamp ?? null;
    if (body.date !== undefined) updates.date = body.date ?? null;
    if (body.status !== undefined) updates.status = body.status ?? null;
    if (body.proxyStatus !== undefined)
      updates.proxyStatus = body.proxyStatus ?? null;
    if (body.proxyUsername !== undefined)
      updates.proxyUsername = body.proxyUsername ?? null;
    if (body.proxyHost !== undefined)
      updates.proxyHost = body.proxyHost ?? null;
    if (body.proxyPort !== undefined)
      updates.proxyPort = body.proxyPort ?? null;
    if (body.mockedTimezone !== undefined)
      updates.mockedTimezone = body.mockedTimezone ?? null;
    if (body.failureStep !== undefined)
      updates.failureStep = body.failureStep ?? null;
    if (body.error !== undefined) updates.error = body.error ?? null;

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
router.get("/platform-summary", requireSalesAllowed, async (req, res) => {
  try {
    const eligibleIds = await getSalesEligibleClientIds(req);
    if (eligibleIds && eligibleIds.length === 0) {
      return res.json([]);
    }
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
        .where(
          eligibleIds
            ? inArray(rankingReportsTable.clientId, eligibleIds)
            : undefined,
        )
        .orderBy(asc(rankingReportsTable.createdAt)),
    ]);

    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const keywordMap = new Map(keywords.map((k) => [k.id, k]));
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
        const client = clientMap.get(initial.clientId);
        const keyword = keywordMap.get(initial.keywordId);
        const change =
          initial?.rankingPosition != null && current?.rankingPosition != null
            ? initial.rankingPosition - current.rankingPosition
            : null;
        const business =
          keyword?.businessId != null
            ? businessMap.get(keyword.businessId)
            : null;
        return {
          clientId: initial.clientId,
          clientName: client?.businessName ?? `Client #${initial.clientId}`,
          businessId: keyword?.businessId ?? null,
          businessName: business?.name ?? null,
          aeoPlanId: keyword?.aeoPlanId ?? null,
          keywordId: initial.keywordId,
          keywordText: keyword?.keywordText ?? `Keyword #${initial.keywordId}`,
          initialPosition: initial?.rankingPosition ?? null,
          currentPosition: current?.rankingPosition ?? null,
          positionChange: change,
        };
      });

      const withData = comparisons.filter((c) => c.currentPosition != null);
      const improving = comparisons.filter((c) => (c.positionChange ?? 0) > 0);
      const declining = comparisons.filter((c) => (c.positionChange ?? 0) < 0);
      const steady = comparisons.filter((c) => c.positionChange === 0);
      const avgPos =
        withData.length > 0
          ? Math.round(
              withData.reduce((s, c) => s + (c.currentPosition ?? 0), 0) /
                withData.length,
            )
          : null;
      const topTen = withData.filter((c) => (c.currentPosition ?? 99) <= 10);
      const bestKw =
        withData.sort(
          (a, b) => (a.currentPosition ?? 99) - (b.currentPosition ?? 99),
        )[0] ?? null;

      return {
        platform,
        totalKeywords: comparisons.length,
        withData: withData.length,
        improving: improving.length,
        steady: steady.length,
        declining: declining.length,
        avgCurrentRank: avgPos,
        topTenCount: topTen.length,
        bestKeyword: bestKw
          ? {
              text: bestKw.keywordText,
              position: bestKw.currentPosition,
              change: bestKw.positionChange,
            }
          : null,
        keywords: comparisons,
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
router.get("/per-keyword-platform", requireSalesAllowed, async (req, res) => {
  try {
    const eligibleIds = await getSalesEligibleClientIds(req);
    if (eligibleIds && eligibleIds.length === 0) {
      return res.json([]);
    }
    const allReports = await db
      .select({
        keywordId: rankingReportsTable.keywordId,
        platform: rankingReportsTable.platform,
        rankingPosition: rankingReportsTable.rankingPosition,
        createdAt: rankingReportsTable.createdAt,
      })
      .from(rankingReportsTable)
      .where(
        eligibleIds
          ? inArray(rankingReportsTable.clientId, eligibleIds)
          : undefined,
      )
      .orderBy(asc(rankingReportsTable.createdAt));

    // Group by keywordId + platform, keep only the latest
    const latest = new Map<
      string,
      { keywordId: number; platform: string; rankingPosition: number | null }
    >();
    for (const r of allReports) {
      if (!r.platform) continue;
      const key = `${r.keywordId}-${r.platform}`;
      latest.set(key, {
        keywordId: r.keywordId,
        platform: r.platform,
        rankingPosition: r.rankingPosition,
      });
    }

    // Pivot: keywordId → { chatgpt, gemini, perplexity }
    const pivot = new Map<number, Record<string, number | null>>();
    for (const row of latest.values()) {
      if (!pivot.has(row.keywordId)) pivot.set(row.keywordId, {});
      pivot.get(row.keywordId)![row.platform] = row.rankingPosition;
    }

    const result = [...pivot.entries()].map(([keywordId, platforms]) => ({
      keywordId,
      chatgpt: platforms["chatgpt"] ?? null,
      gemini: platforms["gemini"] ?? null,
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  /* ET wall-clock for `d`. Compute the offset (UTC minus ET) from the
     difference between ET wall-clock and UTC wall-clock of the same instant. */
  const etWall = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  const offsetMs = etWall - d.getTime();
  /* ET midnight of that calendar date, expressed as a UTC instant. */
  const etMidnight = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
  );
  return new Date(etMidnight - offsetMs);
}

function windowsFor(
  period: PeriodKey,
  now: Date,
): { curStart: Date; curEnd: Date; prevStart: Date; prevEnd: Date } {
  if (period === "weekly") {
    /* Biweekly windows aligned to ET midnight. "weekly" key kept for
       backwards-compat with the FE; semantically it's the last 14 days. */
    const todayStart = startOfDayET(now);
    const curStart = new Date(todayStart.getTime() - 14 * 24 * 60 * 60 * 1000);
    const curEnd = new Date(todayStart.getTime() + 1 * 24 * 60 * 60 * 1000);
    const prevStart = new Date(curStart.getTime() - 14 * 24 * 60 * 60 * 1000);
    const prevEnd = curStart;
    return { curStart, curEnd, prevStart, prevEnd };
  }
  if (period === "monthly") {
    const curStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const curEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const prevStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const prevEnd = curStart;
    return { curStart, curEnd, prevStart, prevEnd };
  }
  // quarterly
  const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  const curStart = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1));
  const curEnd = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth + 3, 1));
  const prevStart = new Date(
    Date.UTC(now.getUTCFullYear(), qStartMonth - 3, 1),
  );
  const prevEnd = curStart;
  return { curStart, curEnd, prevStart, prevEnd };
}

router.get("/period-comparison", requireSalesAllowed, async (req, res) => {
  try {
    const eligibleIds = await getSalesEligibleClientIds(req);
    if (eligibleIds && eligibleIds.length === 0) {
      return res.json({ period: "weekly", window: null, rows: [] });
    }
    const period = ((req.query.period as string) ?? "weekly") as PeriodKey;
    if (!["weekly", "monthly", "quarterly", "lifetime"].includes(period)) {
      return res.status(400).json({ error: "Invalid period" });
    }
    const clientId = req.query.clientId
      ? parseInt(req.query.clientId as string, 10)
      : null;
    const businessId = req.query.businessId
      ? parseInt(req.query.businessId as string, 10)
      : null;
    const aeoPlanId = req.query.aeoPlanId
      ? parseInt(req.query.aeoPlanId as string, 10)
      : null;

    /* Optional date overrides — pin one column to a specific ET YYYY-MM-DD.
       When present, that column ignores the period window and picks the
       report whose `date` text matches per (keyword, platform). Empty / null /
       malformed values are ignored. */
    const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
    const parseYmd = (v: unknown): string | null => {
      const s = typeof v === "string" ? v.trim() : "";
      return ymdRe.test(s) ? s : null;
    };
    const firstDateOverride = parseYmd(req.query.firstDate);
    const prevDateOverride = parseYmd(req.query.prevDate);
    const currentDateOverride = parseYmd(req.query.currentDate);

    const isLifetime = period === "lifetime";
    const { curStart, curEnd, prevStart, prevEnd } = isLifetime
      ? {
          curStart: new Date(0),
          curEnd: new Date("9999-12-31"),
          prevStart: new Date(0),
          prevEnd: new Date("9999-12-31"),
        }
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
          date: rankingReportsTable.date,
          keywordVariant: rankingReportsTable.keywordVariant,
        })
        .from(rankingReportsTable)
        .where(
          eligibleIds
            ? inArray(rankingReportsTable.clientId, eligibleIds)
            : undefined,
        )
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
      const map = new Map<PairKey, (typeof reports)[number]>();
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
      const map = new Map<PairKey, (typeof reports)[number]>();
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
      const map = new Map<PairKey, (typeof reports)[number]>();
      for (const r of reports) {
        if (!r.platform) continue;
        if (!keywordAllowed(r.keywordId)) continue;
        const key = `${r.keywordId}|${r.platform}`;
        if (!map.has(key)) map.set(key, r); // reports are asc, first wins
      }
      return map;
    };

    /* Per (kw, plat), pick the SECOND-most-recent report (the audit before
       the latest one). Used by weekly/biweekly so "previous" is always the
       prior audit run, regardless of date — matches how rank trackers work
       and is what Mary expects. */
    const secondLatestPerPair = () => {
      const buckets = new Map<PairKey, typeof reports>();
      for (const r of reports) {
        if (!r.platform) continue;
        if (!keywordAllowed(r.keywordId)) continue;
        const key = `${r.keywordId}|${r.platform}`;
        const arr = buckets.get(key) ?? [];
        arr.push(r);
        buckets.set(key, arr);
      }
      const map = new Map<PairKey, (typeof reports)[number]>();
      for (const [key, arr] of buckets) {
        if (arr.length >= 2) map.set(key, arr[arr.length - 2]); // arr is asc-ordered
      }
      return map;
    };

    /* Per-pair lookup by exact ET `date` text. Last match wins because
       reports is asc-ordered, so when multiple audits share the same date
       (rare — retries with different proxies) we pick the later one. */
    const onDatePerPair = (ymd: string) => {
      const map = new Map<PairKey, (typeof reports)[number]>();
      for (const r of reports) {
        if (!r.platform) continue;
        if (!keywordAllowed(r.keywordId)) continue;
        if (r.date !== ymd) continue;
        const key = `${r.keywordId}|${r.platform}`;
        map.set(key, r);
      }
      return map;
    };

    const ever = everLatest();
    const isWeekly = period === "weekly";
    const current = currentDateOverride
      ? onDatePerPair(currentDateOverride)
      : isWeekly
        ? ever
        : isLifetime
          ? ever
          : latestInWindow(curStart, curEnd);
    const previous = prevDateOverride
      ? onDatePerPair(prevDateOverride)
      : isWeekly
        ? secondLatestPerPair()
        : isLifetime
          ? firstEver()
          : latestInWindow(prevStart, prevEnd);
    const first = firstDateOverride
      ? onDatePerPair(firstDateOverride)
      : firstEver();

    const allKeys = new Set<PairKey>([
      ...current.keys(),
      ...previous.keys(),
      ...ever.keys(),
    ]);

    const rows = [...allKeys].map((key) => {
      const [kidStr, platform] = key.split("|");
      const keywordId = parseInt(kidStr, 10);
      const kw = keywordMap.get(keywordId);
      const client = kw ? clientMap.get(kw.clientId) : null;
      const business =
        kw?.businessId != null ? businessMap.get(kw.businessId) : null;
      const plan = kw?.aeoPlanId != null ? planMap.get(kw.aeoPlanId) : null;
      const cur = current.get(key);
      const prev = previous.get(key);
      const firstEverRow = first.get(key);
      const lastEver = ever.get(key);
      const change =
        cur?.rankingPosition != null && prev?.rankingPosition != null
          ? prev.rankingPosition - cur.rankingPosition
          : null;

      let status:
        | "new"
        | "improved"
        | "steady"
        | "declined"
        | "missing"
        | "pending" = "pending";
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
        /* currentDate is the unambiguous YYYY-MM-DD `date` text column,
           not the `created_at` timestamp. Using the timestamp made the
           frontend's ET-conversion land on the prior calendar day for
           backfilled rows where created_at = midnight-ET (T04:00:00Z). */
        currentDate: cur?.date ?? null,
        currentVariant: cur?.keywordVariant ?? null,
        previousReportId: prev?.id ?? null,
        previousPosition: prev?.rankingPosition ?? null,
        previousDate: prev?.date ?? null,
        firstReportId: firstEverRow?.id ?? null,
        firstPosition: firstEverRow?.rankingPosition ?? null,
        firstDate: firstEverRow?.date ?? null,
        change,
        status,
        freshness,
        lastRunAt,
      };
    });

    res.json({
      period,
      window: isLifetime
        ? null
        : {
            currentStart: curStart,
            currentEnd: curEnd,
            previousStart: prevStart,
            previousEnd: prevEnd,
          },
      rows,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching period comparison");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/initial-vs-current", requireSalesAllowed, async (req, res) => {
  try {
    const eligibleIds = await getSalesEligibleClientIds(req);
    if (eligibleIds && eligibleIds.length === 0) {
      return res.json([]);
    }
    const clients = await db.select().from(clientsTable);
    const keywords = await db.select().from(keywordsTable);
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
        keywordVariant: rankingReportsTable.keywordVariant,
      })
      .from(rankingReportsTable)
      .where(
        eligibleIds
          ? inArray(rankingReportsTable.clientId, eligibleIds)
          : undefined,
      )
      .orderBy(asc(rankingReportsTable.createdAt));

    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const keywordMap = new Map(keywords.map((k) => [k.id, k]));
    const businessMap = new Map(businesses.map((b) => [b.id, b]));

    const grouped: Record<
      string,
      {
        clientId: number;
        clientName: string;
        businessId: number | null;
        businessName: string | null;
        aeoPlanId: number | null;
        keywordId: number;
        keywordText: string;
        reports: typeof allReports;
      }
    > = {};

    for (const report of allReports) {
      const key = `${report.clientId}-${report.keywordId}`;
      const client = clientMap.get(report.clientId);
      const keyword = keywordMap.get(report.keywordId);
      if (!client || !keyword) continue;
      if (!grouped[key]) {
        const business =
          keyword.businessId != null
            ? businessMap.get(keyword.businessId)
            : null;
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
      const initialReport =
        g.reports.find((r) => r.isInitialRanking) ?? g.reports[0];
      const currentReport = g.reports[g.reports.length - 1];
      const posChange =
        initialReport?.rankingPosition != null &&
        currentReport?.rankingPosition != null
          ? initialReport.rankingPosition - currentReport.rankingPosition
          : null;
      return {
        clientId: g.clientId,
        clientName: g.clientName,
        businessId: g.businessId,
        businessName: g.businessName,
        aeoPlanId: g.aeoPlanId,
        keywordId: g.keywordId,
        keywordText: g.keywordText,
        currentReportId: currentReport?.id ?? null,
        initialDate: initialReport?.createdAt ?? null,
        initialPosition: initialReport?.rankingPosition ?? null,
        currentDate: currentReport?.createdAt ?? null,
        currentPosition: currentReport?.rankingPosition ?? null,
        currentVariant: currentReport?.keywordVariant ?? null,
        positionChange: posChange,
        isInTopTen:
          currentReport?.rankingPosition != null &&
          currentReport.rankingPosition <= 10,
        mapsPresence: currentReport?.mapsPresence ?? null,
        mapsUrl: currentReport?.mapsUrl ?? null,
        screenshotUrl: currentReport?.screenshotUrl ?? null,
        textRanking: currentReport?.textRanking ?? null,
      };
    });

    res.json(comparisons);
  } catch (err) {
    req.log.error({ err }, "Error fetching initial vs current rankings");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/ranking-reports/bi-weekly-report?clientId=&businessId=&aeoPlanId=
   Master report for the bi-weekly cadence: current batch summary, old-file
   status, ranking trend across combos with 2+ prior runs, and initial-rank
   distribution for combos new to the current batch. */
router.get(
  "/bi-weekly-report",
  requireRoles("owner", "sales"),
  async (req, res) => {
    try {
      const eligibleIds = await getSalesEligibleClientIds(req);
      if (eligibleIds && eligibleIds.length === 0) {
        return res.json({
          currentBatch: null,
          oldFile: null,
          rankingTrend: null,
          initialRanking: null,
          allBatches: [],
          clientMatrix: [],
          details: {
            oldCombos: [],
            newCombos: [],
            rankingTrendRows: [],
            errors: [],
            platformOld: [],
            platformNew: [],
            platformTrend: [],
          },
        });
      }
      const clientId = req.query.clientId
        ? parseInt(req.query.clientId as string, 10)
        : null;
      const businessId = req.query.businessId
        ? parseInt(req.query.businessId as string, 10)
        : null;
      const aeoPlanId = req.query.aeoPlanId
        ? parseInt(req.query.aeoPlanId as string, 10)
        : null;

      /* Filter sub-clause and params shared by every CTE. The text-based
         date column requires explicit ::date casts for arithmetic. */
      const conds: string[] = ["date IS NOT NULL"];
      const params: (number | number[] | null)[] = [];
      if (clientId !== null) {
        params.push(clientId);
        conds.push(`client_id = $${params.length}`);
      }
      if (businessId !== null) {
        params.push(businessId);
        conds.push(`business_id = $${params.length}`);
      }
      if (aeoPlanId !== null) {
        params.push(aeoPlanId);
        conds.push(
          `keyword_id IN (SELECT id FROM keywords WHERE aeo_plan_id = $${params.length})`,
        );
      }
      /* Sales role: restrict to free-trial client ids. Layered ON TOP OF
         the explicit clientId filter — the sales scope and the user filter
         intersect. The `${where}` template gets rewritten with `rr.` prefixes
         in CTEs further down, so use the bare `client_id` column name here. */
      if (eligibleIds) {
        params.push(eligibleIds);
        conds.push(`client_id = ANY($${params.length}::int[])`);
      }
      const where = conds.join(" AND ");

      /* 1) Identify current batch = newest distinct date in scope. */
      const batchesRes = await pool.query<{ date: string; combos: string }>(
        `SELECT date, COUNT(*) AS combos FROM ranking_reports WHERE ${where}
       GROUP BY date ORDER BY date DESC`,
        params,
      );
      if (batchesRes.rows.length === 0) {
        return res.json({
          currentBatch: null,
          oldFile: null,
          rankingTrend: null,
          initialRanking: null,
          allBatches: [],
        });
      }
      const currentBatchDate = batchesRes.rows[0].date;
      const allBatches = batchesRes.rows.map((r) => ({
        date: r.date,
        combos: Number(r.combos),
      }));
      const nextDue = new Date(currentBatchDate);
      nextDue.setUTCDate(nextDue.getUTCDate() + 14);
      const nextDueDate = nextDue.toISOString().slice(0, 10);

      const currentParamIdx = params.length + 1;
      const paramsWithBatch = [...params, currentBatchDate];

      /* Section A — current batch summary */
      const sA = await pool.query(
        `SELECT
         COUNT(DISTINCT (keyword_id, lower(platform))) AS unique_combos,
         COUNT(DISTINCT business_id) AS unique_businesses,
         COUNT(DISTINCT client_id)   AS unique_clients,
         COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM ranking_reports r2
           WHERE r2.keyword_id = ranking_reports.keyword_id
             AND lower(r2.platform) = lower(ranking_reports.platform)
             AND r2.date < ranking_reports.date
         )) AS new_combos
       FROM ranking_reports WHERE ${where} AND date = $${currentParamIdx}`,
        paramsWithBatch,
      );
      const sessions = await pool.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM audit_logs
       WHERE to_char(((timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York'),'YYYY-MM-DD') = $1
         ${clientId !== null ? `AND client_id = $2` : ""}
         ${businessId !== null ? `AND business_id = $${clientId !== null ? 3 : 2}` : ""}`,
        [
          currentBatchDate,
          ...(clientId !== null ? [clientId] : []),
          ...(businessId !== null ? [businessId] : []),
        ],
      );
      const sectA = sA.rows[0];
      const sectionA = {
        batchDate: currentBatchDate,
        nextDueDate,
        totalSessions: Number(sessions.rows[0].n),
        uniqueCombos: Number(sectA.unique_combos),
        uniqueBusinesses: Number(sectA.unique_businesses),
        uniqueClients: Number(sectA.unique_clients),
        newCombos: Number(sectA.new_combos),
        auditType:
          Number(sectA.new_combos) === Number(sectA.unique_combos)
            ? "First-Ever Audit"
            : "Recurring Audit",
      };

      /* Section B — old file: combos from batches before the current one */
      const sB = await pool.query(
        `WITH old_combos AS (
         SELECT keyword_id, lower(platform) AS platform,
                MIN(date::date) AS first_date,
                MAX(date::date) AS last_date,
                BOOL_OR(status = 'error') AS had_error
         FROM ranking_reports WHERE ${where} AND date < $${currentParamIdx}
         GROUP BY keyword_id, lower(platform)
       )
       SELECT
         COUNT(*) AS total_old,
         COUNT(*) FILTER (WHERE last_date >= (CURRENT_DATE - INTERVAL '14 days')) AS on_schedule,
         COUNT(*) FILTER (WHERE last_date <  (CURRENT_DATE - INTERVAL '14 days')) AS still_behind,
         COUNT(*) FILTER (WHERE had_error) AS with_errors,
         MIN(first_date)::text AS earliest_date,
         MAX(last_date)::text  AS latest_old_date
       FROM old_combos`,
        paramsWithBatch,
      );
      const sBBatches = await pool.query<{
        expected_batch_date: string;
        combos: string;
      }>(
        `WITH old_combos AS (
         SELECT keyword_id, lower(platform) AS platform,
                MAX(date::date) AS last_date
         FROM ranking_reports WHERE ${where} AND date < $${currentParamIdx}
         GROUP BY keyword_id, lower(platform)
       )
       SELECT (last_date + INTERVAL '14 days')::date::text AS expected_batch_date,
              COUNT(*) AS combos
       FROM old_combos
       WHERE last_date < (CURRENT_DATE - INTERVAL '14 days')
       GROUP BY expected_batch_date
       ORDER BY expected_batch_date`,
        paramsWithBatch,
      );
      const sBr = sB.rows[0];
      const sectionB = {
        earliestDate: sBr.earliest_date,
        latestOldDate: sBr.latest_old_date,
        totalOldCombos: Number(sBr.total_old),
        onSchedule: Number(sBr.on_schedule),
        stillBehindTotal: Number(sBr.still_behind),
        withErrors: Number(sBr.with_errors),
        stillBehindByBatch: sBBatches.rows.map((r) => ({
          expectedBatchDate: r.expected_batch_date,
          combos: Number(r.combos),
        })),
      };

      /* Section C — ranking trend for OLD-FILE combos with 2+ runs */
      const sC = await pool.query(
        `WITH old_runs AS (
         SELECT keyword_id, lower(platform) AS platform,
                array_agg(ranking_position ORDER BY date DESC, id DESC) AS ranks_desc
         FROM ranking_reports WHERE ${where} AND date < $${currentParamIdx}
         GROUP BY keyword_id, lower(platform)
         HAVING COUNT(*) >= 2
       )
       SELECT
         COUNT(*) FILTER (WHERE ranks_desc[1] IS NOT NULL AND ranks_desc[2] IS NOT NULL AND ranks_desc[1] < ranks_desc[2]) AS improved,
         COUNT(*) FILTER (WHERE ranks_desc[1] IS NOT NULL AND ranks_desc[2] IS NOT NULL AND ranks_desc[1] > ranks_desc[2]) AS declined,
         COUNT(*) FILTER (WHERE ranks_desc[1] IS NOT NULL AND ranks_desc[2] IS NOT NULL AND ranks_desc[1] = ranks_desc[2]) AS no_change,
         COUNT(*) FILTER (WHERE ranks_desc[1] IS NULL) AS not_ranked,
         COUNT(*) AS eligible_total
       FROM old_runs`,
        paramsWithBatch,
      );
      const sCr = sC.rows[0];
      const sectionC = {
        eligibleCombos: Number(sCr.eligible_total),
        improved: Number(sCr.improved),
        declined: Number(sCr.declined),
        noChange: Number(sCr.no_change),
        notRanked: Number(sCr.not_ranked),
      };

      /* Section D — initial-rank distribution for combos NEW to the current batch.
       Re-use the same filter conditions; column names are unprefixed in the
       where-clause so they resolve against ranking_reports cleanly. */
      const sD = await pool.query(
        `WITH new_combos AS (
         SELECT ranking_position FROM ranking_reports
         WHERE ${where}
           AND date = $${currentParamIdx}
           AND NOT EXISTS (
             SELECT 1 FROM ranking_reports r2
             WHERE r2.keyword_id = ranking_reports.keyword_id
               AND lower(r2.platform) = lower(ranking_reports.platform)
               AND r2.date < ranking_reports.date
           )
       )
       SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE ranking_position BETWEEN 1 AND 3) AS top3,
         COUNT(*) FILTER (WHERE ranking_position BETWEEN 4 AND 10) AS top4_10,
         COUNT(*) FILTER (WHERE ranking_position BETWEEN 11 AND 30) AS top11_30,
         COUNT(*) FILTER (WHERE ranking_position > 30) AS beyond,
         COUNT(*) FILTER (WHERE ranking_position IS NULL OR ranking_position = 0) AS not_ranked
       FROM new_combos`,
        paramsWithBatch,
      );
      const sDr = sD.rows[0];
      const total = Number(sDr.total) || 1;
      const sectionD = {
        totalNewCombos: Number(sDr.total),
        buckets: {
          top3: {
            count: Number(sDr.top3),
            pct: Number(((Number(sDr.top3) / total) * 100).toFixed(1)),
          },
          top4to10: {
            count: Number(sDr.top4_10),
            pct: Number(((Number(sDr.top4_10) / total) * 100).toFixed(1)),
          },
          top11to30: {
            count: Number(sDr.top11_30),
            pct: Number(((Number(sDr.top11_30) / total) * 100).toFixed(1)),
          },
          beyond30: {
            count: Number(sDr.beyond),
            pct: Number(((Number(sDr.beyond) / total) * 100).toFixed(1)),
          },
          notRanked: {
            count: Number(sDr.not_ranked),
            pct: Number(((Number(sDr.not_ranked) / total) * 100).toFixed(1)),
          },
        },
      };

      /* Detail tables — one query each, returned as arrays for the FE
       to render. Heavy aggregations use window functions; keep them
       within the same scope filter ($1..$N). */

      /* Old combos detail — every (kw, platform) before current batch */
      const oldCombosRows = await pool.query(
        `WITH base AS (
         SELECT rr.id, rr.keyword_id, lower(rr.platform) AS platform,
                rr.date::date AS d, rr.ranking_position, rr.ranking_total, rr.status,
                ROW_NUMBER() OVER (PARTITION BY rr.keyword_id, lower(rr.platform) ORDER BY rr.date ASC, rr.id ASC) AS rn_asc,
                ROW_NUMBER() OVER (PARTITION BY rr.keyword_id, lower(rr.platform) ORDER BY rr.date DESC, rr.id DESC) AS rn_desc
         FROM ranking_reports rr
         WHERE ${where
           .replace(/\bdate\b/g, "rr.date")
           .replace(/\bkeyword_id\b/g, "rr.keyword_id")
           .replace(/\bclient_id\b/g, "rr.client_id")
           .replace(/\bbusiness_id\b/g, "rr.business_id")}
           AND rr.date < $${currentParamIdx}
       ),
       agg AS (
         SELECT keyword_id, platform,
           MIN(d) AS first_date, MAX(d) AS last_date,
           COUNT(*) AS total_runs,
           COUNT(*) FILTER (WHERE status = 'error') AS error_count,
           MAX(CASE WHEN rn_asc = 1 THEN ranking_position END) AS first_rank,
           MAX(CASE WHEN rn_desc = 1 THEN ranking_position END) AS latest_rank,
           MAX(CASE WHEN rn_desc = 1 THEN status END) AS latest_status
         FROM base GROUP BY keyword_id, platform
       )
       SELECT
         cl.business_name AS client,
         b.name AS business,
         k.id::int AS keyword_id,
         k.keyword_text AS keyword,
         a.platform,
         a.first_date::text AS first_audit,
         a.last_date::text AS latest_audit,
         a.total_runs::int,
         a.first_rank::int,
         a.latest_rank::int,
         a.error_count::int,
         a.latest_status AS last_status,
         (a.last_date + INTERVAL '14 days')::date::text AS next_due,
         CASE
           WHEN a.last_date >= (CURRENT_DATE - INTERVAL '14 days') THEN 'on_schedule'
           ELSE 'overdue'
         END AS status_class,
         GREATEST(0, (CURRENT_DATE - (a.last_date + INTERVAL '14 days')::date))::int AS days_overdue,
         CASE
           WHEN a.total_runs < 2 THEN NULL
           WHEN a.first_rank IS NULL OR a.latest_rank IS NULL THEN NULL
           ELSE (a.first_rank - a.latest_rank)::int
         END AS rank_change,
         CASE
           WHEN a.total_runs < 2 THEN 'single_run'
           WHEN a.latest_rank IS NULL OR a.first_rank IS NULL THEN 'not_ranked'
           WHEN a.latest_rank < a.first_rank THEN 'improved'
           WHEN a.latest_rank > a.first_rank THEN 'declined'
           ELSE 'no_change'
         END AS trend
       FROM agg a
       JOIN keywords k ON k.id = a.keyword_id
       LEFT JOIN clients cl ON cl.id = k.client_id
       LEFT JOIN businesses b ON b.id = k.business_id
       ORDER BY (a.last_date + INTERVAL '14 days') ASC, client, keyword, platform`,
        paramsWithBatch,
      );

      /* New combos detail — rows in the current batch (with prior-audit context) */
      const newCombosRows = await pool.query(
        `SELECT
         cl.business_name AS client,
         b.name AS business,
         rr.keyword AS keyword,
         lower(rr.platform) AS platform,
         rr.date::text AS audit_date,
         rr.ranking_position::int AS initial_rank,
         rr.ranking_total::text AS out_of_total,
         rr.status,
         (rr.date::date + INTERVAL '14 days')::date::text AS next_due,
         EXISTS (
           SELECT 1 FROM ranking_reports r2
           WHERE r2.keyword_id = rr.keyword_id
             AND lower(r2.platform) = lower(rr.platform)
             AND r2.date < rr.date
         ) AS has_prior
       FROM ranking_reports rr
       JOIN keywords k ON k.id = rr.keyword_id
       LEFT JOIN clients cl ON cl.id = k.client_id
       LEFT JOIN businesses b ON b.id = k.business_id
       WHERE ${where
         .replace(/\bdate\b/g, "rr.date")
         .replace(/\bkeyword_id\b/g, "rr.keyword_id")
         .replace(/\bclient_id\b/g, "rr.client_id")
         .replace(/\bbusiness_id\b/g, "rr.business_id")}
         AND rr.date = $${currentParamIdx}
       ORDER BY client, business, keyword, platform`,
        paramsWithBatch,
      );

      /* Ranking trend detail — for old-file combos with 2+ runs */
      const trendRows = await pool.query(
        `WITH base AS (
         SELECT rr.id, rr.keyword_id, lower(rr.platform) AS platform,
                rr.date::date AS d, rr.ranking_position,
                ROW_NUMBER() OVER (PARTITION BY rr.keyword_id, lower(rr.platform) ORDER BY rr.date ASC, rr.id ASC) AS rn_asc,
                ROW_NUMBER() OVER (PARTITION BY rr.keyword_id, lower(rr.platform) ORDER BY rr.date DESC, rr.id DESC) AS rn_desc,
                COUNT(*) OVER (PARTITION BY rr.keyword_id, lower(rr.platform)) AS run_count
         FROM ranking_reports rr
         WHERE ${where
           .replace(/\bdate\b/g, "rr.date")
           .replace(/\bkeyword_id\b/g, "rr.keyword_id")
           .replace(/\bclient_id\b/g, "rr.client_id")
           .replace(/\bbusiness_id\b/g, "rr.business_id")}
           AND rr.date < $${currentParamIdx}
       ),
       paired AS (
         SELECT keyword_id, platform,
                MAX(CASE WHEN rn_asc = 1 THEN d END) AS first_date,
                MAX(CASE WHEN rn_asc = 1 THEN ranking_position END) AS first_rank,
                MAX(CASE WHEN rn_desc = 1 THEN d END) AS latest_date,
                MAX(CASE WHEN rn_desc = 1 THEN ranking_position END) AS latest_rank
         FROM base WHERE run_count >= 2
         GROUP BY keyword_id, platform
       )
       SELECT
         cl.business_name AS client,
         k.keyword_text AS keyword,
         p.platform,
         p.first_date::text AS first_audit,
         p.first_rank::int,
         p.latest_date::text AS latest_audit,
         p.latest_rank::int,
         CASE
           WHEN p.first_rank IS NULL OR p.latest_rank IS NULL THEN NULL
           ELSE (p.first_rank - p.latest_rank)::int
         END AS rank_change,
         CASE
           WHEN p.latest_rank IS NULL THEN 'not_ranked'
           WHEN p.first_rank IS NULL THEN 'not_ranked'
           WHEN p.latest_rank < p.first_rank THEN 'improved'
           WHEN p.latest_rank > p.first_rank THEN 'declined'
           ELSE 'no_change'
         END AS trend
       FROM paired p
       JOIN keywords k ON k.id = p.keyword_id
       LEFT JOIN clients cl ON cl.id = k.client_id
       ORDER BY
         CASE
           WHEN p.latest_rank IS NULL OR p.first_rank IS NULL THEN 0
           ELSE p.latest_rank - p.first_rank
         END DESC,
         client, keyword, platform`,
        paramsWithBatch,
      );

      /* Errors — all audit_logs error rows scoped to old file (before current batch) */
      const errorsParams: (number | string | null)[] = [currentBatchDate];
      let errClientFilter = "";
      let errBusinessFilter = "";
      if (clientId !== null) {
        errorsParams.push(clientId);
        errClientFilter = `AND al.client_id = $${errorsParams.length}`;
      }
      if (businessId !== null) {
        errorsParams.push(businessId);
        errBusinessFilter = `AND al.business_id = $${errorsParams.length}`;
      }
      const errorsRows = await pool.query(
        `SELECT
         cl.business_name AS client,
         al.keyword_text AS keyword,
         lower(al.platform) AS platform,
         to_char(((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York'),'YYYY-MM-DD') AS error_date,
         al.duration_seconds::float AS duration,
         (al.response_text IS NOT NULL AND length(al.response_text) > 0) AS has_response,
         EXISTS (
           SELECT 1 FROM ranking_reports rr
           WHERE rr.keyword_id = al.keyword_id
             AND lower(rr.platform) = lower(al.platform)
             AND rr.status = 'success'
             AND rr.date::date > ((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date
         ) AS recovered,
         al.error AS error_message
       FROM audit_logs al
       LEFT JOIN clients cl ON cl.id = al.client_id
       WHERE al.status = 'error'
         AND ((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date < $1::date
         ${errClientFilter}
         ${errBusinessFilter}
       ORDER BY error_date DESC, client, keyword`,
        errorsParams,
      );

      /* Platform scorecards — old file + new file + old-file trend */
      const platformOld = await pool.query(
        `WITH latest_per_combo AS (
         SELECT DISTINCT ON (keyword_id, lower(platform))
                lower(platform) AS platform, ranking_position
         FROM ranking_reports rr
         WHERE ${where
           .replace(/\bdate\b/g, "rr.date")
           .replace(/\bkeyword_id\b/g, "rr.keyword_id")
           .replace(/\bclient_id\b/g, "rr.client_id")
           .replace(/\bbusiness_id\b/g, "rr.business_id")}
           AND rr.date < $${currentParamIdx}
         ORDER BY keyword_id, lower(platform), rr.date DESC, rr.id DESC
       )
       SELECT
         platform,
         COUNT(*)::int AS total_combos,
         COUNT(*) FILTER (WHERE ranking_position BETWEEN 1 AND 3)::int AS in_top3,
         COUNT(*) FILTER (WHERE ranking_position BETWEEN 1 AND 5)::int AS in_top5,
         ROUND(AVG(ranking_position) FILTER (WHERE ranking_position BETWEEN 1 AND 25)::numeric, 1)::float AS avg_rank,
         COUNT(*) FILTER (WHERE ranking_position IS NULL OR ranking_position = 0)::int AS not_ranked
       FROM latest_per_combo
       GROUP BY platform ORDER BY platform`,
        paramsWithBatch,
      );
      const platformNew = await pool.query(
        `SELECT
         lower(platform) AS platform,
         COUNT(*)::int AS total_combos,
         COUNT(*) FILTER (WHERE ranking_position BETWEEN 1 AND 3)::int AS in_top3,
         COUNT(*) FILTER (WHERE ranking_position BETWEEN 1 AND 5)::int AS in_top5,
         ROUND(AVG(ranking_position) FILTER (WHERE ranking_position BETWEEN 1 AND 25)::numeric, 1)::float AS avg_rank,
         COUNT(*) FILTER (WHERE ranking_position > 25)::int AS rank_26_plus
       FROM ranking_reports rr
       WHERE ${where
         .replace(/\bdate\b/g, "rr.date")
         .replace(/\bkeyword_id\b/g, "rr.keyword_id")
         .replace(/\bclient_id\b/g, "rr.client_id")
         .replace(/\bbusiness_id\b/g, "rr.business_id")}
         AND rr.date = $${currentParamIdx}
       GROUP BY lower(platform) ORDER BY lower(platform)`,
        paramsWithBatch,
      );
      const platformTrend = await pool.query(
        `WITH base AS (
         SELECT rr.keyword_id, lower(rr.platform) AS platform, rr.id, rr.date::date AS d, rr.ranking_position,
                ROW_NUMBER() OVER (PARTITION BY rr.keyword_id, lower(rr.platform) ORDER BY rr.date ASC, rr.id ASC) AS rn_asc,
                ROW_NUMBER() OVER (PARTITION BY rr.keyword_id, lower(rr.platform) ORDER BY rr.date DESC, rr.id DESC) AS rn_desc,
                COUNT(*) OVER (PARTITION BY rr.keyword_id, lower(rr.platform)) AS run_count
         FROM ranking_reports rr
         WHERE ${where
           .replace(/\bdate\b/g, "rr.date")
           .replace(/\bkeyword_id\b/g, "rr.keyword_id")
           .replace(/\bclient_id\b/g, "rr.client_id")
           .replace(/\bbusiness_id\b/g, "rr.business_id")}
           AND rr.date < $${currentParamIdx}
       ),
       paired AS (
         SELECT keyword_id, platform,
                MAX(CASE WHEN rn_asc = 1 THEN ranking_position END) AS first_rank,
                MAX(CASE WHEN rn_desc = 1 THEN ranking_position END) AS latest_rank
         FROM base WHERE run_count >= 2
         GROUP BY keyword_id, platform
       )
       SELECT
         platform,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE first_rank IS NOT NULL AND latest_rank IS NOT NULL AND latest_rank < first_rank)::int AS improved,
         COUNT(*) FILTER (WHERE first_rank IS NOT NULL AND latest_rank IS NOT NULL AND latest_rank > first_rank)::int AS declined,
         COUNT(*) FILTER (WHERE first_rank IS NOT NULL AND latest_rank IS NOT NULL AND latest_rank = first_rank)::int AS no_change,
         COUNT(*) FILTER (WHERE latest_rank IS NULL OR first_rank IS NULL)::int AS not_ranked
       FROM paired GROUP BY platform ORDER BY platform`,
        paramsWithBatch,
      );

      /* Client Health Matrix — one row per client, columns are the batch dates.
       Each cell carries success/error counts so the FE can color-code. */
      const clientMatrixRows = await pool.query(
        `WITH per_batch AS (
         SELECT
           rr.client_id,
           rr.date::text AS batch_date,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE rr.status = 'success')::int AS success,
           COUNT(*) FILTER (WHERE rr.status = 'error')::int AS errors,
           COUNT(*) FILTER (WHERE rr.ranking_position IS NOT NULL AND rr.ranking_position <= 3)::int AS in_top3
         FROM ranking_reports rr
         WHERE ${where
           .replace(/\bdate\b/g, "rr.date")
           .replace(/\bkeyword_id\b/g, "rr.keyword_id")
           .replace(/\bclient_id\b/g, "rr.client_id")
           .replace(/\bbusiness_id\b/g, "rr.business_id")}
         GROUP BY rr.client_id, rr.date
       ),
       client_totals AS (
         SELECT
           client_id,
           SUM(total) AS lifetime_total,
           MAX(batch_date) AS last_batch
         FROM per_batch GROUP BY client_id
       )
       SELECT
         cl.id::int AS client_id,
         cl.business_name AS client,
         ct.last_batch,
         (ct.last_batch::date + INTERVAL '14 days')::date::text AS next_due,
         CASE
           WHEN ct.last_batch::date < (CURRENT_DATE - INTERVAL '14 days') THEN 'overdue'
           ELSE 'on_schedule'
         END AS status_class,
         GREATEST(0, (CURRENT_DATE - (ct.last_batch::date + INTERVAL '14 days')::date))::int AS days_overdue,
         COALESCE(
           json_agg(
             json_build_object(
               'date', pb.batch_date,
               'total', pb.total,
               'success', pb.success,
               'errors', pb.errors,
               'in_top3', pb.in_top3
             ) ORDER BY pb.batch_date DESC
           ) FILTER (WHERE pb.batch_date IS NOT NULL),
           '[]'::json
         ) AS batches
       FROM client_totals ct
       JOIN clients cl ON cl.id = ct.client_id
       LEFT JOIN per_batch pb ON pb.client_id = ct.client_id
       GROUP BY cl.id, cl.business_name, ct.last_batch
       ORDER BY
         CASE WHEN ct.last_batch::date < (CURRENT_DATE - INTERVAL '14 days') THEN 0 ELSE 1 END,
         ct.last_batch ASC,
         cl.business_name`,
        params,
      );

      res.json({
        currentBatch: sectionA,
        oldFile: sectionB,
        rankingTrend: sectionC,
        initialRanking: sectionD,
        allBatches,
        clientMatrix: clientMatrixRows.rows,
        details: {
          oldCombos: oldCombosRows.rows,
          newCombos: newCombosRows.rows,
          rankingTrendRows: trendRows.rows,
          errors: errorsRows.rows,
          platformOld: platformOld.rows,
          platformNew: platformNew.rows,
          platformTrend: platformTrend.rows,
        },
      });
    } catch (err) {
      req.log.error({ err }, "Error building bi-weekly report");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* GET /api/ranking-reports/:id/screenshot-url
   Resolves the row's screenshot_url into a viewable URL for the admin UI:
     - "s3://..." → pre-signed GET URL (15 min TTL)
     - "https://..." / "http://..." → returned as-is
     - local path or null → returned as { url: null, kind } so the FE can hide
       the screenshot section without erroring.
   Requires no auth — viewing a row's screenshot is allowed for any admin
   that can see the row itself; rate-limited by the App Runner front. */
router.get("/:id/screenshot-url", requireSalesAllowed, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "invalid id" });
  }
  try {
    const rows = await db
      .select({
        url: rankingReportsTable.screenshotUrl,
        clientId: rankingReportsTable.clientId,
      })
      .from(rankingReportsTable)
      .where(eq(rankingReportsTable.id, id))
      .limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: "ranking report not found" });
    }
    if (isSales(req)) {
      const eligibleIds = await getSalesEligibleClientIds(req);
      if (!eligibleIds || !eligibleIds.includes(rows[0].clientId)) {
        return res.status(404).json({ error: "ranking report not found" });
      }
    }
    const raw = rows[0].url ?? null;
    if (!raw) {
      return res.json({ url: null, kind: "none" });
    }
    if (raw.startsWith("s3://")) {
      const m = raw.match(/^s3:\/\/([^/]+)\/(.+)$/);
      if (!m) {
        return res.status(500).json({ error: "malformed s3 url" });
      }
      const [, bucket, key] = m;
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const url = await getSignedUrl(s3Client, cmd, { expiresIn: 900 });
      return res.json({
        url,
        kind: "s3",
        expiresIn: 900,
      });
    }
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return res.json({ url: raw, kind: "external" });
    }
    /* Local path or relative — not servable from the admin panel. */
    return res.json({ url: null, kind: "local", originalPath: raw });
  } catch (err) {
    req.log.error({ err, id }, "Error generating screenshot URL");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
