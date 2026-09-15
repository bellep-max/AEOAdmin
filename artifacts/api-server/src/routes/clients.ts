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
import {
  eq,
  and,
  ilike,
  sql,
  desc,
  inArray,
  isNull,
  isNotNull,
} from "drizzle-orm";
import {
  isChucksLocal,
  requireAdmin,
  requireEditor,
  requireScopedAdmin,
  requireScopedEditor,
  requireSalesAllowed,
  requireExecutorOrSalesAllowed,
} from "../middlewares/role-auth";
import {
  getScopedClientIds,
  assertScopedAccessToClient,
  isPlanAllowedForScope,
  isScopedRole,
  LOCAL_ADMIN_PLAN_TYPES,
} from "../lib/scoped-access";
import type { Request, Response, NextFunction } from "express";

const router = Router();

/**
 * For scoped sessions on /:id sub-routes, 404 if the targeted client isn't in
 * the caller's local-plan slice. Unscoped sessions pass through unchanged. The
 * handler still runs its own ownership/auth as needed.
 */
async function gateClientForScopedRoles(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isScopedRole(req)) return next();
  const targetId = Number(req.params.id);
  if (Number.isNaN(targetId)) return next();
  const eligibleIds = await getScopedClientIds(req);
  if (!eligibleIds || !eligibleIds.includes(targetId)) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
}

/*
 * Client lifecycle has three independent dimensions:
 *   - status          'active' | 'inactive'   → Switch toggle (pause / resume)
 *   - archived_at     timestamptz | null      → Trash icon (move to Archived)
 *   - locked_at       timestamptz | null      → Auto-set by rotation when any
 *                                                keyword on this client hits top-3
 *
 * Three views the FE asks for:
 *   GET /api/clients                 → not archived  (default Clients page)
 *   GET /api/clients?archived=true   → archived_at IS NOT NULL
 *   GET /api/clients?locked=true     → locked_at   IS NOT NULL
 *
 * The legacy status=active/inactive/all param still works on top — useful
 * for the Status switch filter on the main page, which only wants to see
 * paused vs running.
 */
router.get("/", requireExecutorOrSalesAllowed, async (req, res) => {
  try {
    const { status, search, archived, locked } = req.query as Record<
      string,
      string
    >;
    const conditions: ReturnType<typeof eq>[] = [];

    // Sessions in a scoped role (sales / account-manager) see only their
    // slice of clients. Pre-fetch the eligible IDs and intersect; unscoped
    // sessions get a null back and skip the filter.
    const eligibleIds = await getScopedClientIds(req);
    if (eligibleIds !== null) {
      if (eligibleIds.length === 0) return res.json([]);
      conditions.push(inArray(clientsTable.id, eligibleIds));
    }

    // archived dimension (default: hide archived rows)
    if (archived === "true") {
      conditions.push(isNotNull(clientsTable.archivedAt));
    } else if (archived !== "all") {
      conditions.push(isNull(clientsTable.archivedAt));
    }

    // locked dimension (optional; defaults to no filter)
    if (locked === "true") conditions.push(isNotNull(clientsTable.lockedAt));
    else if (locked === "false") conditions.push(isNull(clientsTable.lockedAt));

    // status filter still applies on top
    if (status === "active" || status === "inactive") {
      conditions.push(eq(clientsTable.status, status));
    } else if (!status || status === "all") {
      // no status filter — both active and inactive are returned
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

router.post("/", requireScopedAdmin, async (req, res) => {
  try {
    const body = req.body;

    const trimmedName = String(body.businessName ?? "").trim();
    if (!trimmedName) {
      return res.status(400).json({ error: "businessName is required" });
    }

    // Scoped role (chuckslocal): a created client must carry one of its allowed
    // plans (set as plan_name here) so it lands inside the user's slice and
    // stays visible. Reject any other plan choice.
    if (isChucksLocal(req) && !isPlanAllowedForScope(req, body.plan)) {
      return res.status(403).json({
        error: `You can only create clients on these plans: ${LOCAL_ADMIN_PLAN_TYPES.join(
          ", ",
        )}.`,
      });
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

router.get(
  "/:id",
  requireExecutorOrSalesAllowed,
  gateClientForScopedRoles,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [client] = await db
        .select()
        .from(clientsTable)
        .where(eq(clientsTable.id, id));
      if (!client) return res.status(404).json({ error: "Not found" });
      // planTypes mirrors the list endpoint's shape so callers (e.g. the
      // free-trial "Send proof" button) can gate on plan type without a
      // second request.
      const planTypeRows = await db
        .select({ planType: clientAeoPlansTable.planType })
        .from(clientAeoPlansTable)
        .where(eq(clientAeoPlansTable.clientId, id));
      const planTypes = Array.from(
        new Set(
          planTypeRows
            .map((r) => r.planType)
            .filter((pt): pt is string => !!pt),
        ),
      );
      res.json({ ...client, planTypes });
    } catch (err) {
      req.log.error({ err }, "Error fetching client");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.patch("/:id", requireScopedEditor, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Scoped role: may only edit clients inside its plan slice.
    if (!(await assertScopedAccessToClient(req, res, id))) return;
    const body = req.body;
    // ...and may not move a client onto a plan outside its scope.
    if (
      isChucksLocal(req) &&
      body.plan != null &&
      !isPlanAllowedForScope(req, body.plan)
    ) {
      return res.status(403).json({
        error: `You can only assign these plans: ${LOCAL_ADMIN_PLAN_TYPES.join(
          ", ",
        )}.`,
      });
    }
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

/* Archive: stamp archived_at on the client and cascade is_active=false to
   its keywords + keyword_links so audits stop running. status is left
   alone — that's the Switch's column (pause vs running). Re-archiving an
   already-archived client is a no-op (COALESCE keeps the original stamp). */
router.delete("/:id", requireScopedAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    if (!(await assertScopedAccessToClient(req, res, id))) return;

    const reason =
      (req.body as { reason?: string } | undefined)?.reason ??
      "Archived from Clients page";

    const [client] = await db
      .update(clientsTable)
      .set({
        archivedAt: sql`COALESCE(${clientsTable.archivedAt}, now())`,
        archiveReason: sql`COALESCE(${clientsTable.archiveReason}, ${reason})`,
      })
      .where(eq(clientsTable.id, id))
      .returning();
    if (!client) return res.status(404).json({ error: "Not found" });

    // Cascade: stop ranking work for this client's keywords + links.
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

/* Restore the inverse of DELETE: clear archived_at + archive_reason and
   flip status back to 'active' so the client is running again. locked_at
   is left alone — graduation history shouldn't reset on restore. */
router.post("/:id/restore", requireScopedAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    if (!(await assertScopedAccessToClient(req, res, id))) return;

    const [client] = await db
      .update(clientsTable)
      .set({ archivedAt: null, archiveReason: null, status: "active" })
      .where(eq(clientsTable.id, id))
      .returning();
    if (!client) return res.status(404).json({ error: "Not found" });

    await db
      .update(keywordsTable)
      .set({ isActive: true })
      .where(eq(keywordsTable.clientId, id));

    const clientKwIds = await db
      .select({ id: keywordsTable.id })
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, id));
    if (clientKwIds.length > 0) {
      await db
        .update(keywordLinksTable)
        .set({ linkActive: true })
        .where(
          inArray(
            keywordLinksTable.keywordId,
            clientKwIds.map((k) => k.id),
          ),
        );
    }

    res.json({ success: true, client });
  } catch (err) {
    req.log.error({ err }, "Error restoring client");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/:id/gbp-snippet",
  requireSalesAllowed,
  gateClientForScopedRoles,
  async (req, res) => {
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
  },
);

router.get(
  "/:id/aeo-summary",
  requireSalesAllowed,
  gateClientForScopedRoles,
  async (req, res) => {
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
  },
);

export default router;
