/**
 * @file metrics.ts
 * @route /api/metrics
 *
 * Three distinct analytics endpoints used by the Business Metrics dashboard:
 *
 *   GET /session-breakdown   — AEO session plan structure (Type 1 / Type 2
 *                              prompt splits, per-plan volumes, discrepancy
 *                              report types) enriched with live DB counts.
 *
 *   GET /business            — Per-client performance matrix: device rotation,
 *                              IP rotation, cache clearing, prompt accuracy,
 *                              and volume accuracy for every client.
 *
 *   GET /performance         — Aggregate performance KPIs across all sessions
 *                              (farm-wide device/proxy rotation, accuracy).
 *
 *   PATCH /performance/:key  — Update the target or current value for one
 *                              performance KPI key in farm_metrics.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  sessionsTable,
  keywordsTable,
  clientsTable,
  farmMetrics,
} from "@workspace/db/schema";
import { eq, count, sql, isNotNull, inArray } from "drizzle-orm";
import { ok, serverError } from "../lib/response";
import "../middleware/auth";

const router = Router();

/**
 * GET /api/metrics/session-breakdown
 */
router.get("/session-breakdown", async (req, res) => {
  try {
    // ── Static session plan structure ──────────────────────────────────────
    const plans = [
      { name: "Starter", totalPerDay: 15, totalPerMonth: 450  },
      { name: "Growth",  totalPerDay: 27, totalPerMonth: 810  },
      { name: "Pro",     totalPerDay: 40, totalPerMonth: 1200 },
    ];

    const breakdown = {
      plans,

      type1: {
        label: "Prompt Searches - Geo Specific - Type 1",
        description: "Primary geo-targeted AEO prompt searches. 100% search rate across all plans.",
        percentage: 60,
        searchPercentage: 100,
        perPlan: [
          { planName: "Starter", currentSearches: 0, futureSearches: 5  },
          { planName: "Growth",  currentSearches: 0, futureSearches: 12 },
          { planName: "Pro",     currentSearches: 0, futureSearches: 15 },
        ],
        subtotals: { current: [0, 0, 0], future: [5, 12, 15] },
      },

      type2: {
        label: "Prompt Searches - Geo Specific - Type 2",
        description: "Backlink prompt searches. Backlinks are only made off of 1st/primary keywords.",
        percentage: 10,
        note: "Current process: we search the backlink. Future process: we do NOT search the backlink.",
        perPlan: [
          { planName: "Starter", currentSearches: 5,  futureSearches: 5 },
          { planName: "Growth",  currentSearches: 17, futureSearches: 5 },
          { planName: "Pro",     currentSearches: 30, futureSearches: 7 },
        ],
        subtotals: { current: [5, 17, 30], future: [5, 5, 7] },
        backlinkNote: "Backlinks are only made off of 1st/primary keywords",
      },

      totalsPerDay:   { current: [15, 27, 40], future: [5, 12, 15]    },
      totalsPerMonth: { current: [450, 810, 1200], future: [150, 360, 450] },

      discrepancyReports: [
        { id: 1, label: "Business name verification",               description: "Verify business name matches GBP listing exactly" },
        { id: 2, label: "First choice word verification",           description: "Confirm primary keyword (1st word) is being used correctly" },
        { id: 3, label: "Total # of AEO searches / day / per word", description: "Including data re: randomization and alteration across AI platforms" },
        { id: 4, label: "1 search per device",                      description: "Maximum 1 AEO prompt search per device per day (daily rotation)" },
        { id: 5, label: "Popular point data",                        description: "Track popularity signals across Gemini, ChatGPT, and Perplexity" },
        { id: 6, label: "Direct popup data",                        description: "Monitor direct AI result popup appearances per keyword" },
        { id: 7, label: "Cross client data",                        description: "Cross-reference AEO performance data across clients" },
        { id: 8, label: "Google map rank location",                 description: "Via Local Falcon API — track GBP map ranking position" },
      ],

      userDashboard: {
        label: "User Dashboard",
        description: "Subtotals shown per keyword per search cycle",
        sections: [
          { label: "Type 1 Subtotals",         perWord: true  },
          { label: "Type 2 Backlink Subtotals", perWord: true  },
          { label: "Daily Total",               perWord: false },
          { label: "Monthly Total",             perWord: false },
        ],
      },
    };

    // ── Live stats from DB ─────────────────────────────────────────────────
    const [totalSessions] = await db.select({ count: count() }).from(sessionsTable);

    const [withFollowup] = await db
      .select({ count: count() })
      .from(sessionsTable)
      .where(sql`${sessionsTable.followupText} IS NOT NULL`);

    const [activeClients] = await db
      .select({ count: count() })
      .from(clientsTable)
      .where(eq(clientsTable.status, "active"));

    const [aeoKeywords] = await db
      .select({ count: count() })
      .from(keywordsTable);

    ok(res, {
      ...breakdown,
      liveStats: {
        totalSessionsRun:        Number(totalSessions.count),
        followupRate:            Number(totalSessions.count) > 0
          ? (Number(withFollowup.count) / Number(totalSessions.count)) * 100
          : 50,
        activeClients:           Number(activeClients.count),
        aeoKeywordsActive:       Number(aeoKeywords.count),
        searchesPerDayPerDevice: 1,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching session breakdown metrics");
    serverError(res);
  }
});

/**
 * GET /api/metrics/business
 */
router.get("/business", async (req, res) => {
  try {
    const clients = await db.select().from(clientsTable);

    const rows = await db
      .select({
        clientId:      sessionsTable.clientId,
        total:         sql<number>`COUNT(*)`,
        withDevice:    sql<number>`COUNT(${sessionsTable.deviceId})`,
        uniqueDevices: sql<number>`COUNT(DISTINCT ${sessionsTable.deviceId})`,
        withProxy:     sql<number>`COUNT(${sessionsTable.proxyId})`,
        uniqueProxies: sql<number>`COUNT(DISTINCT ${sessionsTable.proxyId})`,
        withPrompt:    sql<number>`COUNT(${sessionsTable.promptText})`,
      })
      .from(sessionsTable)
      .groupBy(sessionsTable.clientId);

    const kwRows = await db
      .select({ clientId: keywordsTable.clientId, cnt: sql<number>`COUNT(*)` })
      .from(keywordsTable)
      .groupBy(keywordsTable.clientId);

    const devRows = await db
      .select({
        clientId:         sessionsTable.clientId,
        deviceIdentifier: sql<string>`MIN(${sql.raw('"devices"."device_identifier"')})`,
        model:            sql<string>`MIN(${sql.raw('"devices"."model"')})`,
        deviceId:         sessionsTable.deviceId,
      })
      .from(sessionsTable)
      .leftJoin(sql`devices ON devices.id = ${sessionsTable.deviceId}`, sql`true`)
      .where(isNotNull(sessionsTable.deviceId))
      .groupBy(sessionsTable.clientId, sessionsTable.deviceId);

    const cacheRow    = await db.select().from(farmMetrics).where(eq(farmMetrics.key, "cache_clearing")).limit(1);
    const cacheValue  = cacheRow[0]?.value        ? parseFloat(cacheRow[0].value)       : null;
    const cacheTarget = cacheRow[0]?.targetValue  ? parseFloat(cacheRow[0].targetValue) : 100;

    const KEYS = ["device_rotation", "ip_rotation", "cache_clearing", "prompt_exec_accuracy", "volume_search_accuracy"];
    const fmRows = await db.select().from(farmMetrics).where(inArray(farmMetrics.key, KEYS));

    const targets: Record<string, number> = {
      device_rotation: 80, ip_rotation: 90, cache_clearing: 100,
      prompt_exec_accuracy: 95, volume_search_accuracy: 98,
    };
    for (const row of fmRows) {
      targets[row.key] = row.targetValue ? parseFloat(row.targetValue) : targets[row.key];
    }

    const statsByClient = Object.fromEntries(rows.map((r) => [r.clientId, r]));
    const kwByClient    = Object.fromEntries(kwRows.map((r) => [r.clientId, Number(r.cnt)]));

    const devicesByClient: Record<number, { deviceId: number; identifier: string; model: string }[]> = {};
    for (const dr of devRows) {
      if (!devicesByClient[dr.clientId]) devicesByClient[dr.clientId] = [];
      devicesByClient[dr.clientId].push({
        deviceId:   dr.deviceId!,
        identifier: dr.deviceIdentifier ?? `DEV-${dr.deviceId}`,
        model:      dr.model ?? "Unknown",
      });
    }

    const result = clients.map((client) => {
      const s = statsByClient[client.id];

      const total         = s ? Number(s.total)         : 0;
      const withDevice    = s ? Number(s.withDevice)    : 0;
      const uniqueDevs    = s ? Number(s.uniqueDevices) : 0;
      const withProxy     = s ? Number(s.withProxy)     : 0;
      const uniqueProxies = s ? Number(s.uniqueProxies) : 0;
      const withPrompt    = s ? Number(s.withPrompt)    : 0;
      const activeKws     = kwByClient[client.id] ?? 0;

      const monthlyTarget = activeKws * 30;

      const deviceRotation = withDevice    > 0 ? Math.round((Math.min(uniqueDevs, withDevice)       / withDevice)    * 100) : null;
      const ipRotation     = withProxy     > 0 ? Math.round((Math.min(uniqueProxies, withProxy)     / withProxy)     * 100) : null;
      const promptAccuracy = total         > 0 ? Math.round((withPrompt / total) * 100)                                     : null;
      const volumeAccuracy = monthlyTarget > 0 ? Math.min(100, Math.round((total / monthlyTarget)   * 100))                 : null;

      return {
        client: {
          id: client.id, name: client.businessName, status: client.status,
          plan: (client as any).plan ?? null,
        },
        sessionTotal:   total,
        devices:        devicesByClient[client.id] ?? [],
        activeKeywords: activeKws,
        monthlyTarget,
        deviceRotation: { value: deviceRotation, uniqueDevices: uniqueDevs, withDevice,    target: targets.device_rotation        },
        ipRotation:     { value: ipRotation,     uniqueProxies,              withProxy,    target: targets.ip_rotation            },
        cacheClearing:  { value: cacheValue,     isManual: true,                           target: cacheTarget                    },
        promptAccuracy: { value: promptAccuracy, withPrompt,                 total,        target: targets.prompt_exec_accuracy   },
        volumeAccuracy: { value: volumeAccuracy, actual: total, monthlyTarget,             target: targets.volume_search_accuracy },
      };
    });

    ok(res, { metrics: result, targets });
  } catch (err) {
    req.log.error({ err }, "Error fetching business metrics");
    serverError(res);
  }
});

/**
 * GET /api/metrics/performance
 */
router.get("/performance", async (req, res) => {
  try {
    const [totRow] = await db.select({ count: count() }).from(sessionsTable);
    const total    = Number(totRow.count);

    const [devRow]     = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.deviceId));
    const [uniqDevRow] = await db.select({ c: sql<number>`COUNT(DISTINCT ${sessionsTable.deviceId})` }).from(sessionsTable).where(isNotNull(sessionsTable.deviceId));
    const withDevice    = Number(devRow.count);
    const uniqueDevices = Number(uniqDevRow.c);
    const deviceRotation = withDevice > 0
      ? Math.round((Math.min(uniqueDevices, withDevice) / withDevice) * 100)
      : 0;

    const [proxyRow]     = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.proxyId));
    const [uniqProxyRow] = await db.select({ c: sql<number>`COUNT(DISTINCT ${sessionsTable.proxyId})` }).from(sessionsTable).where(isNotNull(sessionsTable.proxyId));
    const withProxy     = Number(proxyRow.count);
    const uniqueProxies = Number(uniqProxyRow.c);
    const ipRotation    = withProxy > 0
      ? Math.round((Math.min(uniqueProxies, withProxy) / withProxy) * 100)
      : 0;

    const [promptRow] = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.promptText));
    const withPrompt  = Number(promptRow.count);
    const promptAccuracy = total > 0 ? Math.round((withPrompt / total) * 100) : 0;

    const [kwRow]    = await db.select({ count: count() }).from(keywordsTable);
    const activeKws  = Number(kwRow.count);
    const monthlyTarget  = activeKws * 30;
    const volumeAccuracy = monthlyTarget > 0
      ? Math.min(100, Math.round((total / monthlyTarget) * 100))
      : 0;

    const cacheRow  = await db.select().from(farmMetrics).where(eq(farmMetrics.key, "cache_clearing")).limit(1);
    const cacheValue = cacheRow[0]?.value ?? null;

    const KEYS = ["device_rotation", "ip_rotation", "cache_clearing", "prompt_exec_accuracy", "volume_search_accuracy"];
    const fmRows = await db.select().from(farmMetrics).where(inArray(farmMetrics.key, KEYS));
    const targets:    Record<string, string>        = {};
    const updatedAts: Record<string, string | null> = {};
    for (const row of fmRows) {
      targets[row.key]    = row.targetValue ?? "100";
      updatedAts[row.key] = row.updatedAt ? row.updatedAt.toISOString() : null;
    }

    ok(res, {
      total,
      deviceRotation: { value: deviceRotation,  uniqueDevices,  withDevice,                target: targets["device_rotation"]        ?? "80",  updatedAt: updatedAts["device_rotation"]        },
      ipRotation:     { value: ipRotation,       uniqueProxies,  withProxy,                 target: targets["ip_rotation"]            ?? "90",  updatedAt: updatedAts["ip_rotation"]            },
      cacheClearing:  { value: cacheValue ? parseFloat(cacheValue) : null,                  target: targets["cache_clearing"]         ?? "100", updatedAt: updatedAts["cache_clearing"],  isManual: true },
      promptAccuracy: { value: promptAccuracy,   withPrompt,     total,                     target: targets["prompt_exec_accuracy"]   ?? "95",  updatedAt: updatedAts["prompt_exec_accuracy"]   },
      volumeAccuracy: { value: volumeAccuracy,   actual: total,  targetCount: monthlyTarget, target: targets["volume_search_accuracy"] ?? "98",  updatedAt: updatedAts["volume_search_accuracy"] },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching performance metrics");
    serverError(res);
  }
});

/**
 * PATCH /api/metrics/performance/:key
 */
router.patch("/performance/:key", async (req, res) => {
  try {
    const { key }           = req.params;
    const { target, value } = req.body as { target?: string; value?: string };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (target !== undefined) update.targetValue = String(target);
    if (value  !== undefined) update.value       = String(value);

    const existing = await db.select().from(farmMetrics).where(eq(farmMetrics.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(farmMetrics).set(update).where(eq(farmMetrics.key, key));
    }

    ok(res, { ok: true });
  } catch (err) {
    req.log.error({ err }, "Error updating performance metric");
    serverError(res);
  }
});

export default router;
