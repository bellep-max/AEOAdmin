import { db } from "@workspace/db";
import { clientsTable, keywordsTable, rankingReportsTable, sessionsTable } from "@workspace/db/schema";
import { eq, and, ilike, or, desc, asc } from "drizzle-orm";

export async function listClients(filters: { status?: string; search?: string }) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (filters.status === "active" || filters.status === "inactive") {
    conditions.push(eq(clientsTable.status, filters.status));
  }
  if (filters.search) {
    // Use SQL-level filtering instead of JS .filter()
    conditions.push(
      or(
        ilike(clientsTable.businessName, `%${filters.search}%`),
        ilike(clientsTable.city ?? "", `%${filters.search}%`)
      )!
    );
  }
  return db
    .select()
    .from(clientsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(clientsTable.createdAt));
}

export async function getClient(id: number) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  return client ?? null;
}

// Whitelist of updatable fields for PATCH
const CLIENT_UPDATABLE_FIELDS = [
  "businessName", "gmbUrl", "websiteUrl", "publishedAddress", "searchAddress",
  "city", "state", "status", "planName", "placeId", "contactEmail",
  "websitePublishedOnGmb", "websiteLinkedOnGmb", "accountUser",
  "accountType", "accountUserName", "accountEmail", "billingEmail",
  "startDate", "nextBillDate", "subscriptionId", "lastFourCard",
  "latitude", "longitude", "timezone",
] as const;

export async function createClient(data: Record<string, unknown>) {
  const [client] = await db
    .insert(clientsTable)
    .values({
      businessName: data.businessName as string,
      searchAddress: (data.searchAddress as string) ?? null,
      gmbUrl: (data.gmbLink as string) ?? null,
      websitePublishedOnGmb: (data.websitePublishedOnGMB as string) ?? null,
      websiteLinkedOnGmb: (data.websiteLinkedOnGMB as string) ?? null,
      planName: (data.plan as string) ?? null,
      accountType: (data.accountType as string) ?? null,
      startDate: (data.startDate as string) ?? null,
      nextBillDate: (data.nextBillDate as string) ?? null,
      subscriptionId: (data.subscriptionId as string) ?? null,
      accountUser: (data.accountUser as string) ?? null,
      accountUserName: (data.accountUserName as string) ?? null,
      accountEmail: (data.accountEmail as string) ?? null,
      billingEmail: (data.billingEmail as string) ?? null,
      lastFourCard: (data.cardLast4 as string) ?? null,
      status: ((data.status as string) ?? "active") as "active" | "inactive",
      contactEmail: (data.billingEmail as string) ?? null,
      addressType: 1,
    })
    .returning();
  return client;
}

export async function updateClient(id: number, body: Record<string, unknown>) {
  // Only allow whitelisted fields
  const safeUpdate: Record<string, unknown> = {};
  for (const field of CLIENT_UPDATABLE_FIELDS) {
    if (field in body) safeUpdate[field] = body[field];
  }
  if (Object.keys(safeUpdate).length === 0) return null;

  const [client] = await db
    .update(clientsTable)
    .set(safeUpdate)
    .where(eq(clientsTable.id, id))
    .returning();
  return client ?? null;
}

export async function deleteClient(id: number) {
  await db.delete(clientsTable).where(eq(clientsTable.id, id));
}

export async function getGbpSnippet(clientId: number) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) return null;

  const [latestReport] = await db
    .select({ mapsPresence: rankingReportsTable.mapsPresence, createdAt: rankingReportsTable.createdAt })
    .from(rankingReportsTable)
    .where(eq(rankingReportsTable.clientId, clientId))
    .orderBy(desc(rankingReportsTable.createdAt))
    .limit(1);

  const keywords = await db.select().from(keywordsTable).where(eq(keywordsTable.clientId, clientId));

  const verificationStatus =
    keywords.length > 0 && keywords.every((k) => k.verificationStatus === "verified")
      ? "verified"
      : keywords.some((k) => k.verificationStatus === "failed")
      ? "failed"
      : "pending";

  return {
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
  };
}

// Fixed N+1: single query instead of looping per keyword
export async function getAeoSummary(clientId: number) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) return null;

  const keywords = await db.select().from(keywordsTable).where(eq(keywordsTable.clientId, clientId));
  const keywordIds = keywords.map((k) => k.id);

  // Single query for all ranking reports for this client
  const allReports = keywordIds.length > 0
    ? await db
        .select()
        .from(rankingReportsTable)
        .where(eq(rankingReportsTable.clientId, clientId))
        .orderBy(asc(rankingReportsTable.createdAt))
    : [];

  // Group by keyword in memory (from single query, not N queries)
  const rankingData: Record<number, { initial?: typeof allReports[0]; current?: typeof allReports[0] }> = {};
  for (const report of allReports) {
    if (!rankingData[report.keywordId]) rankingData[report.keywordId] = {};
    if (report.isInitialRanking || !rankingData[report.keywordId].initial) {
      rankingData[report.keywordId].initial = report;
    }
    rankingData[report.keywordId].current = report;
  }

  const allPositions = Object.values(rankingData)
    .map((r) => r.current?.rankingPosition)
    .filter((p): p is number => p != null);
  const avgPos = allPositions.length
    ? allPositions.reduce((a, b) => a + b, 0) / allPositions.length
    : null;

  const sessions = await db
    .select({ timestamp: sessionsTable.timestamp })
    .from(sessionsTable)
    .where(eq(sessionsTable.clientId, clientId))
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

  return {
    clientId: client.id,
    businessName: client.businessName,
    aeoKeywords,
    totalClicksDelivered: 0,
    averageRankingPosition: avgPos,
    startDate: sessions[0]?.timestamp ?? null,
    lastSessionDate: sessions[sessions.length - 1]?.timestamp ?? null,
  };
}
