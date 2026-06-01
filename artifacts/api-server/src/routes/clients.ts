import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  businessesTable,
  keywordsTable,
  keywordLinksTable,
  sessionsTable,
  rankingReportsTable,
  clientAeoPlansTable,
} from "@workspace/db/schema";
import { eq, and, ilike, sql, desc, inArray } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { status, search } = req.query as Record<string, string>;
    let query = db.select().from(clientsTable);
    const conditions: ReturnType<typeof eq>[] = [];
    /* Default to hiding archived clients (status='inactive') from every
       consumer (Rankings filter, Sessions filter, etc.). Pass status=all
       to surface everything, or status=inactive to see only archived. */
    const statusFilter =
      status === "all" ? null : status === "inactive" ? "inactive" : "active";
    if (statusFilter) {
      conditions.push(eq(clientsTable.status, statusFilter));
    }
    const baseClients = await db
      .select()
      .from(clientsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(clientsTable.createdAt));

    const ids = baseClients.map((c) => c.id);
    const counts = new Map<
      number,
      { keywordCount: number; businessCount: number; campaignCount: number }
    >();
    const planTypesMap = new Map<number, string[]>();
    if (ids.length > 0) {
      const kwRows = await db
        .select({
          clientId: keywordsTable.clientId,
          c: sql<number>`count(*)::int`,
        })
        .from(keywordsTable)
        .where(inArray(keywordsTable.clientId, ids))
        .groupBy(keywordsTable.clientId);
      const bizRows = await db
        .select({
          clientId: businessesTable.clientId,
          c: sql<number>`count(*)::int`,
        })
        .from(businessesTable)
        .where(inArray(businessesTable.clientId, ids))
        .groupBy(businessesTable.clientId);
      const campRows = await db
        .select({
          clientId: clientAeoPlansTable.clientId,
          c: sql<number>`count(*)::int`,
        })
        .from(clientAeoPlansTable)
        .where(inArray(clientAeoPlansTable.clientId, ids))
        .groupBy(clientAeoPlansTable.clientId);
      const planTypeRows = await db
        .select({
          clientId: clientAeoPlansTable.clientId,
          planType: clientAeoPlansTable.planType,
        })
        .from(clientAeoPlansTable)
        .where(inArray(clientAeoPlansTable.clientId, ids));
      for (const id of ids)
        counts.set(id, { keywordCount: 0, businessCount: 0, campaignCount: 0 });
      for (const r of kwRows) counts.get(r.clientId)!.keywordCount = r.c;
      for (const r of bizRows) counts.get(r.clientId)!.businessCount = r.c;
      for (const r of campRows) counts.get(r.clientId)!.campaignCount = r.c;
      for (const r of planTypeRows) {
        if (!planTypesMap.has(r.clientId)) planTypesMap.set(r.clientId, []);
        const pt = r.planType;
        if (pt && !planTypesMap.get(r.clientId)!.includes(pt))
          planTypesMap.get(r.clientId)!.push(pt);
      }
    }
    const clients = baseClients.map((c) => ({
      ...c,
      keywordCount: counts.get(c.id)?.keywordCount ?? 0,
      businessCount: counts.get(c.id)?.businessCount ?? 0,
      campaignCount: counts.get(c.id)?.campaignCount ?? 0,
      planTypes: planTypesMap.get(c.id) ?? [],
    }));

    const filtered = search
      ? clients.filter(
          (c) =>
            c.businessName.toLowerCase().includes(search.toLowerCase()) ||
            (c.city && c.city.toLowerCase().includes(search.toLowerCase())),
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

    const trimmedName = String(body.businessName ?? "").trim();
    if (!trimmedName) {
      return res.status(400).json({ error: "businessName is required" });
    }

    const [existing] = await db
      .select({ id: clientsTable.id, businessName: clientsTable.businessName })
      .from(clientsTable)
      .where(
        sql`lower(trim(${clientsTable.businessName})) = lower(${trimmedName})`,
      )
      .limit(1);
    if (existing) {
      return res.status(409).json({
        error: `A client named "${existing.businessName}" already exists (id ${existing.id}). Pick a different name or edit the existing client.`,
        conflictId: existing.id,
      });
    }

    const [client] = await db
      .insert(clientsTable)
      .values({
        // Business Information
        businessName: trimmedName,
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
        createdBy: body.createdBy ?? null,
        notes: body.notes ?? null,
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

    // Reject renames that would collide with another client
    if (typeof clientUpdateData.businessName === "string") {
      const trimmed = clientUpdateData.businessName.trim();
      if (!trimmed) {
        return res.status(400).json({ error: "businessName cannot be empty" });
      }
      const [conflict] = await db
        .select({
          id: clientsTable.id,
          businessName: clientsTable.businessName,
        })
        .from(clientsTable)
        .where(
          and(
            sql`lower(trim(${clientsTable.businessName})) = lower(${trimmed})`,
            sql`${clientsTable.id} <> ${id}`,
          ),
        )
        .limit(1);
      if (conflict) {
        return res.status(409).json({
          error: `Another client named "${conflict.businessName}" already exists (id ${conflict.id}).`,
          conflictId: conflict.id,
        });
      }
      clientUpdateData.businessName = trimmed;
    }

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
          .where(
            inArray(
              keywordLinksTable.keywordId,
              clientKwIds.map((k) => k.id),
            ),
          );
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
          })),
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

/* Soft-delete: archive the client by flipping status -> 'inactive' and
   cascading is_active=false to its keywords + keyword_links. Preserves
   all historical sessions / ranking_reports / audit_logs. Re-deleting an
   already-inactive client is a no-op (idempotent). */
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const [client] = await db
      .update(clientsTable)
      .set({ status: "inactive" })
      .where(eq(clientsTable.id, id))
      .returning();
    if (!client) return res.status(404).json({ error: "Not found" });

    await db
      .update(keywordsTable)
      .set({ isActive: false })
      .where(eq(keywordsTable.clientId, id));

    const clientKwIds = await db
      .select({ id: keywordsTable.id })
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, id));
    if (clientKwIds.length > 0) {
      await db
        .update(keywordLinksTable)
        .set({ linkActive: false })
        .where(
          inArray(
            keywordLinksTable.keywordId,
            clientKwIds.map((k) => k.id),
          ),
        );
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error archiving client");
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
      .select({
        mapsPresence: rankingReportsTable.mapsPresence,
        createdAt: rankingReportsTable.createdAt,
      })
      .from(rankingReportsTable)
      .where(eq(rankingReportsTable.clientId, id))
      .orderBy(desc(rankingReportsTable.createdAt))
      .limit(1);

    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, id));

    const verificationStatus =
      keywords.length > 0 &&
      keywords.every((k) => k.verificationStatus === "verified")
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
    const rankingData: Record<
      number,
      {
        initial?: typeof rankingReportsTable.$inferSelect;
        current?: typeof rankingReportsTable.$inferSelect;
      }
    > = {};
    for (const kwId of keywordIds) {
      const reports = await db
        .select()
        .from(rankingReportsTable)
        .where(
          and(
            eq(rankingReportsTable.clientId, id),
            eq(rankingReportsTable.keywordId, kwId),
          ),
        )
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
      ? allReportPositions.reduce((a, b) => a + b, 0) /
        allReportPositions.length
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
      initialRankingPosition:
        rankingData[k.id]?.initial?.rankingPosition ?? null,
      currentRankingPosition:
        rankingData[k.id]?.current?.rankingPosition ?? null,
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
