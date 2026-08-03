/**
 * GET /api/cancellations
 *
 * Flat feed behind the Cancelled page. One row per canceled campaign
 * (client_aeo_plans.campaign_status = 'canceled'), plus a client-level row for
 * any archived client that produced no canceled campaign — a client archived
 * straight from the Clients page, or one with no campaigns at all. Without
 * those rows an archived client would have no screen left to restore it from.
 *
 * Scoped roles (sales / account-manager / chuckslocal) see only cancellations
 * on clients inside their slice, same rule as every other list endpoint.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  businessesTable,
  clientAeoPlansTable,
  clientsTable,
  keywordsTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { requireSalesAllowed } from "../middlewares/role-auth";
import { getScopedClientIds } from "../lib/scoped-access";

const router = Router();

export interface CancellationRow {
  kind: "campaign" | "client";
  /** Unique across both kinds — "campaign-12" / "client-7". */
  rowKey: string;
  clientId: number;
  clientName: string;
  city: string | null;
  state: string | null;
  campaignId: number | null;
  campaignName: string | null;
  planType: string | null;
  businessId: number | null;
  businessName: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  keywordCount: number;
  clientArchived: boolean;
}

router.get("/", requireSalesAllowed, async (req, res) => {
  try {
    const eligibleIds = await getScopedClientIds(req);
    if (eligibleIds !== null && eligibleIds.length === 0) return res.json([]);
    const planScope =
      eligibleIds !== null
        ? inArray(clientAeoPlansTable.clientId, eligibleIds)
        : undefined;
    const clientScope =
      eligibleIds !== null ? inArray(clientsTable.id, eligibleIds) : undefined;

    const canceledPlans = await db
      .select({
        campaignId: clientAeoPlansTable.id,
        campaignName: clientAeoPlansTable.name,
        planType: clientAeoPlansTable.planType,
        businessId: clientAeoPlansTable.businessId,
        businessName: businessesTable.name,
        canceledAt: clientAeoPlansTable.canceledAt,
        cancelReason: clientAeoPlansTable.cancelReason,
        clientId: clientsTable.id,
        clientName: clientsTable.businessName,
        city: clientsTable.city,
        state: clientsTable.state,
        clientArchivedAt: clientsTable.archivedAt,
      })
      .from(clientAeoPlansTable)
      .innerJoin(
        clientsTable,
        eq(clientsTable.id, clientAeoPlansTable.clientId),
      )
      .leftJoin(
        businessesTable,
        eq(businessesTable.id, clientAeoPlansTable.businessId),
      )
      .where(and(eq(clientAeoPlansTable.campaignStatus, "canceled"), planScope))
      .orderBy(desc(clientAeoPlansTable.canceledAt));

    const clientIdsWithCanceledPlan = new Set(
      canceledPlans.map((p) => p.clientId),
    );

    const archivedClients = await db
      .select({
        clientId: clientsTable.id,
        clientName: clientsTable.businessName,
        city: clientsTable.city,
        state: clientsTable.state,
        planName: clientsTable.planName,
        archivedAt: clientsTable.archivedAt,
        archiveReason: clientsTable.archiveReason,
      })
      .from(clientsTable)
      .where(and(isNotNull(clientsTable.archivedAt), clientScope))
      .orderBy(desc(clientsTable.archivedAt));

    // Keyword counts: per campaign for campaign rows, per client for the
    // client-level rows. Both in one pass over the relevant clients.
    const relevantClientIds = [
      ...new Set([
        ...canceledPlans.map((p) => p.clientId),
        ...archivedClients.map((c) => c.clientId),
      ]),
    ];
    const byPlan = new Map<number, number>();
    const byClient = new Map<number, number>();
    if (relevantClientIds.length > 0) {
      const kwRows = await db
        .select({
          clientId: keywordsTable.clientId,
          aeoPlanId: keywordsTable.aeoPlanId,
          c: sql<number>`count(*)::int`,
        })
        .from(keywordsTable)
        .where(inArray(keywordsTable.clientId, relevantClientIds))
        .groupBy(keywordsTable.clientId, keywordsTable.aeoPlanId);
      for (const r of kwRows) {
        byClient.set(r.clientId, (byClient.get(r.clientId) ?? 0) + r.c);
        if (r.aeoPlanId != null) byPlan.set(r.aeoPlanId, r.c);
      }
    }

    const rows: CancellationRow[] = [
      ...canceledPlans.map((p) => ({
        kind: "campaign" as const,
        rowKey: `campaign-${p.campaignId}`,
        clientId: p.clientId,
        clientName: p.clientName,
        city: p.city,
        state: p.state,
        campaignId: p.campaignId,
        campaignName: p.campaignName ?? p.planType,
        planType: p.planType,
        businessId: p.businessId,
        businessName: p.businessName,
        canceledAt: p.canceledAt,
        cancelReason: p.cancelReason,
        keywordCount: byPlan.get(p.campaignId) ?? 0,
        clientArchived: p.clientArchivedAt != null,
      })),
      ...archivedClients
        .filter((c) => !clientIdsWithCanceledPlan.has(c.clientId))
        .map((c) => ({
          kind: "client" as const,
          rowKey: `client-${c.clientId}`,
          clientId: c.clientId,
          clientName: c.clientName,
          city: c.city,
          state: c.state,
          campaignId: null,
          campaignName: null,
          planType: c.planName,
          businessId: null,
          businessName: null,
          canceledAt: c.archivedAt
            ? new Date(c.archivedAt).toISOString().slice(0, 10)
            : null,
          cancelReason: c.archiveReason,
          keywordCount: byClient.get(c.clientId) ?? 0,
          clientArchived: true,
        })),
    ];

    // Newest cancellation first; undated rows sink to the bottom.
    rows.sort((a, b) => (b.canceledAt ?? "").localeCompare(a.canceledAt ?? ""));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching cancellations");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
