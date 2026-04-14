import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  insertClientSchema,
  keywordsTable,
  keywordLinksTable,
  sessionsTable,
  rankingReportsTable,
} from "@workspace/db/schema";
import { eq, and, ilike, or, sql, desc, inArray, getTableColumns } from "drizzle-orm";
import { ok, created, noContent, badRequest, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { status, search } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (status === "active" || status === "inactive") {
      conditions.push(eq(clientsTable.status, status));
    }
    if (search) {
      conditions.push(
        or(
          ilike(clientsTable.businessName, `%${search}%`),
          ilike(clientsTable.city ?? "", `%${search}%`)
        )!
      );
    }
    const clients = await db
      .select({
        ...getTableColumns(clientsTable),
        keywordCount: sql<number>`(select count(*) from keywords where keywords.client_id = ${clientsTable.id})::int`,
      })
      .from(clientsTable)
      .where(
        conditions.length > 0
          ? and(...conditions)
          : undefined
      )
      .orderBy(desc(clientsTable.createdAt));

    ok(res, clients);
  } catch (err) {
    req.log.error({ err }, "Error fetching clients");
    serverError(res);
  }
});

router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertClientSchema);
    if (!data) return;

    const [client] = await db
      .insert(clientsTable)
      .values({
        ...data,
        status: data.status ?? "active",
        addressType: data.addressType ?? 1,
      })
      .returning();

    created(res, {
      client,
      message: "Business created successfully",
    });
  } catch (err) {
    req.log.error({ err }, "Error creating client");
    serverError(res);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!client) return notFound(res);
    ok(res, client);
  } catch (err) {
    req.log.error({ err }, "Error fetching client");
    serverError(res);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body;
    const keywords = body.keywords ?? [];

    // Whitelist PATCH fields
    const CLIENT_FIELDS = [
      "businessName", "searchAddress", "gmbUrl", "websitePublishedOnGmb",
      "websiteLinkedOnGmb", "planName", "accountType", "startDate",
      "nextBillDate", "subscriptionId", "accountUser", "accountUserName",
      "accountEmail", "billingEmail", "lastFourCard", "status",
      "contactEmail", "addressType", "publishedAddress", "city", "state",
      "placeId", "createdBy", "notes",
    ] as const;
    const clientUpdateData: Record<string, unknown> = {};
    for (const f of CLIENT_FIELDS) {
      if (f in body) clientUpdateData[f] = body[f];
    }

    const [client] = await db
      .update(clientsTable)
      .set(clientUpdateData)
      .where(eq(clientsTable.id, id))
      .returning();

    if (!client) return notFound(res);

    // Cascade status change to all keywords + their links for this client
    if (body.status === "inactive" || body.status === "active") {
      const isActive = body.status === "active";

      await db
        .update(keywordsTable)
        .set({ isActive })
        .where(eq(keywordsTable.clientId, id));

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
    let addedKeywords: unknown[] = [];
    if (keywords.length > 0) {
      addedKeywords = await db
        .insert(keywordsTable)
        .values(
          keywords.map((kw: Record<string, unknown>) => ({
            clientId: client.id,
            keywordText: (kw.keywordText as string) || (kw as unknown as string),
            linkTypeLabel: (kw.linkTypeLabel as string) ?? null,
            linkActive: kw.linkActive !== false,
            initialRankReportLink: (kw.initialRankReportLink as string) ?? null,
            currentRankReportLink: (kw.currentRankReportLink as string) ?? null,
          }))
        )
        .returning();
    }

    ok(res, {
      client,
      addedKeywords,
      addedKeywordCount: addedKeywords.length,
    });
  } catch (err) {
    req.log.error({ err }, "Error updating client");
    serverError(res);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(clientsTable).where(eq(clientsTable.id, id));
    noContent(res);
  } catch (err) {
    req.log.error({ err }, "Error deleting client");
    serverError(res);
  }
});

router.get("/:id/gbp-snippet", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!client) return notFound(res);

    const [latestReport] = await db
      .select({ mapsPresence: rankingReportsTable.mapsPresence, createdAt: rankingReportsTable.createdAt })
      .from(rankingReportsTable)
      .where(eq(rankingReportsTable.clientId, id))
      .orderBy(desc(rankingReportsTable.createdAt))
      .limit(1);

    const kwList = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, id));

    const verificationStatus =
      kwList.length > 0 && kwList.every((k) => k.verificationStatus === "verified")
        ? "verified"
        : kwList.some((k) => k.verificationStatus === "failed")
        ? "failed"
        : "pending";

    ok(res, {
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
    serverError(res);
  }
});

router.get("/:id/aeo-summary", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, id));
    if (!client) return notFound(res);

    const kwList = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, id));

    const keywordIds = kwList.map((k) => k.id);

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

    const sessions = await db
      .select({ timestamp: sessionsTable.timestamp })
      .from(sessionsTable)
      .where(eq(sessionsTable.clientId, id))
      .orderBy(sessionsTable.timestamp);

    const aeoKeywords = kwList.map((k) => ({
      keywordId: k.id,
      keywordText: k.keywordText,
      initialRankingDate: rankingData[k.id]?.initial?.createdAt ?? null,
      initialRankingPosition: rankingData[k.id]?.initial?.rankingPosition ?? null,
      currentRankingPosition: rankingData[k.id]?.current?.rankingPosition ?? null,
      clicksDelivered: 0,
      verificationStatus: k.verificationStatus,
    }));

    ok(res, {
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
    serverError(res);
  }
});

export default router;
