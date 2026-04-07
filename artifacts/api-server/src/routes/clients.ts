import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  keywordsTable,
  keywordLinksTable,
  sessionsTable,
  rankingReportsTable,
} from "@workspace/db/schema";
import { eq, and, ilike, sql, desc, inArray } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { status, search } = req.query as Record<string, string>;
    let query = db.select().from(clientsTable);
    const conditions: ReturnType<typeof eq>[] = [];
    if (status === "active" || status === "inactive") {
      conditions.push(eq(clientsTable.status, status));
    }
    const clients = await db
      .select({
        ...clientsTable,
        keywordCount: sql<number>`(select count(*) from keywords where keywords.client_id = ${clientsTable.id})::int`,
      })
      .from(clientsTable)
      .where(
        conditions.length > 0
          ? and(...conditions)
          : undefined
      )
      .orderBy(desc(clientsTable.createdAt));

    const filtered = search
      ? clients.filter(
          (c) =>
            c.businessName.toLowerCase().includes(search.toLowerCase()) ||
            (c.city && c.city.toLowerCase().includes(search.toLowerCase()))
        )
      : clients;

    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "Error fetching clients");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body;
    
    const [client] = await db
      .insert(clientsTable)
      .values({
        // Business Information
        businessName: body.businessName,
        searchAddress: body.searchAddress ?? null,
        gmbUrl: body.gmbLink ?? null,
        websitePublishedOnGmb: body.websitePublishedOnGMB ?? null,
        websiteLinkedOnGmb: body.websiteLinkedOnGMB ?? null,
        
        // Subscription Information
        planName: body.plan ?? null,
        accountType: body.accountType ?? null,
        startDate: body.startDate ?? null,
        nextBillDate: body.nextBillDate ?? null,
        subscriptionId: body.subscriptionId ?? null,
        
        // Account Information
        accountUser: body.accountUser ?? null,
        accountUserName: body.accountUserName ?? null,
        accountEmail: body.accountEmail ?? null,
        billingEmail: body.billingEmail ?? null,
        lastFourCard: body.cardLast4 ?? null,
        
        // Default values
        status: body.status ?? "active",
        contactEmail: body.billingEmail ?? null,
        addressType: 1,
      })
      .returning();

    res.status(201).json({
      client,
      message: "Business created successfully",
    });
  } catch (err) {
    req.log.error({ err }, "Error creating client");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!client) return res.status(404).json({ error: "Not found" });
    res.json(client);
  } catch (err) {
    req.log.error({ err }, "Error fetching client");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body;
    const keywords = body.keywords ?? []; // Optional: array of keywords to add

    // Remove keywords from body so it doesn't try to update the client with it
    const clientUpdateData = { ...body };
    delete clientUpdateData.keywords;

    const [client] = await db
      .update(clientsTable)
      .set(clientUpdateData)
      .where(eq(clientsTable.id, id))
      .returning();

    if (!client) return res.status(404).json({ error: "Not found" });

    // Cascade status change to all keywords + their links for this client
    if (body.status === "inactive" || body.status === "active") {
      const isActive = body.status === "active";

      // 1. Update all keywords for this client
      await db
        .update(keywordsTable)
        .set({ isActive })
        .where(eq(keywordsTable.clientId, id));

      // 2. Update all keyword_links rows that belong to this client's keywords
      const clientKwIds = await db
        .select({ id: keywordsTable.id })
        .from(keywordsTable)
        .where(eq(keywordsTable.clientId, id));

      if (clientKwIds.length > 0) {
        await db
          .update(keywordLinksTable)
          .set({ linkActive: isActive })
          .where(inArray(keywordLinksTable.keywordId, clientKwIds.map((k) => k.id)));
      }
    }

    // If keywords are provided, add them for this client
    let addedKeywords: any[] = [];
    if (keywords.length > 0) {
      addedKeywords = await db
        .insert(keywordsTable)
        .values(
          keywords.map((kw: any) => ({
            clientId: client.id,
            keywordText: kw.keywordText || kw,
            linkTypeLabel: kw.linkTypeLabel ?? null,
            linkActive: kw.linkActive !== false,
            initialRankReportLink: kw.initialRankReportLink ?? null,
            currentRankReportLink: kw.currentRankReportLink ?? null,
          }))
        )
        .returning();
    }

    res.json({
      client,
      addedKeywords,
      addedKeywordCount: addedKeywords.length,
    });
  } catch (err) {
    req.log.error({ err }, "Error updating client");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(clientsTable).where(eq(clientsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting client");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/gbp-snippet", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!client) return res.status(404).json({ error: "Not found" });

    // Get most recent ranking report for maps presence
    const [latestReport] = await db
      .select({ mapsPresence: rankingReportsTable.mapsPresence, createdAt: rankingReportsTable.createdAt })
      .from(rankingReportsTable)
      .where(eq(rankingReportsTable.clientId, id))
      .orderBy(desc(rankingReportsTable.createdAt))
      .limit(1);

    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, id));

    const verificationStatus =
      keywords.length > 0 && keywords.every((k) => k.verificationStatus === "verified")
        ? "verified"
        : keywords.some((k) => k.verificationStatus === "failed")
        ? "failed"
        : "pending";

    res.json({
      clientId: client.id,
      businessName: client.businessName,
      gmbUrl: client.gmbUrl,
      placeId: client.placeId,
      verificationStatus,
      publishedAddress: client.publishedAddress,
      city: client.city,
      state: client.state,
      mapsPresence: latestReport?.mapsPresence ?? null,
      lastChecked: latestReport?.createdAt ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching GBP snippet");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/aeo-summary", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!client) return res.status(404).json({ error: "Not found" });

    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, id));

    const keywordIds = keywords.map((k) => k.id);

    // Get initial and current rankings for each keyword
    const rankingData: Record<number, { initial?: typeof rankingReportsTable.$inferSelect; current?: typeof rankingReportsTable.$inferSelect }> = {};
    for (const kwId of keywordIds) {
      const reports = await db
        .select()
        .from(rankingReportsTable)
        .where(and(eq(rankingReportsTable.clientId, id), eq(rankingReportsTable.keywordId, kwId)))
        .orderBy(rankingReportsTable.createdAt);

      rankingData[kwId] = {
        initial: reports.find((r) => r.isInitialRanking) ?? reports[0],
        current: reports[reports.length - 1],
      };
    }

    const totalClicks = 0;
    const allReportPositions = Object.values(rankingData)
      .map((r) => r.current?.rankingPosition)
      .filter((p): p is number => p != null);
    const avgPos = allReportPositions.length
      ? allReportPositions.reduce((a, b) => a + b, 0) / allReportPositions.length
      : null;

    // Sessions for date range
    const sessions = await db
      .select({ timestamp: sessionsTable.timestamp })
      .from(sessionsTable)
      .where(eq(sessionsTable.clientId, id))
      .orderBy(sessionsTable.timestamp);

    const aeoKeywords = keywords.map((k) => ({
      keywordId: k.id,
      keywordText: k.keywordText,
      initialRankingDate: rankingData[k.id]?.initial?.createdAt ?? null,
      initialRankingPosition: rankingData[k.id]?.initial?.rankingPosition ?? null,
      currentRankingPosition: rankingData[k.id]?.current?.rankingPosition ?? null,
      clicksDelivered: 0,
      verificationStatus: k.verificationStatus,
    }));

    res.json({
      clientId: client.id,
      businessName: client.businessName,
      aeoKeywords,
      totalClicksDelivered: totalClicks,
      averageRankingPosition: avgPos,
      startDate: sessions[0]?.timestamp ?? null,
      lastSessionDate: sessions[sessions.length - 1]?.timestamp ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching AEO summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
