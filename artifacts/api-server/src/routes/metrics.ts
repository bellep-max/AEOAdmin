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

const router = Router();

/**
 * GET /api/metrics/session-breakdown
 *
 * Returns the AEO operations session model.  This is mostly static config
 * (from the original spreadsheet spec) but enriched with four live counts:
 *
 *   totalSessionsRun   — sessions row count
 *   followupRate       — % of sessions that have a followupText
 *   activeClients      — clients with status = "active"
 *   aeoKeywordsActive  — total keyword count
 *
 * Prompt type breakdown:
 *   Type 1 (60%) — Geo Specific, primary targeting, 100% search rate
 *   Type 2 (10%) — Backlink, primary keywords only, current vs future model
 */
router.get("/session-breakdown", async (req, res) => {
  try {
    // ── Static session plan structure ──────────────────────────────────────
    // These numbers represent the agreed-upon AEO operations model.
    // "current" = today's process; "future" = planned optimised model
    const plans = [
      { name: "Starter", totalPerDay: 15, totalPerMonth: 450  },
      { name: "Growth",  totalPerDay: 27, totalPerMonth: 810  },
      { name: "Pro",     totalPerDay: 40, totalPerMonth: 1200 },
    ];

    const breakdown = {
      plans,

      // Type 1: Geo-specific prompts — 60% of total session volume
      type1: {
        label: "Prompt Searches - Geo Specific - Type 1",
        description: "Primary geo-targeted AEO prompt searches. 100% search rate across all plans.",
        percentage: 60,
        searchPercentage: 100, // All Type 1 keywords are always searched
        perPlan: [
          { planName: "Starter", currentSearches: 0, futureSearches: 5  },
          { planName: "Growth",  currentSearches: 0, futureSearches: 12 },
          { planName: "Pro",     currentSearches: 0, futureSearches: 15 },
        ],
        subtotals: { current: [0, 0, 0], future: [5, 12, 15] },
      },

      // Type 2: Backlink prompts — 10% of total volume; applied to primary keywords only
      type2: {
        label: "Prompt Searches - Geo Specific - Type 2",
        description: "Backlink prompt searches. Backlinks are only made off of 1st/primary keywords.",
        percentage: 10,
        // Key operational change: future process no longer searches the backlink URL
        note: "Current process: we search the backlink. Future process: we do NOT search the backlink.",
        perPlan: [
          { planName: "Starter", currentSearches: 5,  futureSearches: 5 },
          { planName: "Growth",  currentSearches: 17, futureSearches: 5 },
          { planName: "Pro",     currentSearches: 30, futureSearches: 7 },
        ],
        subtotals: { current: [5, 17, 30], future: [5, 5, 7] },
        backlinkNote: "Backlinks are only made off of 1st/primary keywords",
      },

      // Daily and monthly aggregate totals across all plans
      totalsPerDay:   { current: [15, 27, 40], future: [5, 12, 15]    },
      totalsPerMonth: { current: [450, 810, 1200], future: [150, 360, 450] },

      // Discrepancy report types tracked per session for quality assurance
      discrepancyReports: [
        { id: 1, label: "Business name verification",               description: "Verify business name matches GBP listing exactly" },
        { id: 2, label: "First choice word verification",           description: "Confirm primary keyword (1st word) is being used correctly" },
        { id: 3, label: "Total # of AEO searches / day / per word", description: "Including data re: randomization and alteration across AI platforms" },
        { id: 4, label: "1 search per device",                      description: "Maximum 1 AEO prompt search per device per day (daily rotation)" },
        { id: 5, label: "Popular point data",                       description: "Track popularity signals across Gemini, ChatGPT, and Perplexity" },
        { id: 6, label: "Direct popup data",                        description: "Monitor direct AI result popup appearances per keyword" },
        { id: 7, label: "Cross client data",                        description: "Cross-reference AEO performance data across clients" },
        { id: 8, label: "Google map rank location",                 description: "Via Local Falcon API — track GBP map ranking position" },
      ],

      // User-facing dashboard subtotal groupings (shown per keyword per cycle)
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

    // ── Live stats from DB — appended to the static structure ─────────────
    const [totalSessions] = await db.select({ count: count() }).from(sessionsTable);

    // Sessions that contain a follow-up question (signals deeper AI interaction)
    const [withFollowup] = await db
      .select({ count: count() })
      .from(sessionsTable)
      .where(sql`${sessionsTable.followupText} IS NOT NULL`);

    const [activeClients] = await db
      .select({ count: count() })
      .from(clientsTable)
      .where(eq(clientsTable.status, "active"));

    // Count all keywords
    const [aeoKeywords] = await db
      .select({ count: count() })
      .from(keywordsTable);

    res.json({
      ...breakdown,
      liveStats: {
        totalSessionsRun:        Number(totalSessions.count),
        // Default 50% followup rate when no sessions exist yet
        followupRate:            Number(totalSessions.count) > 0
          ? (Number(withFollowup.count) / Number(totalSessions.count)) * 100
          : 50,
        activeClients:           Number(activeClients.count),
        aeoKeywordsActive:       Number(aeoKeywords.count),
        searchesPerDayPerDevice: 1, // Hard cap: 1 AEO search per device per day
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching session breakdown metrics");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/metrics/business
 *
 * Per-client performance matrix. For every client, computes five KPIs from
 * their sessions and compares them against farm_metrics targets:
 *
 *   deviceRotation  — unique devices used / sessions with a device
 *   ipRotation      — unique proxies used / sessions with a proxy
 *   cacheClearing   — manual value from farm_metrics (no session signal)
 *   promptAccuracy  — sessions with promptText / total sessions
 *   volumeAccuracy  — total sessions / (activeKeywords × 30)
 *
 * Also returns the list of physical devices each client's sessions ran on.
 */
router.get("/business", async (req, res) => {
  try {
    // Fetch all clients regardless of status (inactive clients show 0s)
    const clients = await db.select().from(clientsTable);

    // Single aggregation query for all session KPI signals, grouped by client
    const rows = await db
      .select({
        clientId:      sessionsTable.clientId,
        total:         sql<number>`COUNT(*)`,
        withDevice:    sql<number>`COUNT(${sessionsTable.deviceId})`,      // Sessions that have a device assigned
        uniqueDevices: sql<number>`COUNT(DISTINCT ${sessionsTable.deviceId})`, // How many distinct devices
        withProxy:     sql<number>`COUNT(${sessionsTable.proxyId})`,       // Sessions that have a proxy assigned
        uniqueProxies: sql<number>`COUNT(DISTINCT ${sessionsTable.proxyId})`,  // How many distinct proxies
        withPrompt:    sql<number>`COUNT(${sessionsTable.promptText})`,    // Sessions with a recorded prompt
      })
      .from(sessionsTable)
      .groupBy(sessionsTable.clientId);

    // AEO keyword count per client — drives the monthly volume target
    const kwRows = await db
      .select({ clientId: keywordsTable.clientId, cnt: sql<number>`COUNT(*)` })
      .from(keywordsTable)
      .groupBy(keywordsTable.clientId);

    // Device detail rows — used to render "which devices ran for this client"
    const devRows = await db
      .select({
        clientId:         sessionsTable.clientId,
        deviceIdentifier: sql<string>`MIN(${sql.raw('"devices"."device_identifier"')})`,
        model:            sql<string>`MIN(${sql.raw('"devices"."model"')})`,
        deviceId:         sessionsTable.deviceId,
      })
      .from(sessionsTable)
      .leftJoin(sql`devices ON devices.id = ${sessionsTable.deviceId}`)
      .where(isNotNull(sessionsTable.deviceId))
      .groupBy(sessionsTable.clientId, sessionsTable.deviceId);

    // Cache clearing is a manual metric — no automatic session signal exists
    const cacheRow    = await db.select().from(farmMetrics).where(eq(farmMetrics.key, "cache_clearing")).limit(1);
    const cacheValue  = cacheRow[0]?.value        ? parseFloat(cacheRow[0].value)       : null;
    const cacheTarget = cacheRow[0]?.targetValue  ? parseFloat(cacheRow[0].targetValue) : 100;

    // Pull KPI targets from farm_metrics so dashboard targets stay in sync
    // with any admin edits made on the Farm Metrics page
    const KEYS = ["device_rotation", "ip_rotation", "cache_clearing", "prompt_exec_accuracy", "volume_search_accuracy"];
    const fmRows = await db.select().from(farmMetrics).where(inArray(farmMetrics.key, KEYS));

    // Hard-coded fallback targets in case farm_metrics rows are missing
    const targets: Record<string, number> = {
      device_rotation: 80, ip_rotation: 90, cache_clearing: 100,
      prompt_exec_accuracy: 95, volume_search_accuracy: 98,
    };
    for (const row of fmRows) {
      targets[row.key] = row.targetValue ? parseFloat(row.targetValue) : targets[row.key];
    }

    // Convert array results to maps for O(1) lookup per client
    const statsByClient = Object.fromEntries(rows.map((r) => [r.clientId, r]));
    const kwByClient    = Object.fromEntries(kwRows.map((r) => [r.clientId, Number(r.cnt)]));

    // Group device detail rows by clientId for the device list per client
    const devicesByClient: Record<number, { deviceId: number; identifier: string; model: string }[]> = {};
    for (const dr of devRows) {
      if (!devicesByClient[dr.clientId]) devicesByClient[dr.clientId] = [];
      devicesByClient[dr.clientId].push({
        deviceId:   dr.deviceId!,
        identifier: dr.deviceIdentifier ?? `DEV-${dr.deviceId}`,
        model:      dr.model ?? "Unknown",
      });
    }

    // Compute final KPI values for each client
    const result = clients.map((client) => {
      const s = statsByClient[client.id];

      // Extract raw counts (default to 0 for clients with no sessions)
      const total         = s ? Number(s.total)         : 0;
      const withDevice    = s ? Number(s.withDevice)    : 0;
      const uniqueDevs    = s ? Number(s.uniqueDevices) : 0;
      const withProxy     = s ? Number(s.withProxy)     : 0;
      const uniqueProxies = s ? Number(s.uniqueProxies) : 0;
      const withPrompt    = s ? Number(s.withPrompt)    : 0;
      const activeKws     = kwByClient[client.id] ?? 0;

      // Monthly volume target: each AEO keyword should be searched once per day
      const monthlyTarget = activeKws * 30;

      // KPI calculations — null when no sessions exist (avoids false 0% values)
      const deviceRotation = withDevice    > 0 ? Math.round((Math.min(uniqueDevs, withDevice)       / withDevice)    * 100) : null;
      const ipRotation     = withProxy     > 0 ? Math.round((Math.min(uniqueProxies, withProxy)     / withProxy)     * 100) : null;
      const promptAccuracy = total         > 0 ? Math.round((withPrompt / total) * 100)                                     : null;
      const volumeAccuracy = monthlyTarget > 0 ? Math.min(100, Math.round((total / monthlyTarget)   * 100))                 : null;

      return {
        client: {
          id: client.id, name: client.name, status: client.status,
          plan: (client as any).plan ?? null,
        },
        sessionTotal:   total,
        devices:        devicesByClient[client.id] ?? [],
        activeKeywords: activeKws,
        monthlyTarget,
        // Each KPI includes the raw components so the frontend can show tooltips
        deviceRotation: { value: deviceRotation, uniqueDevices: uniqueDevs, withDevice,    target: targets.device_rotation        },
        ipRotation:     { value: ipRotation,     uniqueProxies,              withProxy,    target: targets.ip_rotation            },
        cacheClearing:  { value: cacheValue,     isManual: true,                           target: cacheTarget                    },
        promptAccuracy: { value: promptAccuracy, withPrompt,                 total,        target: targets.prompt_exec_accuracy   },
        volumeAccuracy: { value: volumeAccuracy, actual: total, monthlyTarget,             target: targets.volume_search_accuracy },
      };
    });

    res.json({ metrics: result, targets });
  } catch (err) {
    req.log.error({ err }, "Error fetching business metrics");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/metrics/performance
 *
 * Farm-wide aggregate performance KPIs computed from all sessions.
 * Same five metrics as the per-business endpoint but rolled up across the
 * entire session history. Used on the Device Farm / Business Metrics overview.
 *
 * Targets are read from farm_metrics so admin edits cascade here automatically.
 */
router.get("/performance", async (req, res) => {
  try {
    // ── Total session count ────────────────────────────────────────────────
    const [totRow] = await db.select({ count: count() }).from(sessionsTable);
    const total    = Number(totRow.count);

    // ── Device rotation ─────────────────────────────────────────────────
    // Formula: min(uniqueDevices, sessionsWithDevice) / sessionsWithDevice
    // min() caps the ratio at 100% when every session used a different device
    const [devRow]     = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.deviceId));
    const [uniqDevRow] = await db.select({ c: sql<number>`COUNT(DISTINCT ${sessionsTable.deviceId})` }).from(sessionsTable).where(isNotNull(sessionsTable.deviceId));
    const withDevice    = Number(devRow.count);
    const uniqueDevices = Number(uniqDevRow.c);
    const deviceRotation = withDevice > 0
      ? Math.round((Math.min(uniqueDevices, withDevice) / withDevice) * 100)
      : 0;

    // ── IP / proxy rotation ──────────────────────────────────────────────
    // Same formula applied to proxyId instead of deviceId
    const [proxyRow]     = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.proxyId));
    const [uniqProxyRow] = await db.select({ c: sql<number>`COUNT(DISTINCT ${sessionsTable.proxyId})` }).from(sessionsTable).where(isNotNull(sessionsTable.proxyId));
    const withProxy     = Number(proxyRow.count);
    const uniqueProxies = Number(uniqProxyRow.c);
    const ipRotation    = withProxy > 0
      ? Math.round((Math.min(uniqueProxies, withProxy) / withProxy) * 100)
      : 0;

    // ── Prompt execution accuracy ────────────────────────────────────────
    // Sessions where a promptText was recorded = successfully executed sessions
    const [promptRow] = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.promptText));
    const withPrompt  = Number(promptRow.count);
    const promptAccuracy = total > 0 ? Math.round((withPrompt / total) * 100) : 0;

    // ── Volume searches accuracy ─────────────────────────────────────────
    // Target: every AEO keyword is searched once per day → × 30 per month
    const [kwRow]    = await db.select({ count: count() }).from(keywordsTable);
    const activeKws  = Number(kwRow.count);
    const monthlyTarget  = activeKws * 30;
    // Cap at 100 — going over target is still a pass, not an error
    const volumeAccuracy = monthlyTarget > 0
      ? Math.min(100, Math.round((total / monthlyTarget) * 100))
      : 0;

    // ── Cache clearing: manual value from farm_metrics ───────────────────
    // No session signal exists for this — admins update it manually
    const cacheRow  = await db.select().from(farmMetrics).where(eq(farmMetrics.key, "cache_clearing")).limit(1);
    const cacheValue = cacheRow[0]?.value ?? null;

    // ── Targets and last-updated timestamps from farm_metrics ─────────────
    const KEYS = ["device_rotation", "ip_rotation", "cache_clearing", "prompt_exec_accuracy", "volume_search_accuracy"];
    const fmRows = await db.select().from(farmMetrics).where(inArray(farmMetrics.key, KEYS));
    const targets:    Record<string, string>        = {};
    const updatedAts: Record<string, string | null> = {};
    for (const row of fmRows) {
      targets[row.key]    = row.targetValue ?? "100";
      updatedAts[row.key] = row.updatedAt ? row.updatedAt.toISOString() : null;
    }

    res.json({
      total,
      deviceRotation: { value: deviceRotation,  uniqueDevices,  withDevice,                target: targets["device_rotation"]        ?? "80",  updatedAt: updatedAts["device_rotation"]        },
      ipRotation:     { value: ipRotation,       uniqueProxies,  withProxy,                 target: targets["ip_rotation"]            ?? "90",  updatedAt: updatedAts["ip_rotation"]            },
      cacheClearing:  { value: cacheValue ? parseFloat(cacheValue) : null,                  target: targets["cache_clearing"]         ?? "100", updatedAt: updatedAts["cache_clearing"],  isManual: true },
      promptAccuracy: { value: promptAccuracy,   withPrompt,     total,                     target: targets["prompt_exec_accuracy"]   ?? "95",  updatedAt: updatedAts["prompt_exec_accuracy"]   },
      volumeAccuracy: { value: volumeAccuracy,   actual: total,  targetCount: monthlyTarget, target: targets["volume_search_accuracy"] ?? "98",  updatedAt: updatedAts["volume_search_accuracy"] },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching performance metrics");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/metrics/performance/:key
 *
 * Updates a single performance KPI's target or current value in farm_metrics.
 * Performs an update-only (no insert) — the key must already exist from the
 * farm-metrics seed. This prevents phantom metric rows being created by typos.
 *
 * Body: { target?: string, value?: string }
 */
router.patch("/performance/:key", async (req, res) => {
  try {
    const { key }           = req.params;
    const { target, value } = req.body as { target?: string; value?: string };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (target !== undefined) update.targetValue = String(target);
    if (value  !== undefined) update.value       = String(value);

    // Check the row exists before updating to avoid silent no-ops
    const existing = await db.select().from(farmMetrics).where(eq(farmMetrics.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(farmMetrics).set(update).where(eq(farmMetrics.key, key));
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error updating performance metric");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
