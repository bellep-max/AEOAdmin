import { Router } from "express";
import { db } from "@workspace/db";
import { sessionsTable, keywordsTable, clientsTable } from "@workspace/db/schema";
import { eq, count, sql, and } from "drizzle-orm";

const router = Router();

// Session breakdown metrics matching the AEO operations spreadsheet structure
router.get("/session-breakdown", async (req, res) => {
  try {
    const plans = [
      { name: "Starter", totalPerDay: 15, totalPerMonth: 450 },
      { name: "Growth", totalPerDay: 27, totalPerMonth: 810 },
      { name: "Pro", totalPerDay: 40, totalPerMonth: 1200 },
    ];

    const breakdown = {
      plans,
      initialReport: {
        label: "Prompt Searches - Geo Specific - Initial Report",
        description: "Baseline ranking capture before AEO campaign begins",
        perPlan: [
          { planName: "Starter", currentSearches: 0, futureSearches: 5 },
          { planName: "Growth", currentSearches: 0, futureSearches: 5 },
          { planName: "Pro", currentSearches: 0, futureSearches: 5 },
        ],
        subtotals: { current: [0, 0, 0], future: [5, 5, 5] },
      },
      type1: {
        label: "Prompt Searches - Geo Specific - Type 1",
        description: "Primary geo-targeted AEO prompt searches",
        percentage: 60,
        searchPercentage: 100,
        perPlan: [
          { planName: "Starter", currentSearches: 0, futureSearches: 5 },
          { planName: "Growth", currentSearches: 0, futureSearches: 12 },
          { planName: "Pro", currentSearches: 0, futureSearches: 15 },
        ],
        subtotals: { current: [0, 0, 0], future: [5, 12, 15] },
      },
      type2: {
        label: "Prompt Searches - Geo Specific - Type 2 (Backlink Searches)",
        description: "Backlink click searches. Backlinks are only made off of 1st keywords.",
        percentage: 10,
        searchPercentage: null,
        note: "Current process: search the backlink. Future process: do NOT search the backlink.",
        perPlan: [
          { planName: "Starter", currentSearches: 5, futureSearches: 5 },
          { planName: "Growth", currentSearches: 17, futureSearches: 5 },
          { planName: "Pro", currentSearches: 30, futureSearches: 7 },
        ],
        subtotals: { current: [5, 17, 30], future: [5, 5, 7] },
        backlinkNote: "Backlinks are only made off of 1st words",
      },
      totalsPerDay: {
        current: [15, 27, 40],
        future: [5, 12, 15],
      },
      totalsPerMonth: {
        current: [450, 810, 1200],
        future: [150, 360, 450],
      },
      discrepancyReports: [
        { id: 1, label: "Business name verification", description: "Verify business name matches GMB exactly" },
        { id: 2, label: "First choice word verification", description: "Confirm primary keyword is being used correctly" },
        { id: 3, label: "Total # of SEO searches / day / per word", description: "Including data re: randomization and alteration" },
        { id: 4, label: "1 search per device", description: "Maximum 1 AEO search per device per day (daily rotation)" },
        { id: 5, label: "Popular point data", description: "Track popularity signals across AI platforms" },
        { id: 6, label: "Direct popup data", description: "Monitor direct AI result popup appearances" },
        { id: 7, label: "Cross client data", description: "Cross-reference performance data across clients" },
        { id: 8, label: "Google map rank location", description: "Via Local Falcon API — track GMB map ranking position" },
      ],
      userDashboard: {
        label: "User Dashboard",
        description: "Subtotals for each section per word",
        sections: [
          { label: "Initial Report Subtotals", perWord: true },
          { label: "Type 1 Subtotals", perWord: true },
          { label: "Type 2 Backlink Subtotals", perWord: true },
          { label: "Daily Total", perWord: false },
          { label: "Monthly Total", perWord: false },
        ],
      },
    };

    // Enrich with live DB stats
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
      .from(keywordsTable)
      .where(eq(keywordsTable.tierLabel, "aeo"));

    res.json({
      ...breakdown,
      liveStats: {
        totalSessionsRun: Number(totalSessions.count),
        followupRate: Number(totalSessions.count) > 0
          ? (Number(withFollowup.count) / Number(totalSessions.count)) * 100
          : 50,
        activeClients: Number(activeClients.count),
        aeoKeywordsActive: Number(aeoKeywords.count),
        searchesPerDayPerDevice: 1,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching session breakdown metrics");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
