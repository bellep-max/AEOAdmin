import { Router } from "express";
import { db } from "@workspace/db";
import { sessionsTable, keywordsTable, clientsTable, farmMetrics } from "@workspace/db/schema";
import { eq, count, sql, isNotNull } from "drizzle-orm";

const router = Router();

// Session breakdown metrics matching the AEO operations spreadsheet structure
router.get("/session-breakdown", async (req, res) => {
  try {
    const plans = [
      { name: "Starter", totalPerDay: 15, totalPerMonth: 450 },
      { name: "Growth",  totalPerDay: 27, totalPerMonth: 810 },
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
          { planName: "Starter", currentSearches: 0, futureSearches: 5 },
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
      totalsPerDay: {
        current: [15, 27, 40],
        future:  [5,  12, 15],
      },
      totalsPerMonth: {
        current: [450, 810, 1200],
        future:  [150, 360, 450],
      },
      discrepancyReports: [
        { id: 1, label: "Business name verification",          description: "Verify business name matches GBP listing exactly" },
        { id: 2, label: "First choice word verification",      description: "Confirm primary keyword (1st word) is being used correctly" },
        { id: 3, label: "Total # of AEO searches / day / per word", description: "Including data re: randomization and alteration across AI platforms" },
        { id: 4, label: "1 search per device",                 description: "Maximum 1 AEO prompt search per device per day (daily rotation)" },
        { id: 5, label: "Popular point data",                  description: "Track popularity signals across Gemini, ChatGPT, and Perplexity" },
        { id: 6, label: "Direct popup data",                   description: "Monitor direct AI result popup appearances per keyword" },
        { id: 7, label: "Cross client data",                   description: "Cross-reference AEO performance data across clients" },
        { id: 8, label: "Google map rank location",            description: "Via Local Falcon API — track GBP map ranking position" },
      ],
      userDashboard: {
        label: "User Dashboard",
        description: "Subtotals shown per keyword per search cycle",
        sections: [
          { label: "Type 1 Subtotals",          perWord: true  },
          { label: "Type 2 Backlink Subtotals",  perWord: true  },
          { label: "Daily Total",                perWord: false },
          { label: "Monthly Total",              perWord: false },
        ],
      },
    };

    // Enrich with live DB stats
    const [totalSessions] = await db.select({ count: count() }).from(sessionsTable);
    const [withFollowup]  = await db
      .select({ count: count() })
      .from(sessionsTable)
      .where(sql`${sessionsTable.followupText} IS NOT NULL`);

    const [activeClients] = await db
      .select({ count: count() })
      .from(clientsTable)
      .where(eq(clientsTable.status, "active"));

    const [aeoKeywords] = await db
      .select({ count: count() })
      .from(keywordsTable)
      .where(eq(keywordsTable.tierLabel, "aeo"));

    res.json({
      ...breakdown,
      liveStats: {
        totalSessionsRun:       Number(totalSessions.count),
        followupRate:           Number(totalSessions.count) > 0
          ? (Number(withFollowup.count) / Number(totalSessions.count)) * 100
          : 50,
        activeClients:          Number(activeClients.count),
        aeoKeywordsActive:      Number(aeoKeywords.count),
        searchesPerDayPerDevice: 1,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching session breakdown metrics");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Live performance metrics computed from sessions ─────── */
router.get("/performance", async (req, res) => {
  try {
    /* ─── Total sessions ─── */
    const [totRow]      = await db.select({ count: count() }).from(sessionsTable);
    const total         = Number(totRow.count);

    /* ─── Device rotation: % of sessions that have a deviceId ─── */
    const [devRow]      = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.deviceId));
    const [uniqDevRow]  = await db.select({ c: sql<number>`COUNT(DISTINCT ${sessionsTable.deviceId})` }).from(sessionsTable).where(isNotNull(sessionsTable.deviceId));
    const withDevice    = Number(devRow.count);
    const uniqueDevices = Number(uniqDevRow.c);
    // Device rotation = how many sessions used a different device (unique devices / sessions with device) * 100
    const deviceRotation = withDevice > 0 ? Math.round((Math.min(uniqueDevices, withDevice) / withDevice) * 100) : 0;

    /* ─── IP rotation: % of sessions using unique proxy ─── */
    const [proxyRow]    = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.proxyId));
    const [uniqProxyRow]= await db.select({ c: sql<number>`COUNT(DISTINCT ${sessionsTable.proxyId})` }).from(sessionsTable).where(isNotNull(sessionsTable.proxyId));
    const withProxy     = Number(proxyRow.count);
    const uniqueProxies = Number(uniqProxyRow.c);
    const ipRotation    = withProxy > 0 ? Math.round((Math.min(uniqueProxies, withProxy) / withProxy) * 100) : 0;

    /* ─── Prompt execution accuracy: sessions with promptText / total ─── */
    const [promptRow]   = await db.select({ count: count() }).from(sessionsTable).where(isNotNull(sessionsTable.promptText));
    const withPrompt    = Number(promptRow.count);
    const promptAccuracy = total > 0 ? Math.round((withPrompt / total) * 100) : 0;

    /* ─── Volume searches accuracy: actual vs AEO active keyword target ─── */
    const [kwRow]       = await db.select({ count: count() }).from(keywordsTable).where(eq(keywordsTable.tierLabel, "aeo"));
    const activeKws     = Number(kwRow.count);
    // Target per month = active keywords × 30 (1 search/day minimum target)
    const monthlyTarget = activeKws * 30;
    const volumeAccuracy = monthlyTarget > 0 ? Math.min(100, Math.round((total / monthlyTarget) * 100)) : 0;

    /* ─── Cache clearing: pull from farm_metrics (manual) ─── */
    const cacheRow      = await db.select().from(farmMetrics).where(eq(farmMetrics.key, "cache_clearing")).limit(1);
    const cacheValue    = cacheRow[0]?.value ?? null;

    /* ─── Targets from farm_metrics ─── */
    const KEYS = ["device_rotation", "ip_rotation", "cache_clearing", "prompt_exec_accuracy", "volume_search_accuracy"];
    const fmRows = await db.select().from(farmMetrics).where(sql`${farmMetrics.key} = ANY(${KEYS})`);
    const targets: Record<string, string> = {};
    const updatedAts: Record<string, string | null> = {};
    for (const row of fmRows) {
      targets[row.key]    = row.targetValue ?? "100";
      updatedAts[row.key] = row.updatedAt ? row.updatedAt.toISOString() : null;
    }

    res.json({
      total,
      deviceRotation:  { value: deviceRotation,  uniqueDevices,  withDevice,    target: targets["device_rotation"]       ?? "80",  updatedAt: updatedAts["device_rotation"]        },
      ipRotation:      { value: ipRotation,       uniqueProxies,  withProxy,     target: targets["ip_rotation"]           ?? "90",  updatedAt: updatedAts["ip_rotation"]            },
      cacheClearing:   { value: cacheValue ? parseFloat(cacheValue) : null,      target: targets["cache_clearing"]        ?? "100", updatedAt: updatedAts["cache_clearing"],  isManual: true },
      promptAccuracy:  { value: promptAccuracy,   withPrompt,     total,         target: targets["prompt_exec_accuracy"]  ?? "95",  updatedAt: updatedAts["prompt_exec_accuracy"]   },
      volumeAccuracy:  { value: volumeAccuracy,   actual: total,  targetCount: monthlyTarget, target: targets["volume_search_accuracy"] ?? "98", updatedAt: updatedAts["volume_search_accuracy"] },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching performance metrics");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH: update a single performance metric target ─────── */
router.patch("/performance/:key", async (req, res) => {
  try {
    const { key }   = req.params;
    const { target, value } = req.body as { target?: string; value?: string };
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (target !== undefined) update.targetValue = String(target);
    if (value  !== undefined) update.value       = String(value);

    // Upsert into farm_metrics
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
