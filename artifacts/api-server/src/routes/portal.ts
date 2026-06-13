import { Router, type Request, type Response, type NextFunction } from "express";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  clientsTable,
  keywordsTable,
  keywordLinksTable,
  rankingReportsTable,
  clientAeoPlansTable,
  businessesTable,
  sessionsTable,
  keywordVariantsTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

/* ────────────────────────────────────────────────────────────
   Portal namespace — customer-scoped data routes.
   Mounted at /api/portal. Authentication is owned by /api/auth
   (express-session + `users` table); every route below reads
   `req.session.userId` and scopes queries to the linked client.
──────────────────────────────────────────────────────────── */

const router = Router();

interface PortalRequestState {
  portalUserId?: number;
  portalClientId?: number | null;
}

function portalState(req: Request): PortalRequestState {
  return req as unknown as PortalRequestState;
}

function requirePortalAuth(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as unknown as Record<string, unknown> | undefined;
  const userId = session?.userId;
  if (typeof userId !== "number") {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  portalState(req).portalUserId = userId;
  next();
}

/**
 * Resolve the linked client id from `users.client_id`. Customers MUST have a
 * client linked; admins/owners are rejected here — they have /api/* directly
 * and shouldn't be calling portal routes.
 */
async function requireLinkedClient(req: Request, res: Response): Promise<number | null> {
  const state = portalState(req);
  const userId = state.portalUserId;
  if (typeof userId !== "number") {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  const [user] = await db
    .select({ clientId: usersTable.clientId, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return null;
  }
  if (user.role !== "customer") {
    res.status(403).json({ error: "Portal routes are customer-only" });
    return null;
  }
  if (user.clientId == null) {
    res.status(404).json({ error: "Customer is not linked to a client" });
    return null;
  }
  state.portalClientId = user.clientId;
  return user.clientId;
}

/* ────────────────────────────────────────────────────────────
   Data routes — all require auth + a linked client.
──────────────────────────────────────────────────────────── */

/**
 * Map a `clients` row into the public `Business` response shape.
 * Industry / description / onboardingComplete are placeholders until
 * the schema grows those columns (Phase 3).
 */
function toBusinessResponse(
  client: typeof clientsTable.$inferSelect,
  userId: number | undefined,
) {
  const createdAt = (client.createdAt ?? new Date()).toISOString();
  return {
    id: client.id,
    userId: String(userId ?? ""),
    businessName: client.businessName,
    ownerName: client.accountUser ?? "",
    subscriberName: client.accountUser ?? "",
    industry: null,
    description: null,
    onboardingComplete: true,
    isActive: client.status === "active",
    createdAt,
    updatedAt: createdAt,
  };
}

router.get("/businesses/me", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    if (!client) {
      return res.status(404).json({ error: "Business not found" });
    }
    res.json(toBusinessResponse(client, portalState(req).portalUserId));
  } catch (err) {
    req.log.error({ err }, "Portal business/me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST and PATCH share the same upsert semantics: register auto-creates a
// `clients` row, so the onboarding wizard's POST is effectively an update.
async function upsertBusinessHandler(req: Request, res: Response): Promise<void> {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const body = (req.body ?? {}) as {
      businessName?: unknown;
      ownerName?: unknown;
      subscriberName?: unknown;
      industry?: unknown;
      description?: unknown;
      onboardingComplete?: unknown;
    };

    const patch: Partial<typeof clientsTable.$inferInsert> = {};
    if (body.businessName !== undefined) {
      if (typeof body.businessName !== "string" || !body.businessName.trim()) {
        res.status(400).json({ error: "businessName must be a non-empty string" });
        return;
      }
      patch.businessName = body.businessName.trim();
    }
    if (body.ownerName !== undefined) {
      if (typeof body.ownerName !== "string") {
        res.status(400).json({ error: "ownerName must be a string" });
        return;
      }
      patch.accountUser = body.ownerName.trim();
    }
    if (body.subscriberName !== undefined && typeof body.subscriberName !== "string") {
      res.status(400).json({ error: "subscriberName must be a string" });
      return;
    }
    // TODO(portal): Phase 3 — `subscriberName`, `industry`, `description`, `onboardingComplete`
    // are not yet columns on `clients`. We silently accept them so the
    // frontend onboarding flow works, and surface them on read once added.
    if (body.industry !== undefined && typeof body.industry !== "string") {
      res.status(400).json({ error: "industry must be a string" });
      return;
    }
    if (body.description !== undefined && typeof body.description !== "string") {
      res.status(400).json({ error: "description must be a string" });
      return;
    }
    if (
      body.onboardingComplete !== undefined &&
      typeof body.onboardingComplete !== "boolean"
    ) {
      res.status(400).json({ error: "onboardingComplete must be a boolean" });
      return;
    }

    if (Object.keys(patch).length > 0) {
      await db.update(clientsTable).set(patch).where(eq(clientsTable.id, clientId));
    }

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    res.json(toBusinessResponse(client, portalState(req).portalUserId));
  } catch (err) {
    req.log.error({ err }, "Portal business/me upsert error");
    res.status(500).json({ error: "Internal server error" });
  }
}

router.patch("/businesses/me", requirePortalAuth, upsertBusinessHandler);
router.post("/businesses/me", requirePortalAuth, upsertBusinessHandler);

router.get("/businesses/me/dashboard", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, clientId));

    const activeKeywords = keywords.filter((k) => k.isActive).length;
    const totalKeywords = keywords.length;

    const keywordIds = keywords.map((k) => k.id);

    // Build a "latest rank per keyword" map.
    const latestByKeyword = new Map<number, { position: number | null; date: string | null }>();
    if (keywordIds.length > 0) {
      const reports = await db
        .select({
          keywordId: rankingReportsTable.keywordId,
          rankingPosition: rankingReportsTable.rankingPosition,
          date: rankingReportsTable.date,
          timestamp: rankingReportsTable.timestamp,
        })
        .from(rankingReportsTable)
        .where(
          and(
            eq(rankingReportsTable.clientId, clientId),
            inArray(rankingReportsTable.keywordId, keywordIds),
          ),
        )
        .orderBy(desc(rankingReportsTable.timestamp));
      for (const r of reports) {
        if (!latestByKeyword.has(r.keywordId)) {
          latestByKeyword.set(r.keywordId, {
            position: r.rankingPosition,
            date: r.date ?? (r.timestamp ? r.timestamp.toISOString() : null),
          });
        }
      }
    }

    const ranked = keywords
      .map((k) => ({ kw: k, latest: latestByKeyword.get(k.id) ?? null }))
      .filter((row) => row.latest?.position != null) as Array<{
        kw: typeof keywords[number];
        latest: { position: number; date: string | null };
      }>;

    const visibilityScore =
      activeKeywords > 0
        ? Math.round(
            (ranked.filter((r) => r.latest.position <= 10).length / activeKeywords) * 1000,
          ) / 10
        : null;

    const topKeywords = [...ranked]
      .sort((a, b) => a.latest.position - b.latest.position)
      .slice(0, 5)
      .map((r) => {
        const createdAt = (r.kw.createdAt ?? new Date()).toISOString();
        return {
          id: r.kw.id,
          businessId: clientId,
          keyword: r.kw.keywordText,
          efficiencyScore: null,
          searchVolume: null,
          currentPosition: r.latest.position,
          previousPosition: null,
          isAiGenerated: false,
          notes: r.kw.notes,
          status: r.kw.isActive ? "active" : "paused",
          createdAt,
          updatedAt: createdAt,
        };
      });

    const lastReportDate = ranked.reduce<string | null>((acc, r) => {
      if (!r.latest.date) return acc;
      if (!acc) return r.latest.date;
      return r.latest.date > acc ? r.latest.date : acc;
    }, null);

    res.json({
      totalKeywords,
      activeKeywords,
      averageEfficiencyScore: null,
      visibilityScore,
      visibilityChange: null,
      totalWebsites: 0,
      gbpVerified: Boolean((await getClientById(clientId))?.placeId),
      recentKeywordTrend: "stable",
      lastReportDate,
      topKeywords,
      onboardingComplete: true,
    });
  } catch (err) {
    req.log.error({ err }, "Portal dashboard error");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function getClientById(clientId: number) {
  const [row] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  return row;
}

/**
 * Map a keyword row + recent positions into the public Keyword shape.
 * `positions` is [current, previous] — both optional.
 */
function toKeywordResponse(
  keyword: typeof keywordsTable.$inferSelect,
  clientId: number,
  positions: ReadonlyArray<number> = [],
) {
  const createdAt = (keyword.createdAt ?? new Date()).toISOString();
  return {
    id: keyword.id,
    businessId: clientId,
    keyword: keyword.keywordText,
    status: keyword.isActive ? "active" : "paused",
    efficiencyScore: null,
    searchVolume: null,
    currentPosition: positions[0] ?? null,
    previousPosition: positions[1] ?? null,
    isAiGenerated: false,
    notes: keyword.notes,
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Fetch [current, previous] ranking positions for a single keyword.
 * Mirrors the trimming the list endpoint already does, but for one row.
 */
async function getRecentPositions(
  clientId: number,
  keywordId: number,
): Promise<number[]> {
  const reports = await db
    .select({ rankingPosition: rankingReportsTable.rankingPosition })
    .from(rankingReportsTable)
    .where(
      and(
        eq(rankingReportsTable.clientId, clientId),
        eq(rankingReportsTable.keywordId, keywordId),
        isNotNull(rankingReportsTable.rankingPosition),
      ),
    )
    .orderBy(desc(rankingReportsTable.timestamp));
  const out: number[] = [];
  for (const r of reports) {
    if (r.rankingPosition == null) continue;
    out.push(r.rankingPosition);
    if (out.length === 2) break;
  }
  return out;
}

/**
 * Map a `keyword_links` row to the public KeywordLink shape.
 * AI fields are nulls unless an `aiStub` override is provided —
 * the AEOAdmin schema does not yet store these columns.
 */
function toKeywordLinkResponse(
  link: typeof keywordLinksTable.$inferSelect,
  clientId: number,
  aiStub?: {
    aiLifespanDays: number;
    aiEfficiencyPercent: number;
    aiAccuracyPercent: number;
    aiVisibilityPercent: number;
    aiCustomerInsight: string;
    aiAnalysis: string;
    analyzedAt: string;
  },
) {
  return {
    id: link.id,
    keywordId: link.keywordId,
    businessId: clientId,
    url: link.linkUrl ?? "",
    description: link.linkTypeLabel,
    linkType: link.linkTypeLabel ?? "other",
    aiLifespanDays: aiStub?.aiLifespanDays ?? null,
    aiEfficiencyPercent: aiStub?.aiEfficiencyPercent ?? null,
    aiAccuracyPercent: aiStub?.aiAccuracyPercent ?? null,
    aiVisibilityPercent: aiStub?.aiVisibilityPercent ?? null,
    aiCustomerInsight: aiStub?.aiCustomerInsight ?? null,
    aiAnalysis: aiStub?.aiAnalysis ?? null,
    analyzedAt: aiStub?.analyzedAt ?? null,
    createdAt: link.createdAt.toISOString(),
  };
}

/**
 * Load a keyword and verify it belongs to `clientId`. Returns the row,
 * or sends 404 and returns null. Centralizes the ownership check so
 * we don't leak existence (404 — never 403).
 */
async function loadOwnedKeyword(
  res: Response,
  clientId: number,
  rawId: string | string[] | undefined,
): Promise<typeof keywordsTable.$inferSelect | null> {
  const keywordId = Number.parseInt(typeof rawId === "string" ? rawId : "", 10);
  if (Number.isNaN(keywordId)) {
    res.status(400).json({ error: "Invalid keyword id" });
    return null;
  }
  const [row] = await db
    .select()
    .from(keywordsTable)
    .where(eq(keywordsTable.id, keywordId));
  if (!row || row.clientId !== clientId) {
    res.status(404).json({ error: "Keyword not found" });
    return null;
  }
  return row;
}

function parseKeywordStatus(value: unknown): boolean | { error: string } {
  if (typeof value !== "string") return { error: "status must be a string" };
  if (value !== "active" && value !== "paused" && value !== "archived") {
    return { error: "status must be one of active, paused, archived" };
  }
  return value === "active";
}

router.get("/businesses/me/keywords", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const keywords = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, clientId))
      .orderBy(desc(keywordsTable.createdAt));

    const keywordIds = keywords.map((k) => k.id);
    const positionsByKeyword = new Map<number, number[]>();
    if (keywordIds.length > 0) {
      const reports = await db
        .select({
          keywordId: rankingReportsTable.keywordId,
          rankingPosition: rankingReportsTable.rankingPosition,
          timestamp: rankingReportsTable.timestamp,
        })
        .from(rankingReportsTable)
        .where(
          and(
            eq(rankingReportsTable.clientId, clientId),
            inArray(rankingReportsTable.keywordId, keywordIds),
            isNotNull(rankingReportsTable.rankingPosition),
          ),
        )
        .orderBy(desc(rankingReportsTable.timestamp));
      for (const r of reports) {
        if (r.rankingPosition == null) continue;
        const arr = positionsByKeyword.get(r.keywordId) ?? [];
        if (arr.length < 2) {
          arr.push(r.rankingPosition);
          positionsByKeyword.set(r.keywordId, arr);
        }
      }
    }

    res.json(
      keywords.map((k) => toKeywordResponse(k, clientId, positionsByKeyword.get(k.id) ?? [])),
    );
  } catch (err) {
    req.log.error({ err }, "Portal keywords list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/businesses/me/keywords", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const body = (req.body ?? {}) as {
      keyword?: unknown;
      notes?: unknown;
      status?: unknown;
    };

    if (typeof body.keyword !== "string" || !body.keyword.trim()) {
      return res.status(400).json({ error: "keyword is required" });
    }
    const keywordText = body.keyword.trim();

    let notes: string | null = null;
    if (body.notes !== undefined) {
      if (typeof body.notes !== "string") {
        return res.status(400).json({ error: "notes must be a string" });
      }
      notes = body.notes;
    }

    // status defaults to active; paused/archived both flip is_active off.
    let isActive = true;
    if (body.status !== undefined) {
      const parsed = parseKeywordStatus(body.status);
      if (typeof parsed === "object") return res.status(400).json(parsed);
      isActive = parsed;
    }

    const [inserted] = await db
      .insert(keywordsTable)
      .values({
        clientId,
        keywordText,
        keywordType: 1,
        isActive,
        notes,
        // aeoPlanId is nullable in the schema, so we leave it unset
        // for portal-originated keywords until plan linkage is wired up.
      })
      .returning();

    res.status(201).json(toKeywordResponse(inserted, clientId, []));
  } catch (err) {
    req.log.error({ err }, "Portal keyword create error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/businesses/me/keywords/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const existing = await loadOwnedKeyword(res, clientId, req.params.id);
    if (!existing) return;

    const body = (req.body ?? {}) as {
      keyword?: unknown;
      notes?: unknown;
      status?: unknown;
    };

    const patch: Partial<typeof keywordsTable.$inferInsert> = {};
    if (body.keyword !== undefined) {
      if (typeof body.keyword !== "string" || !body.keyword.trim()) {
        return res.status(400).json({ error: "keyword must be a non-empty string" });
      }
      patch.keywordText = body.keyword.trim();
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== "string") {
        return res.status(400).json({ error: "notes must be a string" });
      }
      patch.notes = body.notes;
    }
    if (body.status !== undefined) {
      const parsed = parseKeywordStatus(body.status);
      if (typeof parsed === "object") return res.status(400).json(parsed);
      patch.isActive = parsed;
    }

    if (Object.keys(patch).length > 0) {
      await db.update(keywordsTable).set(patch).where(eq(keywordsTable.id, existing.id));
    }

    const [updated] = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.id, existing.id));
    if (!updated) {
      return res.status(404).json({ error: "Keyword not found" });
    }
    const positions = await getRecentPositions(clientId, updated.id);
    res.json(toKeywordResponse(updated, clientId, positions));
  } catch (err) {
    req.log.error({ err }, "Portal keyword update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/businesses/me/keywords/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const existing = await loadOwnedKeyword(res, clientId, req.params.id);
    if (!existing) return;

    // Hard delete — `keyword_links` and `ranking_reports` cascade.
    await db.delete(keywordsTable).where(eq(keywordsTable.id, existing.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Portal keyword delete error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/businesses/me/keywords/:id/links", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const rawId = req.params.id;
    const keywordId = Number.parseInt(typeof rawId === "string" ? rawId : "", 10);
    if (Number.isNaN(keywordId)) {
      return res.status(400).json({ error: "Invalid keyword id" });
    }

    const [keyword] = await db
      .select({ id: keywordsTable.id, clientId: keywordsTable.clientId })
      .from(keywordsTable)
      .where(eq(keywordsTable.id, keywordId));
    if (!keyword || keyword.clientId !== clientId) {
      return res.status(404).json({ error: "Keyword not found" });
    }

    const links = await db
      .select()
      .from(keywordLinksTable)
      .where(eq(keywordLinksTable.keywordId, keywordId))
      .orderBy(keywordLinksTable.createdAt);

    res.json(links.map((l) => toKeywordLinkResponse(l, clientId)));
  } catch (err) {
    req.log.error({ err }, "Portal keyword links error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/businesses/me/keywords/:id/links",
  requirePortalAuth,
  async (req, res) => {
    try {
      const clientId = await requireLinkedClient(req, res);
      if (clientId == null) return;

      const owned = await loadOwnedKeyword(res, clientId, req.params.id);
      if (!owned) return;

      const body = (req.body ?? {}) as {
        url?: unknown;
        description?: unknown;
        linkType?: unknown;
      };

      if (typeof body.url !== "string" || !body.url.trim()) {
        return res.status(400).json({ error: "url is required" });
      }
      if (body.description !== undefined && typeof body.description !== "string") {
        return res.status(400).json({ error: "description must be a string" });
      }
      if (body.linkType !== undefined && typeof body.linkType !== "string") {
        return res.status(400).json({ error: "linkType must be a string" });
      }

      // Schema collapses description and linkType onto a single column;
      // prefer linkType, then description, then a generic default.
      const linkTypeLabel =
        (typeof body.linkType === "string" && body.linkType.trim()) ||
        (typeof body.description === "string" && body.description.trim()) ||
        "general";

      const [inserted] = await db
        .insert(keywordLinksTable)
        .values({
          keywordId: owned.id,
          linkUrl: body.url.trim(),
          linkTypeLabel,
          linkActive: true,
        })
        .returning();

      res.status(201).json(toKeywordLinkResponse(inserted, clientId));
    } catch (err) {
      req.log.error({ err }, "Portal keyword link create error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * Load a keyword link, verifying via join that the parent keyword
 * belongs to `clientId`. Returns both rows or sends 404 and null.
 */
async function loadOwnedLink(
  res: Response,
  clientId: number,
  rawId: string | string[] | undefined,
): Promise<{
  link: typeof keywordLinksTable.$inferSelect;
  keyword: typeof keywordsTable.$inferSelect;
} | null> {
  const linkId = Number.parseInt(typeof rawId === "string" ? rawId : "", 10);
  if (Number.isNaN(linkId)) {
    res.status(400).json({ error: "Invalid link id" });
    return null;
  }
  const rows = await db
    .select({
      link: keywordLinksTable,
      keyword: keywordsTable,
    })
    .from(keywordLinksTable)
    .innerJoin(keywordsTable, eq(keywordLinksTable.keywordId, keywordsTable.id))
    .where(eq(keywordLinksTable.id, linkId));
  const row = rows[0];
  if (!row || row.keyword.clientId !== clientId) {
    res.status(404).json({ error: "Link not found" });
    return null;
  }
  return row;
}

router.delete(
  "/businesses/me/keywords/links/:linkId",
  requirePortalAuth,
  async (req, res) => {
    try {
      const clientId = await requireLinkedClient(req, res);
      if (clientId == null) return;

      const owned = await loadOwnedLink(res, clientId, req.params.linkId);
      if (!owned) return;

      await db.delete(keywordLinksTable).where(eq(keywordLinksTable.id, owned.link.id));
      res.status(204).send();
    } catch (err) {
      req.log.error({ err }, "Portal keyword link delete error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.post(
  "/businesses/me/keywords/links/:linkId/analyze",
  requirePortalAuth,
  async (req, res) => {
    try {
      const clientId = await requireLinkedClient(req, res);
      if (clientId == null) return;

      const owned = await loadOwnedLink(res, clientId, req.params.linkId);
      if (!owned) return;

      // TODO(portal): Phase 3 — persist AI analysis to keyword_links once
      // the schema gains ai_* / analyzed_at columns. For now we return
      // a deterministic stub so the FE can wire up the flow end-to-end.
      const aiStub = {
        aiLifespanDays: 180,
        aiEfficiencyPercent: 72,
        aiAccuracyPercent: 85,
        aiVisibilityPercent: 68,
        aiCustomerInsight: "Stub insight — real AI analysis pending Phase 3",
        aiAnalysis: "Stub",
        analyzedAt: new Date().toISOString(),
      };
      res.json(toKeywordLinkResponse(owned.link, clientId, aiStub));
    } catch (err) {
      req.log.error({ err }, "Portal keyword link analyze error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get("/businesses/me/gbp", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    if (!client) return res.json([]);

    // NOTE: schema uses `gmbUrl` (not `gmbLink`). Spec mentions `gmbLink`;
    // we map from the actual column.
    if (!client.placeId && !client.gmbUrl) {
      return res.json([]);
    }

    const createdAt = (client.createdAt ?? new Date()).toISOString();
    res.json([
      {
        id: 0,
        businessId: clientId,
        placeId: client.placeId,
        businessName: client.businessName,
        address: client.searchAddress,
        category: null,
        isVerified: client.placeId != null,
        phoneNumber: null,
        website: client.gmbUrl,
        createdAt,
      },
    ]);
  } catch (err) {
    req.log.error({ err }, "Portal gbp error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/businesses/me/websites", requirePortalAuth, async (_req, res) => {
  // TODO(portal): Phase 3 — back this with a real `websites` table.
  res.json([]);
});

// Onboarding step 2: accept GBP details so the wizard can advance.
// We store gmbUrl + searchAddress on the `clients` row; rest is dropped
// (TODO Phase 3: real gbp_profiles table).
router.post("/businesses/me/gbp", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const body = (req.body ?? {}) as {
      businessName?: unknown;
      address?: unknown;
      category?: unknown;
      placeId?: unknown;
      phoneNumber?: unknown;
      website?: unknown;
      isVerified?: unknown;
    };

    const patch: Partial<typeof clientsTable.$inferInsert> = {};
    if (typeof body.address === "string" && body.address.trim()) {
      patch.searchAddress = body.address.trim();
    }
    if (typeof body.website === "string" && body.website.trim()) {
      patch.gmbUrl = body.website.trim();
    }
    if (typeof body.placeId === "string" && body.placeId.trim()) {
      patch.placeId = body.placeId.trim();
    }
    if (Object.keys(patch).length > 0) {
      await db.update(clientsTable).set(patch).where(eq(clientsTable.id, clientId));
    }

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    res.status(201).json({
      id: 0,
      businessId: clientId,
      placeId: client.placeId,
      businessName:
        typeof body.businessName === "string" ? body.businessName : client.businessName,
      address: client.searchAddress,
      category: typeof body.category === "string" ? body.category : null,
      isVerified: typeof body.isVerified === "boolean" ? body.isVerified : !!client.placeId,
      phoneNumber: typeof body.phoneNumber === "string" ? body.phoneNumber : null,
      website: client.gmbUrl,
      createdAt: client.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Portal gbp post error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Onboarding step 3: accept website entry so the wizard can advance.
// TODO(portal): Phase 3 — persist to a real `websites` table.
router.post("/businesses/me/websites", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const body = (req.body ?? {}) as {
      url?: unknown;
      linkType?: unknown;
      title?: unknown;
    };

    if (typeof body.url !== "string" || !body.url.trim()) {
      res.status(400).json({ error: "url is required" });
      return;
    }
    const linkType =
      typeof body.linkType === "string" && body.linkType.trim() ? body.linkType : "other";

    res.status(201).json({
      id: 0,
      businessId: clientId,
      url: body.url.trim(),
      linkType,
      title: typeof body.title === "string" ? body.title : null,
      domainAuthority: null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Portal website post error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Resolve the report date for a ranking_reports row.
 * `date` is the canonical day-string; fall back to the timestamp when missing.
 */
function reportDate(row: { date: string | null; timestamp: Date | null }): Date | null {
  if (row.date) {
    const parsed = new Date(`${row.date}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (row.timestamp) return row.timestamp;
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_DAYS = 14;
const BUCKET_MS = BUCKET_DAYS * DAY_MS;

router.get("/businesses/me/reports", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const reports = await db
      .select({
        keywordId: rankingReportsTable.keywordId,
        rankingPosition: rankingReportsTable.rankingPosition,
        date: rankingReportsTable.date,
        timestamp: rankingReportsTable.timestamp,
      })
      .from(rankingReportsTable)
      .where(eq(rankingReportsTable.clientId, clientId));

    type Row = {
      keywordId: number;
      position: number | null;
      at: Date;
    };
    const rows: Row[] = [];
    for (const r of reports) {
      const at = reportDate(r);
      if (!at) continue;
      rows.push({ keywordId: r.keywordId, position: r.rankingPosition, at });
    }

    if (rows.length === 0) {
      return res.json([]);
    }

    // Pin bucket 0 to the earliest report at UTC midnight.
    rows.sort((a, b) => a.at.getTime() - b.at.getTime());
    const earliestMs = Date.UTC(
      rows[0].at.getUTCFullYear(),
      rows[0].at.getUTCMonth(),
      rows[0].at.getUTCDate(),
    );

    type Bucket = {
      index: number;
      startMs: number;
      endMs: number; // exclusive
      // For "improved/declined" we need the latest position per keyword in
      // each bucket, so we keep the most recent observation per keyword.
      latestPerKeyword: Map<number, { position: number | null; atMs: number }>;
      positions: number[];
      keywordIds: Set<number>;
      totalRanked: number;
      topTen: number;
    };
    const buckets = new Map<number, Bucket>();

    for (const row of rows) {
      const idx = Math.floor((row.at.getTime() - earliestMs) / BUCKET_MS);
      let bucket = buckets.get(idx);
      if (!bucket) {
        bucket = {
          index: idx,
          startMs: earliestMs + idx * BUCKET_MS,
          endMs: earliestMs + (idx + 1) * BUCKET_MS,
          latestPerKeyword: new Map(),
          positions: [],
          keywordIds: new Set(),
          totalRanked: 0,
          topTen: 0,
        };
        buckets.set(idx, bucket);
      }
      bucket.keywordIds.add(row.keywordId);
      if (row.position != null) {
        bucket.positions.push(row.position);
        bucket.totalRanked += 1;
        if (row.position <= 10) bucket.topTen += 1;
      }
      const prev = bucket.latestPerKeyword.get(row.keywordId);
      const atMs = row.at.getTime();
      if (!prev || atMs >= prev.atMs) {
        bucket.latestPerKeyword.set(row.keywordId, { position: row.position, atMs });
      }
    }

    const sortedBuckets = [...buckets.values()].sort((a, b) => a.index - b.index);

    const out = sortedBuckets.map((bucket, position) => {
      const previous = position > 0 ? sortedBuckets[position - 1] : null;
      let improved = 0;
      let declined = 0;
      if (previous) {
        for (const [keywordId, current] of bucket.latestPerKeyword) {
          if (current.position == null) continue;
          const prev = previous.latestPerKeyword.get(keywordId);
          if (!prev || prev.position == null) continue;
          if (current.position < prev.position) improved += 1;
          else if (current.position > prev.position) declined += 1;
        }
      }

      const averagePosition =
        bucket.positions.length > 0
          ? bucket.positions.reduce((sum, p) => sum + p, 0) / bucket.positions.length
          : null;
      const visibilityScore =
        bucket.totalRanked > 0 ? (bucket.topTen / bucket.totalRanked) * 100 : null;

      const periodStart = new Date(bucket.startMs).toISOString();
      // endMs is exclusive; expose the inclusive last day per spec.
      const periodEnd = new Date(bucket.endMs - DAY_MS).toISOString();

      return {
        id: bucket.index + 1,
        businessId: clientId,
        periodStart,
        periodEnd,
        visibilityScore,
        totalImpressions: null,
        totalClicks: null,
        averagePosition,
        keywordsTracked: bucket.keywordIds.size,
        keywordsImproved: improved,
        keywordsDeclined: declined,
        aiSummary: null,
        topKeywords: [] as Array<unknown>,
        createdAt: periodEnd,
      };
    });

    // Spec: newest first.
    out.reverse();
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Portal reports error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   Milestone 1 — admin-shape portal endpoints.

   These mirror admin's response shapes verbatim so the
   client-portal frontend (fork of admin-panel) can reuse the
   same React Query hooks and TS types by swapping URLs.

   Every handler below scopes its queries to req.portalClientId
   resolved via requireLinkedClient. Resources fetched by id
   verify ownership and return 404 (never 403) on mismatch.
──────────────────────────────────────────────────────────── */

/* ─── Shared helpers ─────────────────────────────────────── */

async function loadOwnedAeoPlan(
  res: Response,
  clientId: number,
  rawId: string | string[] | undefined,
): Promise<typeof clientAeoPlansTable.$inferSelect | null> {
  const planId = Number.parseInt(typeof rawId === "string" ? rawId : "", 10);
  if (Number.isNaN(planId)) {
    res.status(400).json({ error: "Invalid plan id" });
    return null;
  }
  const [row] = await db
    .select()
    .from(clientAeoPlansTable)
    .where(eq(clientAeoPlansTable.id, planId));
  if (!row || row.clientId !== clientId) {
    res.status(404).json({ error: "Plan not found" });
    return null;
  }
  return row;
}

async function loadOwnedRankingReport(
  res: Response,
  clientId: number,
  rawId: string | string[] | undefined,
): Promise<typeof rankingReportsTable.$inferSelect | null> {
  const reportId = Number.parseInt(typeof rawId === "string" ? rawId : "", 10);
  if (Number.isNaN(reportId)) {
    res.status(400).json({ error: "Invalid report id" });
    return null;
  }
  const [row] = await db
    .select()
    .from(rankingReportsTable)
    .where(eq(rankingReportsTable.id, reportId));
  if (!row || row.clientId !== clientId) {
    res.status(404).json({ error: "Report not found" });
    return null;
  }
  return row;
}

/**
 * Verify a businessId — when present in a body — belongs to the
 * customer's client. Returns true if ok or absent; sends 400 + false
 * on mismatch (caller short-circuits).
 */
async function verifyBusinessBelongsToClient(
  res: Response,
  clientId: number,
  rawBusinessId: unknown,
): Promise<boolean> {
  if (rawBusinessId === undefined || rawBusinessId === null) return true;
  const businessId = Number(rawBusinessId);
  if (Number.isNaN(businessId)) {
    res.status(400).json({ error: "businessId must be a number" });
    return false;
  }
  const [row] = await db
    .select({ clientId: businessesTable.clientId })
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId));
  if (!row || row.clientId !== clientId) {
    res.status(404).json({ error: "Business not found" });
    return false;
  }
  return true;
}

/* ─── Dashboard summary (client-scoped) ───────────────────── */

router.get("/dashboard/summary", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    // Sessions for this client
    let sessionsTodayNum = 0;
    let totalSessionsNum = 0;
    try {
      const [sessionsToday] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.clientId, clientId),
            gte(sessionsTable.timestamp, todayMidnight),
          ),
        );
      const [totalSessions] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(eq(sessionsTable.clientId, clientId));
      sessionsTodayNum = Number(sessionsToday.count);
      totalSessionsNum = Number(totalSessions.count);
    } catch (sessionErr) {
      req.log.warn({ sessionErr }, "Portal dashboard: failed to fetch sessions");
    }

    // Ranking position average (client-scoped)
    let avgPosition = 0;
    try {
      const rows = await db
        .select({ rankingPosition: rankingReportsTable.rankingPosition })
        .from(rankingReportsTable)
        .where(eq(rankingReportsTable.clientId, clientId));
      const positions = rows
        .map((r) => r.rankingPosition)
        .filter((p): p is number => p != null);
      avgPosition =
        positions.length > 0
          ? positions.reduce((a, b) => a + b, 0) / positions.length
          : 0;
    } catch (rankErr) {
      req.log.warn({ rankErr }, "Portal dashboard: failed to fetch rankings");
    }

    // Keyword stats — scoped to client
    let totalKeywords = 0;
    let activeKeywords = 0;
    let keywordsWithErrors = 0;
    let keywordsWithBacklinks = 0;
    let totalBacklinksFound = 0;
    try {
      const [tk] = await db
        .select({ count: count() })
        .from(keywordsTable)
        .where(eq(keywordsTable.clientId, clientId));
      const [ak] = await db
        .select({ count: count() })
        .from(keywordsTable)
        .where(
          and(
            eq(keywordsTable.clientId, clientId),
            eq(keywordsTable.isActive, true),
          ),
        );
      totalKeywords = Number(tk.count);
      activeKeywords = Number(ak.count);

      const errorKwResult = await db.execute(sql`
        SELECT COUNT(DISTINCT keyword_id)::int AS cnt FROM sessions
        WHERE status = 'error'
          AND timestamp >= ${todayMidnight}
          AND client_id = ${clientId}
      `);
      keywordsWithErrors =
        (errorKwResult.rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

      const backlinkKwResult = await db.execute(sql`
        SELECT COUNT(DISTINCT keyword_id)::int AS cnt FROM sessions
        WHERE backlink_found = true
          AND client_id = ${clientId}
      `);
      keywordsWithBacklinks =
        (backlinkKwResult.rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

      const [blCount] = await db
        .select({ count: count() })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.clientId, clientId),
            eq(sessionsTable.backlinkFound, true),
          ),
        );
      totalBacklinksFound = Number(blCount.count);
    } catch (kwErr) {
      req.log.warn({ kwErr }, "Portal dashboard: failed to fetch keyword stats");
    }

    /* totalClients/activeClients are per-tenant booleans here — a portal
       user sees exactly one client (their own). Infrastructure metrics
       (devices, proxies, network health) are intentionally zeroed so we
       don't leak fleet capacity numbers to customers. */
    res.json({
      totalClients: 1,
      activeClients: 1,
      totalSessionsToday: sessionsTodayNum,
      totalSessionsAllTime: totalSessionsNum,
      availableDevices: 0,
      totalDevices: 0,
      activeProxies: 0,
      averageRankingPosition: Math.round(avgPosition * 10) / 10,
      networkHealthScore: 0,
      sessionCapacityPerDay: 0,
      completedToday: sessionsTodayNum,
      pendingToday: Math.max(0, activeKeywords * 3 - sessionsTodayNum),
      totalKeywords,
      activeKeywords,
      keywordsWithErrors,
      keywordsWithBacklinks,
      totalBacklinksFound,
    });
  } catch (err) {
    req.log.error({ err }, "Portal dashboard summary error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Business profile detail ─────────────────────────────── */

const CLIENT_PATCH_ALLOWED_FIELDS = [
  "businessName",
  "gmbUrl",
  "websiteUrl",
  "publishedAddress",
  "searchAddress",
  "city",
  "state",
  "placeId",
  "contactEmail",
  "notes",
] as const;
type ClientPatchField = (typeof CLIENT_PATCH_ALLOWED_FIELDS)[number];

router.get("/clients/me", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    if (!client) return res.status(404).json({ error: "Not found" });
    res.json(client);
  } catch (err) {
    req.log.error({ err }, "Portal clients/me get error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/clients/me", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;

    /* `country` is in the spec's editable list but absent from the schema —
       schema only has city/state. We reject any unknown body keys with 400
       so the FE gets a clean signal that the field isn't supported yet. */
    const allowedSet = new Set<string>(CLIENT_PATCH_ALLOWED_FIELDS);
    const unknownKeys = Object.keys(body).filter((k) => !allowedSet.has(k));
    if (unknownKeys.length > 0) {
      return res
        .status(400)
        .json({ error: `Unsupported fields: ${unknownKeys.join(", ")}` });
    }

    const patch: Partial<typeof clientsTable.$inferInsert> = {};
    for (const field of CLIENT_PATCH_ALLOWED_FIELDS) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null) {
        // Allow nullable columns to be cleared.
        if (field === "businessName") {
          return res.status(400).json({ error: "businessName cannot be null" });
        }
        (patch as Record<ClientPatchField, unknown>)[field] = null;
        continue;
      }
      if (typeof value !== "string") {
        return res.status(400).json({ error: `${field} must be a string` });
      }
      const trimmed = value.trim();
      if (field === "businessName" && !trimmed) {
        return res.status(400).json({ error: "businessName cannot be empty" });
      }
      (patch as Record<ClientPatchField, unknown>)[field] = trimmed;
    }

    if (Object.keys(patch).length > 0) {
      await db.update(clientsTable).set(patch).where(eq(clientsTable.id, clientId));
    }

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    if (!client) return res.status(404).json({ error: "Not found" });
    res.json(client);
  } catch (err) {
    req.log.error({ err }, "Portal clients/me patch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Keywords (admin-shape) ──────────────────────────────── */

router.get("/keywords", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    /* Mirror admin's GET /api/keywords. Optional businessId/aeoPlanId
       filters are accepted, but clientId is force-bound to the portal
       user's client and ignored if passed. */
    const { businessId, aeoPlanId } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [
      eq(keywordsTable.clientId, clientId),
    ];
    if (businessId) {
      const bid = Number.parseInt(businessId, 10);
      if (!Number.isNaN(bid)) conditions.push(eq(keywordsTable.businessId, bid));
    }
    if (aeoPlanId) {
      const aid = Number.parseInt(aeoPlanId, 10);
      if (!Number.isNaN(aid)) conditions.push(eq(keywordsTable.aeoPlanId, aid));
    }

    const keywords = await db
      .select({
        id: keywordsTable.id,
        clientId: keywordsTable.clientId,
        businessId: keywordsTable.businessId,
        aeoPlanId: keywordsTable.aeoPlanId,
        keywordText: keywordsTable.keywordText,
        keywordType: keywordsTable.keywordType,
        isActive: keywordsTable.isActive,
        isPrimary: keywordsTable.isPrimary,
        verificationStatus: keywordsTable.verificationStatus,
        status: keywordsTable.status,
        notes: keywordsTable.notes,
        implementedBy: keywordsTable.implementedBy,
        dateAdded: keywordsTable.dateAdded,
        initialSearchCount30Days: keywordsTable.initialSearchCount30Days,
        followupSearchCount30Days: keywordsTable.followupSearchCount30Days,
        initialSearchCountLife: keywordsTable.initialSearchCountLife,
        followupSearchCountLife: keywordsTable.followupSearchCountLife,
        backlinkClickCount30Days: keywordsTable.backlinkClickCount30Days,
        backlinkClickCountLife: keywordsTable.backlinkClickCountLife,
        initialRankReportCount: keywordsTable.initialRankReportCount,
        currentRankReportCount: keywordsTable.currentRankReportCount,
        linkTypeLabel: keywordsTable.linkTypeLabel,
        linkActive: keywordsTable.linkActive,
        initialRankReportLink: keywordsTable.initialRankReportLink,
        currentRankReportLink: keywordsTable.currentRankReportLink,
        createdAt: keywordsTable.createdAt,
        joinedClientName: clientsTable.businessName,
        joinedBusinessName: businessesTable.name,
        joinedCampaignName: clientAeoPlansTable.name,
        lastRunAt: sql<string | null>`
          (SELECT MAX(ts) FROM (
            SELECT MAX(s.timestamp) AS ts FROM sessions s WHERE s.keyword_id = ${keywordsTable.id}
            UNION ALL
            SELECT MAX(al.timestamp) AS ts FROM audit_logs al WHERE al.keyword_id = ${keywordsTable.id}
          ) sub)`.as("last_run_at"),
      })
      .from(keywordsTable)
      .leftJoin(clientsTable, eq(keywordsTable.clientId, clientsTable.id))
      .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
      .leftJoin(
        clientAeoPlansTable,
        eq(keywordsTable.aeoPlanId, clientAeoPlansTable.id),
      )
      .where(and(...conditions));

    const ids = keywords.map((k) => k.id);
    const linksByKeyword = new Map<
      number,
      (typeof keywordLinksTable.$inferSelect)[]
    >();
    if (ids.length > 0) {
      const allLinks = await db
        .select()
        .from(keywordLinksTable)
        .where(inArray(keywordLinksTable.keywordId, ids))
        .orderBy(keywordLinksTable.createdAt);
      for (const l of allLinks) {
        const arr = linksByKeyword.get(l.keywordId) ?? [];
        arr.push(l);
        linksByKeyword.set(l.keywordId, arr);
      }
    }

    res.json(
      keywords.map((k) => ({
        ...k,
        clientName: k.joinedClientName ?? null,
        businessName: k.joinedBusinessName ?? null,
        campaignName: k.joinedCampaignName ?? null,
        lastRunAt: k.lastRunAt ?? null,
        links: linksByKeyword.get(k.id) ?? [],
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Portal keywords (admin-shape) list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/keywords/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const rawId = req.params.id;
    const id = Number.parseInt(typeof rawId === "string" ? rawId : "", 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db
      .select({
        kw: keywordsTable,
        clientName: clientsTable.businessName,
        businessName: businessesTable.name,
        campaignName: clientAeoPlansTable.name,
      })
      .from(keywordsTable)
      .leftJoin(clientsTable, eq(keywordsTable.clientId, clientsTable.id))
      .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
      .leftJoin(
        clientAeoPlansTable,
        eq(keywordsTable.aeoPlanId, clientAeoPlansTable.id),
      )
      .where(eq(keywordsTable.id, id));
    if (!row || row.kw.clientId !== clientId) {
      return res.status(404).json({ error: "Not found" });
    }
    const links = await db
      .select()
      .from(keywordLinksTable)
      .where(eq(keywordLinksTable.keywordId, id))
      .orderBy(keywordLinksTable.createdAt);
    res.json({
      ...row.kw,
      clientName: row.clientName ?? null,
      businessName: row.businessName ?? null,
      campaignName: row.campaignName ?? null,
      links,
    });
  } catch (err) {
    req.log.error({ err }, "Portal keyword detail error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/keywords", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.keywordText !== "string" || !body.keywordText.trim()) {
      return res.status(400).json({ error: "keywordText is required" });
    }

    let aeoPlanId: number | null = null;
    if (body.aeoPlanId !== undefined && body.aeoPlanId !== null) {
      const plan = await loadOwnedAeoPlan(res, clientId, String(body.aeoPlanId));
      if (!plan) return;
      aeoPlanId = plan.id;
    }

    let businessId: number | null = null;
    if (body.businessId !== undefined && body.businessId !== null) {
      const ok = await verifyBusinessBelongsToClient(res, clientId, body.businessId);
      if (!ok) return;
      businessId = Number(body.businessId);
    }

    const [keyword] = await db
      .insert(keywordsTable)
      .values({
        clientId,
        businessId,
        aeoPlanId,
        keywordText: body.keywordText.trim(),
        keywordType: body.keywordType != null ? Number(body.keywordType) : 3,
        isActive: body.isActive !== false,
        isPrimary: body.isPrimary != null ? Number(body.isPrimary) : 0,
        notes:
          typeof body.notes === "string" || body.notes === null
            ? (body.notes as string | null)
            : null,
      })
      .returning();
    res.status(201).json(keyword);
  } catch (err) {
    req.log.error({ err }, "Portal keyword (admin-shape) create error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/keywords/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const existing = await loadOwnedKeyword(res, clientId, req.params.id);
    if (!existing) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    /* Silently drop clientId to prevent reassignment across tenants. */
    if ("clientId" in body) delete body.clientId;

    if ("aeoPlanId" in body && body.aeoPlanId !== null) {
      const plan = await loadOwnedAeoPlan(res, clientId, String(body.aeoPlanId));
      if (!plan) return;
    }
    if ("businessId" in body && body.businessId !== null) {
      const ok = await verifyBusinessBelongsToClient(res, clientId, body.businessId);
      if (!ok) return;
    }

    /* Mirror admin's allow-list — same coercion rules. */
    const allowed: Record<string, unknown> = {};
    if (body.keywordText !== undefined)
      allowed.keywordText = String(body.keywordText).trim();
    if (body.keywordType !== undefined)
      allowed.keywordType = Number(body.keywordType);
    if (body.isActive !== undefined) allowed.isActive = Boolean(body.isActive);
    if (body.isPrimary !== undefined) allowed.isPrimary = Number(body.isPrimary);
    if (body.aeoPlanId !== undefined)
      allowed.aeoPlanId = body.aeoPlanId === null ? null : Number(body.aeoPlanId);
    if (body.businessId !== undefined)
      allowed.businessId =
        body.businessId === null ? null : Number(body.businessId);
    if (body.verificationStatus !== undefined)
      allowed.verificationStatus =
        body.verificationStatus === null
          ? null
          : String(body.verificationStatus);
    if (body.status !== undefined)
      allowed.status = body.status === null ? null : String(body.status);
    if (body.notes !== undefined)
      allowed.notes = body.notes === null ? null : String(body.notes);
    if (body.linkTypeLabel !== undefined)
      allowed.linkTypeLabel =
        body.linkTypeLabel === null ? null : String(body.linkTypeLabel);
    if (body.linkActive !== undefined)
      allowed.linkActive = Boolean(body.linkActive);

    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const [keyword] = await db
      .update(keywordsTable)
      .set(allowed)
      .where(eq(keywordsTable.id, existing.id))
      .returning();
    if (!keyword) return res.status(404).json({ error: "Not found" });
    res.json(keyword);
  } catch (err) {
    req.log.error({ err }, "Portal keyword (admin-shape) patch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/keywords/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const existing = await loadOwnedKeyword(res, clientId, req.params.id);
    if (!existing) return;
    await db.delete(keywordsTable).where(eq(keywordsTable.id, existing.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Portal keyword (admin-shape) delete error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/keywords/:id/links", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const existing = await loadOwnedKeyword(res, clientId, req.params.id);
    if (!existing) return;
    const links = await db
      .select()
      .from(keywordLinksTable)
      .where(eq(keywordLinksTable.keywordId, existing.id))
      .orderBy(keywordLinksTable.createdAt);
    res.json(links);
  } catch (err) {
    req.log.error({ err }, "Portal keyword links (admin-shape) list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/keywords/:id/links", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const existing = await loadOwnedKeyword(res, clientId, req.params.id);
    if (!existing) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const [link] = await db
      .insert(keywordLinksTable)
      .values({
        keywordId: existing.id,
        linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : null,
        linkTypeLabel:
          typeof body.linkTypeLabel === "string" ? body.linkTypeLabel : null,
        embeddedUrl: typeof body.embeddedUrl === "string" ? body.embeddedUrl : null,
        linkActive: body.linkActive !== false,
        initialRankReportLink:
          typeof body.initialRankReportLink === "string"
            ? body.initialRankReportLink
            : null,
        currentRankReportLink:
          typeof body.currentRankReportLink === "string"
            ? body.currentRankReportLink
            : null,
      })
      .returning();
    /* Match admin's side-effect: bump keyword type so the FE filter
       "Keywords with Backlinks" picks it up. */
    await db
      .update(keywordsTable)
      .set({ keywordType: 4 })
      .where(eq(keywordsTable.id, existing.id));
    res.status(201).json(link);
  } catch (err) {
    req.log.error({ err }, "Portal keyword link (admin-shape) create error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch(
  "/keywords/:id/links/:linkId",
  requirePortalAuth,
  async (req, res) => {
    try {
      const clientId = await requireLinkedClient(req, res);
      if (clientId == null) return;
      const owned = await loadOwnedKeyword(res, clientId, req.params.id);
      if (!owned) return;

      const rawLinkId = req.params.linkId;
      const linkId = Number.parseInt(
        typeof rawLinkId === "string" ? rawLinkId : "",
        10,
      );
      if (Number.isNaN(linkId)) {
        return res.status(400).json({ error: "Invalid link id" });
      }
      const [existingLink] = await db
        .select()
        .from(keywordLinksTable)
        .where(eq(keywordLinksTable.id, linkId));
      if (!existingLink || existingLink.keywordId !== owned.id) {
        return res.status(404).json({ error: "Link not found" });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const allowed: Record<string, unknown> = {};
      if (body.linkUrl !== undefined) allowed.linkUrl = body.linkUrl ?? null;
      if (body.linkTypeLabel !== undefined)
        allowed.linkTypeLabel = body.linkTypeLabel ?? null;
      if (body.embeddedUrl !== undefined)
        allowed.embeddedUrl = body.embeddedUrl ?? null;
      if (body.linkActive !== undefined)
        allowed.linkActive = Boolean(body.linkActive);
      if (body.initialRankReportLink !== undefined)
        allowed.initialRankReportLink = body.initialRankReportLink ?? null;
      if (body.currentRankReportLink !== undefined)
        allowed.currentRankReportLink = body.currentRankReportLink ?? null;
      if (Object.keys(allowed).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      const [link] = await db
        .update(keywordLinksTable)
        .set(allowed)
        .where(eq(keywordLinksTable.id, linkId))
        .returning();
      if (!link) return res.status(404).json({ error: "Link not found" });
      res.json(link);
    } catch (err) {
      req.log.error({ err }, "Portal keyword link (admin-shape) patch error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.delete(
  "/keywords/:id/links/:linkId",
  requirePortalAuth,
  async (req, res) => {
    try {
      const clientId = await requireLinkedClient(req, res);
      if (clientId == null) return;
      const owned = await loadOwnedKeyword(res, clientId, req.params.id);
      if (!owned) return;

      const rawLinkId = req.params.linkId;
      const linkId = Number.parseInt(
        typeof rawLinkId === "string" ? rawLinkId : "",
        10,
      );
      if (Number.isNaN(linkId)) {
        return res.status(400).json({ error: "Invalid link id" });
      }
      const [existingLink] = await db
        .select()
        .from(keywordLinksTable)
        .where(eq(keywordLinksTable.id, linkId));
      if (!existingLink || existingLink.keywordId !== owned.id) {
        return res.status(404).json({ error: "Link not found" });
      }

      await db.delete(keywordLinksTable).where(eq(keywordLinksTable.id, linkId));
      /* If we removed the last link, revert keyword type to plain
         "Keywords" (3) — matches admin's behavior. */
      const remaining = await db
        .select({ id: keywordLinksTable.id })
        .from(keywordLinksTable)
        .where(eq(keywordLinksTable.keywordId, owned.id));
      if (remaining.length === 0) {
        await db
          .update(keywordsTable)
          .set({ keywordType: 3 })
          .where(eq(keywordsTable.id, owned.id));
      }
      res.status(204).send();
    } catch (err) {
      req.log.error({ err }, "Portal keyword link (admin-shape) delete error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ─── Rankings (read-only) ────────────────────────────────── */

router.get("/ranking-reports", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const { businessId, aeoPlanId, keywordId } = req.query as Record<
      string,
      string
    >;
    const conditions: ReturnType<typeof eq>[] = [
      eq(rankingReportsTable.clientId, clientId),
    ];
    if (businessId) {
      const bid = Number.parseInt(businessId, 10);
      if (!Number.isNaN(bid))
        conditions.push(eq(rankingReportsTable.businessId, bid));
    }
    if (aeoPlanId) {
      const aid = Number.parseInt(aeoPlanId, 10);
      if (!Number.isNaN(aid)) conditions.push(eq(keywordsTable.aeoPlanId, aid));
    }
    if (keywordId) {
      const kid = Number.parseInt(keywordId, 10);
      if (!Number.isNaN(kid))
        conditions.push(eq(rankingReportsTable.keywordId, kid));
    }

    const reports = await db
      .select({
        id: rankingReportsTable.id,
        clientId: rankingReportsTable.clientId,
        businessId: rankingReportsTable.businessId,
        keywordId: rankingReportsTable.keywordId,
        clientName: rankingReportsTable.clientName,
        bizName: rankingReportsTable.bizName,
        searchAddress: rankingReportsTable.searchAddress,
        keyword: rankingReportsTable.keyword,
        timestamp: rankingReportsTable.timestamp,
        date: rankingReportsTable.date,
        platform: rankingReportsTable.platform,
        deviceIdentifier: rankingReportsTable.deviceIdentifier,
        status: rankingReportsTable.status,
        durationSeconds: rankingReportsTable.durationSeconds,
        rankingPosition: rankingReportsTable.rankingPosition,
        rankingTotal: rankingReportsTable.rankingTotal,
        reasonRecommended: rankingReportsTable.reasonRecommended,
        mapsPresence: rankingReportsTable.mapsPresence,
        mapsUrl: rankingReportsTable.mapsUrl,
        screenshotUrl: rankingReportsTable.screenshotUrl,
        textRanking: rankingReportsTable.textRanking,
        isInitialRanking: rankingReportsTable.isInitialRanking,
        proxyStatus: rankingReportsTable.proxyStatus,
        proxyUsername: rankingReportsTable.proxyUsername,
        proxyHost: rankingReportsTable.proxyHost,
        proxyPort: rankingReportsTable.proxyPort,
        proxyIp: rankingReportsTable.proxyIp,
        proxyCity: rankingReportsTable.proxyCity,
        proxyRegion: rankingReportsTable.proxyRegion,
        proxyCountry: rankingReportsTable.proxyCountry,
        proxyZip: rankingReportsTable.proxyZip,
        baseLatitude: rankingReportsTable.baseLatitude,
        baseLongitude: rankingReportsTable.baseLongitude,
        mockedLatitude: rankingReportsTable.mockedLatitude,
        mockedLongitude: rankingReportsTable.mockedLongitude,
        mockedTimezone: rankingReportsTable.mockedTimezone,
        failureStep: rankingReportsTable.failureStep,
        error: rankingReportsTable.error,
        createdAt: rankingReportsTable.createdAt,
        joinedClientName: clientsTable.businessName,
        joinedBusinessName: businessesTable.name,
        joinedKeywordText: keywordsTable.keywordText,
        aeoPlanId: keywordsTable.aeoPlanId,
      })
      .from(rankingReportsTable)
      .leftJoin(clientsTable, eq(rankingReportsTable.clientId, clientsTable.id))
      .leftJoin(
        businessesTable,
        eq(rankingReportsTable.businessId, businessesTable.id),
      )
      .leftJoin(
        keywordsTable,
        eq(rankingReportsTable.keywordId, keywordsTable.id),
      )
      .where(and(...conditions))
      .orderBy(desc(rankingReportsTable.createdAt));

    res.json(
      reports.map((r) => ({
        ...r,
        clientName: r.clientName ?? r.joinedClientName ?? null,
        bizName: r.bizName ?? r.joinedBusinessName ?? null,
        keyword: r.keyword ?? r.joinedKeywordText ?? null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Portal ranking-reports list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/ranking-reports/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const report = await loadOwnedRankingReport(res, clientId, req.params.id);
    if (!report) return;
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Portal ranking-report detail error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /portal/rankings/bi-weekly-report
   Mirror of admin's GET /api/ranking-reports/bi-weekly-report shape, but
   the clientId filter is force-bound to req.portalClientId. The huge
   analytics SQL block is intentionally kept identical to admin so the
   FE can swap URLs without touching response handling. */
router.get(
  "/rankings/bi-weekly-report",
  requirePortalAuth,
  async (req, res) => {
    try {
      const clientId = await requireLinkedClient(req, res);
      if (clientId == null) return;

      const businessId = req.query.businessId
        ? Number.parseInt(req.query.businessId as string, 10)
        : null;
      const aeoPlanId = req.query.aeoPlanId
        ? Number.parseInt(req.query.aeoPlanId as string, 10)
        : null;

      const conds: string[] = ["date IS NOT NULL"];
      const params: (number | null)[] = [];
      params.push(clientId);
      conds.push(`client_id = $${params.length}`);
      if (businessId !== null && !Number.isNaN(businessId)) {
        params.push(businessId);
        conds.push(`business_id = $${params.length}`);
      }
      if (aeoPlanId !== null && !Number.isNaN(aeoPlanId)) {
        params.push(aeoPlanId);
        conds.push(
          `keyword_id IN (SELECT id FROM keywords WHERE aeo_plan_id = $${params.length})`,
        );
      }
      const where = conds.join(" AND ");

      const batchesRes = await pool.query<{ date: string; combos: string }>(
        `SELECT date, COUNT(*) AS combos FROM ranking_reports WHERE ${where}
         GROUP BY date ORDER BY date DESC`,
        params,
      );
      if (batchesRes.rows.length === 0) {
        return res.json({
          currentBatch: null,
          oldFile: null,
          rankingTrend: null,
          initialRanking: null,
          allBatches: [],
        });
      }
      const currentBatchDate = batchesRes.rows[0].date;
      const allBatches = batchesRes.rows.map((r) => ({
        date: r.date,
        combos: Number(r.combos),
      }));
      const nextDue = new Date(currentBatchDate);
      nextDue.setUTCDate(nextDue.getUTCDate() + 14);
      const nextDueDate = nextDue.toISOString().slice(0, 10);

      const currentParamIdx = params.length + 1;
      const paramsWithBatch = [...params, currentBatchDate];

      const sA = await pool.query(
        `SELECT
           COUNT(DISTINCT (keyword_id, lower(platform))) AS unique_combos,
           COUNT(DISTINCT business_id) AS unique_businesses,
           COUNT(DISTINCT client_id)   AS unique_clients,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM ranking_reports r2
             WHERE r2.keyword_id = ranking_reports.keyword_id
               AND lower(r2.platform) = lower(ranking_reports.platform)
               AND r2.date < ranking_reports.date
           )) AS new_combos
         FROM ranking_reports WHERE ${where} AND date = $${currentParamIdx}`,
        paramsWithBatch,
      );
      /* Sessions count for the batch date — scoped to this client (and
         optionally the business filter), ET-converted to match admin. */
      const sessionsParams: (number | string)[] = [currentBatchDate, clientId];
      let sessionsBusinessClause = "";
      if (businessId !== null && !Number.isNaN(businessId)) {
        sessionsParams.push(businessId);
        sessionsBusinessClause = `AND business_id = $${sessionsParams.length}`;
      }
      const sessions = await pool.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM audit_logs
         WHERE to_char(((timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York'),'YYYY-MM-DD') = $1
           AND client_id = $2
           ${sessionsBusinessClause}`,
        sessionsParams,
      );
      const sectA = sA.rows[0];
      const sectionA = {
        batchDate: currentBatchDate,
        nextDueDate,
        totalSessions: Number(sessions.rows[0].n),
        uniqueCombos: Number(sectA.unique_combos),
        uniqueBusinesses: Number(sectA.unique_businesses),
        uniqueClients: Number(sectA.unique_clients),
        newCombos: Number(sectA.new_combos),
        auditType:
          Number(sectA.new_combos) === Number(sectA.unique_combos)
            ? "First-Ever Audit"
            : "Recurring Audit",
      };

      const sB = await pool.query(
        `WITH old_combos AS (
           SELECT keyword_id, lower(platform) AS platform,
                  MIN(date::date) AS first_date,
                  MAX(date::date) AS last_date,
                  BOOL_OR(status = 'error') AS had_error
           FROM ranking_reports WHERE ${where} AND date < $${currentParamIdx}
           GROUP BY keyword_id, lower(platform)
         )
         SELECT
           COUNT(*) AS total_old,
           COUNT(*) FILTER (WHERE last_date >= (CURRENT_DATE - INTERVAL '14 days')) AS on_schedule,
           COUNT(*) FILTER (WHERE last_date <  (CURRENT_DATE - INTERVAL '14 days')) AS still_behind,
           COUNT(*) FILTER (WHERE had_error) AS with_errors,
           MIN(first_date)::text AS earliest_date,
           MAX(last_date)::text  AS latest_old_date
         FROM old_combos`,
        paramsWithBatch,
      );
      const sBBatches = await pool.query<{
        expected_batch_date: string;
        combos: string;
      }>(
        `WITH old_combos AS (
           SELECT keyword_id, lower(platform) AS platform,
                  MAX(date::date) AS last_date
           FROM ranking_reports WHERE ${where} AND date < $${currentParamIdx}
           GROUP BY keyword_id, lower(platform)
         )
         SELECT (last_date + INTERVAL '14 days')::date::text AS expected_batch_date,
                COUNT(*) AS combos
         FROM old_combos
         WHERE last_date < (CURRENT_DATE - INTERVAL '14 days')
         GROUP BY expected_batch_date
         ORDER BY expected_batch_date`,
        paramsWithBatch,
      );
      const sBr = sB.rows[0];
      const sectionB = {
        earliestDate: sBr.earliest_date,
        latestOldDate: sBr.latest_old_date,
        totalOldCombos: Number(sBr.total_old),
        onSchedule: Number(sBr.on_schedule),
        stillBehindTotal: Number(sBr.still_behind),
        withErrors: Number(sBr.with_errors),
        stillBehindByBatch: sBBatches.rows.map((r) => ({
          expectedBatchDate: r.expected_batch_date,
          combos: Number(r.combos),
        })),
      };

      const sC = await pool.query(
        `WITH old_runs AS (
           SELECT keyword_id, lower(platform) AS platform,
                  array_agg(ranking_position ORDER BY date DESC, id DESC) AS ranks_desc
           FROM ranking_reports WHERE ${where} AND date < $${currentParamIdx}
           GROUP BY keyword_id, lower(platform)
           HAVING COUNT(*) >= 2
         )
         SELECT
           COUNT(*) FILTER (WHERE ranks_desc[1] IS NOT NULL AND ranks_desc[2] IS NOT NULL AND ranks_desc[1] < ranks_desc[2]) AS improved,
           COUNT(*) FILTER (WHERE ranks_desc[1] IS NOT NULL AND ranks_desc[2] IS NOT NULL AND ranks_desc[1] > ranks_desc[2]) AS declined,
           COUNT(*) FILTER (WHERE ranks_desc[1] IS NOT NULL AND ranks_desc[2] IS NOT NULL AND ranks_desc[1] = ranks_desc[2]) AS no_change,
           COUNT(*) FILTER (WHERE ranks_desc[1] IS NULL) AS not_ranked,
           COUNT(*) AS eligible_total
         FROM old_runs`,
        paramsWithBatch,
      );
      const sCr = sC.rows[0];
      const sectionC = {
        eligibleCombos: Number(sCr.eligible_total),
        improved: Number(sCr.improved),
        declined: Number(sCr.declined),
        noChange: Number(sCr.no_change),
        notRanked: Number(sCr.not_ranked),
      };

      const sD = await pool.query(
        `WITH new_combos AS (
           SELECT ranking_position FROM ranking_reports
           WHERE ${where}
             AND date = $${currentParamIdx}
             AND NOT EXISTS (
               SELECT 1 FROM ranking_reports r2
               WHERE r2.keyword_id = ranking_reports.keyword_id
                 AND lower(r2.platform) = lower(ranking_reports.platform)
                 AND r2.date < ranking_reports.date
             )
         )
         SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE ranking_position BETWEEN 1 AND 3) AS top3,
           COUNT(*) FILTER (WHERE ranking_position BETWEEN 4 AND 10) AS top4_10,
           COUNT(*) FILTER (WHERE ranking_position BETWEEN 11 AND 30) AS top11_30,
           COUNT(*) FILTER (WHERE ranking_position > 30) AS beyond,
           COUNT(*) FILTER (WHERE ranking_position IS NULL OR ranking_position = 0) AS not_ranked
         FROM new_combos`,
        paramsWithBatch,
      );
      const sDr = sD.rows[0];
      const total = Number(sDr.total) || 1;
      const sectionD = {
        totalNewCombos: Number(sDr.total),
        buckets: {
          top3: {
            count: Number(sDr.top3),
            pct: Number(((Number(sDr.top3) / total) * 100).toFixed(1)),
          },
          top4to10: {
            count: Number(sDr.top4_10),
            pct: Number(((Number(sDr.top4_10) / total) * 100).toFixed(1)),
          },
          top11to30: {
            count: Number(sDr.top11_30),
            pct: Number(((Number(sDr.top11_30) / total) * 100).toFixed(1)),
          },
          beyond30: {
            count: Number(sDr.beyond),
            pct: Number(((Number(sDr.beyond) / total) * 100).toFixed(1)),
          },
          notRanked: {
            count: Number(sDr.not_ranked),
            pct: Number(((Number(sDr.not_ranked) / total) * 100).toFixed(1)),
          },
        },
      };

      res.json({
        currentBatch: sectionA,
        oldFile: sectionB,
        rankingTrend: sectionC,
        initialRanking: sectionD,
        allBatches,
      });
    } catch (err) {
      req.log.error({ err }, "Portal bi-weekly-report error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ranking-runs is a global table — no client-scope column. Returning a
   filtered slice would require joining through ranking_reports, which
   the FE doesn't actually use for the portal MVP. Stub to empty / null
   so the FE's existing hooks resolve cleanly. */
// TODO(portal): scope ranking_runs by joining to ranking_reports.client_id
router.get("/ranking-runs", requirePortalAuth, async (_req, res) => {
  res.json([]);
});

router.get("/ranking-runs/latest", requirePortalAuth, async (_req, res) => {
  res.json(null);
});

router.get(
  "/ranking-runs/latest-detail",
  requirePortalAuth,
  async (_req, res) => {
    res.json({ date: "", platforms: [] });
  },
);

/* ─── AEO Plans (campaigns) ───────────────────────────────── */

router.get("/aeo-plans", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const businessIdParam = req.query.businessId as string | undefined;
    const businessIdNum = businessIdParam
      ? Number.parseInt(businessIdParam, 10)
      : null;

    const plans = await db
      .select()
      .from(clientAeoPlansTable)
      .where(
        businessIdNum != null && !Number.isNaN(businessIdNum)
          ? and(
              eq(clientAeoPlansTable.clientId, clientId),
              eq(clientAeoPlansTable.businessId, businessIdNum),
            )
          : eq(clientAeoPlansTable.clientId, clientId),
      )
      .orderBy(asc(clientAeoPlansTable.createdAt));

    const ids = plans.map((p) => p.id);
    const counts = new Map<number, number>();
    for (const id of ids) counts.set(id, 0);
    if (ids.length > 0) {
      const kwRows = await db
        .select({
          aeoPlanId: keywordsTable.aeoPlanId,
          c: sql<number>`count(*)::int`,
        })
        .from(keywordsTable)
        .where(
          and(
            inArray(keywordsTable.aeoPlanId, ids),
            eq(keywordsTable.isActive, true),
          ),
        )
        .groupBy(keywordsTable.aeoPlanId);
      for (const r of kwRows) {
        if (r.aeoPlanId != null) counts.set(r.aeoPlanId, Number(r.c));
      }
    }

    res.json(
      plans.map((p) => ({
        ...p,
        keywordCount: counts.get(p.id) ?? 0,
        monthlyAeoBudget:
          p.monthlyAeoBudget != null ? Number(p.monthlyAeoBudget) : null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Portal aeo-plans list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/aeo-plans/:planId", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const plan = await loadOwnedAeoPlan(res, clientId, req.params.planId);
    if (!plan) return;
    res.json({
      ...plan,
      monthlyAeoBudget:
        plan.monthlyAeoBudget != null ? Number(plan.monthlyAeoBudget) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Portal aeo-plan detail error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/aeo-plans", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.planType || typeof body.planType !== "string") {
      return res.status(400).json({ error: "planType is required" });
    }

    if (body.businessId !== undefined && body.businessId !== null) {
      const ok = await verifyBusinessBelongsToClient(
        res,
        clientId,
        body.businessId,
      );
      if (!ok) return;
    }

    const rawName = typeof body.name === "string" ? body.name.trim() : null;
    if (rawName) {
      const businessIdNum =
        body.businessId != null ? Number(body.businessId) : null;
      const [existing] = await db
        .select({
          id: clientAeoPlansTable.id,
          name: clientAeoPlansTable.name,
        })
        .from(clientAeoPlansTable)
        .where(
          and(
            eq(clientAeoPlansTable.clientId, clientId),
            businessIdNum !== null
              ? eq(clientAeoPlansTable.businessId, businessIdNum)
              : sql`${clientAeoPlansTable.businessId} IS NULL`,
            sql`lower(trim(${clientAeoPlansTable.name})) = lower(${rawName})`,
          ),
        )
        .limit(1);
      if (existing) {
        return res.status(409).json({
          error: `A campaign named "${existing.name}" already exists for this business (id ${existing.id}).`,
          conflictId: existing.id,
        });
      }
    }

    const [plan] = await db
      .insert(clientAeoPlansTable)
      .values({
        clientId,
        businessId: body.businessId != null ? Number(body.businessId) : null,
        name: (body.name as string) ?? null,
        businessName: (body.businessName as string) ?? null,
        planType: body.planType,
        sampleQuestion1: (body.sampleQuestion1 as string) ?? null,
        sampleQuestion2: (body.sampleQuestion2 as string) ?? null,
        sampleQuestion3: (body.sampleQuestion3 as string) ?? null,
        sampleQuestion4: (body.sampleQuestion4 as string) ?? null,
        sampleQuestion5: (body.sampleQuestion5 as string) ?? null,
        sampleQuestion6: (body.sampleQuestion6 as string) ?? null,
        sampleQuestion7: (body.sampleQuestion7 as string) ?? null,
        sampleQuestion8: (body.sampleQuestion8 as string) ?? null,
        sampleQuestion9: (body.sampleQuestion9 as string) ?? null,
        sampleQuestion10: (body.sampleQuestion10 as string) ?? null,
        currentAnswerPresence: (body.currentAnswerPresence as string) ?? null,
        searchBoostTarget:
          body.searchBoostTarget != null
            ? Number(body.searchBoostTarget)
            : null,
        monthlyAeoBudget:
          body.monthlyAeoBudget != null
            ? String(body.monthlyAeoBudget)
            : null,
        schemaImplementor: (body.schemaImplementor as string) ?? null,
        searchAddress: (body.searchAddress as string) ?? null,
        subscriptionId: (body.subscriptionId as string) ?? null,
        subscriptionStartDate: (body.subscriptionStartDate as string) ?? null,
        nextBillingDate: (body.nextBillingDate as string) ?? null,
        cardLast4: (body.cardLast4 as string) ?? null,
        createdBy: (body.createdBy as string) ?? null,
      })
      .returning();

    res.status(201).json({
      ...plan,
      monthlyAeoBudget:
        plan.monthlyAeoBudget != null ? Number(plan.monthlyAeoBudget) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Portal aeo-plan create error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/aeo-plans/:planId", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const existing = await loadOwnedAeoPlan(res, clientId, req.params.planId);
    if (!existing) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    /* Silently drop clientId from the body — portal users can't reassign. */
    if ("clientId" in body) delete body.clientId;

    if ("businessId" in body && body.businessId !== null) {
      const ok = await verifyBusinessBelongsToClient(
        res,
        clientId,
        body.businessId,
      );
      if (!ok) return;
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ("businessId" in body)
      update.businessId =
        body.businessId != null ? Number(body.businessId) : null;

    const fields = [
      "name",
      "businessName",
      "planType",
      "sampleQuestion1",
      "sampleQuestion2",
      "sampleQuestion3",
      "sampleQuestion4",
      "sampleQuestion5",
      "sampleQuestion6",
      "sampleQuestion7",
      "sampleQuestion8",
      "sampleQuestion9",
      "sampleQuestion10",
      "currentAnswerPresence",
      "schemaImplementor",
      "searchAddress",
      "subscriptionId",
      "subscriptionStartDate",
      "nextBillingDate",
      "cardLast4",
      "createdBy",
    ];
    for (const f of fields) {
      if (f in body) update[f] = body[f] ?? null;
    }
    if ("searchBoostTarget" in body)
      update.searchBoostTarget =
        body.searchBoostTarget != null ? Number(body.searchBoostTarget) : null;
    if ("monthlyAeoBudget" in body)
      update.monthlyAeoBudget =
        body.monthlyAeoBudget != null ? String(body.monthlyAeoBudget) : null;

    if (typeof update.name === "string" && update.name.trim() !== "") {
      const trimmed = (update.name as string).trim();
      const targetBusinessId =
        "businessId" in update
          ? (update.businessId as number | null)
          : (existing.businessId ?? null);
      const [conflict] = await db
        .select({ id: clientAeoPlansTable.id, name: clientAeoPlansTable.name })
        .from(clientAeoPlansTable)
        .where(
          and(
            eq(clientAeoPlansTable.clientId, clientId),
            targetBusinessId !== null
              ? eq(clientAeoPlansTable.businessId, targetBusinessId)
              : sql`${clientAeoPlansTable.businessId} IS NULL`,
            sql`lower(trim(${clientAeoPlansTable.name})) = lower(${trimmed})`,
            sql`${clientAeoPlansTable.id} <> ${existing.id}`,
          ),
        )
        .limit(1);
      if (conflict) {
        return res.status(409).json({
          error: `Another campaign named "${conflict.name}" already exists for this business (id ${conflict.id}).`,
          conflictId: conflict.id,
        });
      }
      update.name = trimmed;
    }

    const [updated] = await db
      .update(clientAeoPlansTable)
      .set(update as Partial<typeof clientAeoPlansTable.$inferInsert>)
      .where(eq(clientAeoPlansTable.id, existing.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Plan not found" });
    res.json({
      ...updated,
      monthlyAeoBudget:
        updated.monthlyAeoBudget != null
          ? Number(updated.monthlyAeoBudget)
          : null,
    });
  } catch (err) {
    req.log.error({ err }, "Portal aeo-plan patch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/aeo-plans/:planId", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const plan = await loadOwnedAeoPlan(res, clientId, req.params.planId);
    if (!plan) return;
    await db
      .delete(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.id, plan.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Portal aeo-plan delete error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Businesses (admin-shape) ────────────────────────────── */

/**
 * Load a business and verify it belongs to `clientId`. Mirrors the other
 * `loadOwned*` helpers — 404 on miss or mismatch (never 403, no leaks).
 */
async function loadOwnedBusiness(
  res: Response,
  clientId: number,
  rawId: string | string[] | undefined,
): Promise<typeof businessesTable.$inferSelect | null> {
  const businessId = Number.parseInt(typeof rawId === "string" ? rawId : "", 10);
  if (Number.isNaN(businessId)) {
    res.status(400).json({ error: "Invalid business id" });
    return null;
  }
  const [row] = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId));
  if (!row || row.clientId !== clientId) {
    res.status(404).json({ error: "Business not found" });
    return null;
  }
  return row;
}

router.get("/businesses", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    /* Admin accepts `?clientId=X` to filter; portal force-binds to the
       customer's own client, so any value passed in the query is ignored. */
    const rows = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.clientId, clientId))
      .orderBy(desc(businessesTable.createdAt));

    const ids = rows.map((b) => b.id);
    const counts = new Map<
      number,
      { keywordCount: number; campaignCount: number }
    >();
    for (const id of ids) counts.set(id, { keywordCount: 0, campaignCount: 0 });

    if (ids.length > 0) {
      const kwRows = await db
        .select({
          businessId: keywordsTable.businessId,
          c: sql<number>`count(*)::int`,
        })
        .from(keywordsTable)
        .where(inArray(keywordsTable.businessId, ids))
        .groupBy(keywordsTable.businessId);
      for (const r of kwRows) {
        if (r.businessId != null)
          counts.get(r.businessId)!.keywordCount = Number(r.c);
      }

      const cpRows = await db
        .select({
          businessId: clientAeoPlansTable.businessId,
          c: sql<number>`count(*)::int`,
        })
        .from(clientAeoPlansTable)
        .where(inArray(clientAeoPlansTable.businessId, ids))
        .groupBy(clientAeoPlansTable.businessId);
      for (const r of cpRows) {
        if (r.businessId != null)
          counts.get(r.businessId)!.campaignCount = Number(r.c);
      }
    }

    res.json(rows.map((b) => ({ ...b, ...counts.get(b.id)! })));
  } catch (err) {
    req.log.error({ err }, "Portal businesses list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/businesses/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const business = await loadOwnedBusiness(res, clientId, req.params.id);
    if (!business) return;
    res.json(business);
  } catch (err) {
    req.log.error({ err }, "Portal business detail error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/businesses", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.name !== "string" || !String(body.name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const trimmedName = String(body.name).trim();

    /* Mirror admin's case-insensitive dupe-name check, scoped to this client. */
    const [existing] = await db
      .select({ id: businessesTable.id, name: businessesTable.name })
      .from(businessesTable)
      .where(
        and(
          eq(businessesTable.clientId, clientId),
          sql`lower(trim(${businessesTable.name})) = lower(${trimmedName})`,
        ),
      )
      .limit(1);
    if (existing) {
      return res.status(409).json({
        error: `This client already has a business named "${existing.name}" (id ${existing.id}).`,
        conflictId: existing.id,
      });
    }

    const [business] = await db
      .insert(businessesTable)
      .values({
        /* clientId is force-bound; any value in body is silently ignored. */
        clientId,
        name: trimmedName,
        gmbUrl: typeof body.gmbUrl === "string" ? body.gmbUrl : null,
        websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
        category: typeof body.category === "string" ? body.category : null,
        publishedAddress:
          typeof body.publishedAddress === "string"
            ? body.publishedAddress
            : null,
        zipCode: typeof body.zipCode === "string" ? body.zipCode : null,
        city: typeof body.city === "string" ? body.city : null,
        state: typeof body.state === "string" ? body.state : null,
        country: typeof body.country === "string" ? body.country : null,
        placeId: typeof body.placeId === "string" ? body.placeId : null,
        latitude: body.latitude != null ? Number(body.latitude) : null,
        longitude: body.longitude != null ? Number(body.longitude) : null,
        timezone: typeof body.timezone === "string" ? body.timezone : null,
        websitePublishedOnGmb:
          typeof body.websitePublishedOnGmb === "string"
            ? body.websitePublishedOnGmb
            : null,
        websiteLinkedOnGmb:
          typeof body.websiteLinkedOnGmb === "string"
            ? body.websiteLinkedOnGmb
            : null,
        status: body.status === "inactive" ? "inactive" : "active",
        notes: typeof body.notes === "string" ? body.notes : null,
      })
      .returning();
    res.status(201).json(business);
  } catch (err) {
    req.log.error({ err }, "Portal business create error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/businesses/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const existing = await loadOwnedBusiness(res, clientId, req.params.id);
    if (!existing) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    /* Silently drop clientId to prevent reassignment across tenants —
       same pattern as PATCH /keywords/:id and PATCH /aeo-plans/:planId. */
    if ("clientId" in body) delete body.clientId;
    /* Admin's PATCH also drops searchAddress (not a column on businesses);
       keep parity so the FE can send identical bodies to both APIs. */
    if ("searchAddress" in body) delete body.searchAddress;

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return res.status(400).json({ error: "name cannot be empty" });
      }
      const trimmed = body.name.trim();
      const [conflict] = await db
        .select({ id: businessesTable.id, name: businessesTable.name })
        .from(businessesTable)
        .where(
          and(
            eq(businessesTable.clientId, clientId),
            sql`lower(trim(${businessesTable.name})) = lower(${trimmed})`,
            sql`${businessesTable.id} <> ${existing.id}`,
          ),
        )
        .limit(1);
      if (conflict) {
        return res.status(409).json({
          error: `This client already has another business named "${conflict.name}" (id ${conflict.id}).`,
          conflictId: conflict.id,
        });
      }
      update.name = trimmed;
    }

    const stringFields = [
      "gmbUrl",
      "websiteUrl",
      "category",
      "publishedAddress",
      "zipCode",
      "city",
      "state",
      "country",
      "placeId",
      "timezone",
      "websitePublishedOnGmb",
      "websiteLinkedOnGmb",
      "notes",
    ] as const;
    for (const f of stringFields) {
      if (!(f in body)) continue;
      const v = body[f];
      if (v === null) {
        update[f] = null;
      } else if (typeof v === "string") {
        update[f] = v;
      } else {
        return res.status(400).json({ error: `${f} must be a string` });
      }
    }
    if ("latitude" in body)
      update.latitude = body.latitude != null ? Number(body.latitude) : null;
    if ("longitude" in body)
      update.longitude = body.longitude != null ? Number(body.longitude) : null;
    if ("status" in body) {
      if (body.status !== "active" && body.status !== "inactive") {
        return res
          .status(400)
          .json({ error: "status must be 'active' or 'inactive'" });
      }
      update.status = body.status;
    }

    const [business] = await db
      .update(businessesTable)
      .set(update as Partial<typeof businessesTable.$inferInsert>)
      .where(eq(businessesTable.id, existing.id))
      .returning();
    if (!business) return res.status(404).json({ error: "Business not found" });
    res.json(business);
  } catch (err) {
    req.log.error({ err }, "Portal business patch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/businesses/:id", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const existing = await loadOwnedBusiness(res, clientId, req.params.id);
    if (!existing) return;
    /* Hard delete — keywords.business_id and client_aeo_plans.business_id
       both declare ON DELETE CASCADE, so children disappear with the parent.
       Mirrors admin's DELETE /api/businesses/:id (also a hard delete). */
    await db.delete(businessesTable).where(eq(businessesTable.id, existing.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Portal business delete error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* Password change is served by /api/auth/change-password (admin's route);
   it operates on the unified `users` table and works for both admins and
   customers. */

/* ────────────────────────────────────────────────────────────
   Insights — read-only optimization transparency for customers.
   Mirrors the admin rotation/locked-keyword/variant views but is
   ALWAYS scoped to the authenticated customer's own client. No
   mutation: customers can SEE what we're optimizing, never trigger
   rotation, lock, archive, or replacement themselves.
──────────────────────────────────────────────────────────── */

const TOP3 = 3;
const PLATFORM_KEYS = ["chatgpt", "gemini", "perplexity", "google"] as const;

interface EnrichedKeyword {
  id: number;
  keywordText: string;
  status: string | null;
  isActive: boolean;
  archivedAt: string | null;
  archiveReason: string | null;
  replacementSuggestion: string | null;
  aeoPlanId: number | null;
  businessId: number | null;
  campaignName: string | null;
  businessName: string | null;
  latestPosition: number | null;
  latestDate: string | null;
  platforms: Record<string, { position: number | null; date: string | null }>;
  sparkline: number[];
  totalRuns: number;
  top3Runs: number;
  stabilityPercent: number;
  trend: "improving" | "steady" | "declining";
  atRisk: boolean;
  stallingSince: string | null;
  wonPlatform: string | null;
  wonPosition: number | null;
  wonAt: string | null;
}

function dayOf(date: string | null, createdAt: Date | null): string {
  if (date) return date.slice(0, 10);
  if (createdAt) return new Date(createdAt).toISOString().slice(0, 10);
  return "";
}

/**
 * Load all keywords for a client (optionally filtered to a campaign/business)
 * and enrich each with daily rank series, per-platform latest rank, stability
 * %, trend, at-risk detection, and won/lock metadata derived from
 * ranking_reports. Pure read; no writes. Mirrors the admin rotation scan in
 * services/keyword-rotation.ts but client-scoped.
 */
async function scanClientKeywords(
  clientId: number,
  opts: { aeoPlanId?: number; businessId?: number },
): Promise<EnrichedKeyword[]> {
  const conditions = [eq(keywordsTable.clientId, clientId)];
  if (opts.aeoPlanId != null)
    conditions.push(eq(keywordsTable.aeoPlanId, opts.aeoPlanId));
  if (opts.businessId != null)
    conditions.push(eq(keywordsTable.businessId, opts.businessId));

  const kws = await db
    .select({
      id: keywordsTable.id,
      keywordText: keywordsTable.keywordText,
      status: keywordsTable.status,
      isActive: keywordsTable.isActive,
      archivedAt: keywordsTable.archivedAt,
      archiveReason: keywordsTable.archiveReason,
      replacementSuggestion: keywordsTable.replacementSuggestion,
      aeoPlanId: keywordsTable.aeoPlanId,
      businessId: keywordsTable.businessId,
      campaignName: clientAeoPlansTable.name,
      businessName: businessesTable.name,
    })
    .from(keywordsTable)
    .leftJoin(
      clientAeoPlansTable,
      eq(keywordsTable.aeoPlanId, clientAeoPlansTable.id),
    )
    .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
    .where(and(...conditions));

  if (kws.length === 0) return [];

  const ids = kws.map((k) => k.id);
  const reports = await db
    .select({
      keywordId: rankingReportsTable.keywordId,
      platform: rankingReportsTable.platform,
      rankingPosition: rankingReportsTable.rankingPosition,
      date: rankingReportsTable.date,
      createdAt: rankingReportsTable.createdAt,
    })
    .from(rankingReportsTable)
    .where(
      and(
        eq(rankingReportsTable.clientId, clientId),
        inArray(rankingReportsTable.keywordId, ids),
      ),
    )
    .orderBy(asc(rankingReportsTable.createdAt)); // oldest first

  const byKeyword = new Map<number, typeof reports>();
  for (const r of reports) {
    const arr = byKeyword.get(r.keywordId) ?? [];
    arr.push(r);
    byKeyword.set(r.keywordId, arr);
  }

  return kws.map((k) => {
    const rs = byKeyword.get(k.id) ?? [];

    // Per-platform latest rank (oldest-first → last write wins = latest).
    const platforms: EnrichedKeyword["platforms"] = {};
    for (const r of rs) {
      if (!r.platform) continue;
      platforms[r.platform] = {
        position: r.rankingPosition,
        date: dayOf(r.date, r.createdAt) || null,
      };
    }

    // Daily series: best (min) position per day, chronological.
    const byDay = new Map<string, number>();
    for (const r of rs) {
      if (r.rankingPosition == null || r.rankingPosition < 1) continue;
      const day = dayOf(r.date, r.createdAt);
      if (!day) continue;
      const cur = byDay.get(day);
      if (cur == null || r.rankingPosition < cur)
        byDay.set(day, r.rankingPosition);
    }
    const days = [...byDay.keys()].sort();
    const series = days.map((d) => byDay.get(d)!);
    const totalRuns = series.length;
    const top3Runs = series.filter((p) => p <= TOP3).length;
    const stabilityPercent =
      totalRuns > 0 ? Math.round((top3Runs / totalRuns) * 100) : 0;
    const latestPosition = totalRuns > 0 ? series[series.length - 1] : null;
    const latestDate = days.length > 0 ? days[days.length - 1] : null;

    let trend: EnrichedKeyword["trend"] = "steady";
    if (series.length >= 2) {
      const a = series[series.length - 1];
      const b = series[series.length - 2];
      trend = a < b ? "improving" : a > b ? "declining" : "steady";
    }

    const active =
      k.isActive && k.status !== "locked" && k.archivedAt == null;
    const last5 = series.slice(-5);
    const atRisk = active && last5.length >= 5 && last5.every((p) => p > TOP3);
    const stallingSince =
      atRisk && days.length >= 5 ? days[days.length - 5] : null;

    // Won info: most recent day the keyword was top-3 (oldest-first → last wins).
    let wonPlatform: string | null = null;
    let wonPosition: number | null = null;
    let wonAt: string | null = null;
    for (const r of rs) {
      if (r.rankingPosition != null && r.rankingPosition <= TOP3) {
        wonPlatform = r.platform ?? null;
        wonPosition = r.rankingPosition;
        wonAt = dayOf(r.date, r.createdAt) || null;
      }
    }

    return {
      id: k.id,
      keywordText: k.keywordText,
      status: k.status,
      isActive: k.isActive,
      archivedAt: k.archivedAt ? new Date(k.archivedAt).toISOString() : null,
      archiveReason: k.archiveReason,
      replacementSuggestion: k.replacementSuggestion,
      aeoPlanId: k.aeoPlanId,
      businessId: k.businessId,
      campaignName: k.campaignName ?? null,
      businessName: k.businessName ?? null,
      latestPosition,
      latestDate,
      platforms,
      sparkline: series.slice(-12),
      totalRuns,
      top3Runs,
      stabilityPercent,
      trend,
      atRisk,
      stallingSince,
      wonPlatform,
      wonPosition,
      wonAt,
    };
  });
}

function parseIntOrUndefined(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** GET /api/portal/insights/locked-keywords — won (top-3, status=locked). */
router.get("/insights/locked-keywords", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const aeoPlanId = parseIntOrUndefined(req.query.aeoPlanId);
    const businessId = parseIntOrUndefined(req.query.businessId);
    const enriched = await scanClientKeywords(clientId, {
      aeoPlanId,
      businessId,
    });
    const locked = enriched
      .filter((k) => k.status === "locked")
      .map((k) => ({
        id: k.id,
        keywordText: k.keywordText,
        campaignName: k.campaignName,
        businessName: k.businessName,
        aeoPlanId: k.aeoPlanId,
        businessId: k.businessId,
        replacementSuggestion: k.replacementSuggestion,
        archiveReason: k.archiveReason,
        wonPlatform: k.wonPlatform,
        wonPosition: k.wonPosition,
        wonAt: k.wonAt,
        stabilityPercent: k.stabilityPercent,
        platforms: k.platforms,
      }));
    res.json(locked);
  } catch (err) {
    req.log.error({ err }, "Portal locked-keywords error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/portal/insights/rotation-status — optimization transparency. */
router.get("/insights/rotation-status", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const aeoPlanId = parseIntOrUndefined(req.query.aeoPlanId);
    const businessId = parseIntOrUndefined(req.query.businessId);
    const enriched = await scanClientKeywords(clientId, {
      aeoPlanId,
      businessId,
    });

    const summary = {
      total: enriched.length,
      locked: enriched.filter((k) => k.status === "locked").length,
      active: enriched.filter(
        (k) => k.isActive && k.status !== "locked" && !k.archivedAt,
      ).length,
      atRisk: enriched.filter((k) => k.atRisk).length,
    };

    const platformAggregate: Record<
      string,
      { tracked: number; top3: number; avgPosition: number | null }
    > = {};
    for (const pk of PLATFORM_KEYS) {
      const positions = enriched
        .map((k) => k.platforms[pk]?.position)
        .filter((p): p is number => p != null);
      platformAggregate[pk] = {
        tracked: positions.length,
        top3: positions.filter((p) => p <= TOP3).length,
        avgPosition:
          positions.length > 0
            ? Math.round(
                (positions.reduce((a, b) => a + b, 0) / positions.length) * 10,
              ) / 10
            : null,
      };
    }

    const timeline: Array<Record<string, unknown>> = [];
    for (const k of enriched) {
      if (k.status === "locked" && k.wonAt) {
        timeline.push({
          type: "locked",
          keywordId: k.id,
          keywordText: k.keywordText,
          campaignName: k.campaignName,
          platform: k.wonPlatform,
          position: k.wonPosition,
          date: k.wonAt,
          detail: k.archiveReason,
        });
      }
      if (k.archivedAt) {
        timeline.push({
          type: "archived",
          keywordId: k.id,
          keywordText: k.keywordText,
          campaignName: k.campaignName,
          date: k.archivedAt,
          detail: k.archiveReason,
          replacement: k.replacementSuggestion,
        });
      }
    }
    timeline.sort((a, b) =>
      String(a.date) < String(b.date) ? 1 : String(a.date) > String(b.date) ? -1 : 0,
    );

    res.json({
      summary,
      platformAggregate,
      keywords: enriched,
      timeline: timeline.slice(0, 50),
    });
  } catch (err) {
    req.log.error({ err }, "Portal rotation-status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/portal/keywords/:id/variants — read-only AI variant alternates. */
router.get("/keywords/:id/variants", requirePortalAuth, async (req, res) => {
  try {
    const clientId = await requireLinkedClient(req, res);
    if (clientId == null) return;
    const rawId = req.params.id;
    const keywordId = Number.parseInt(typeof rawId === "string" ? rawId : "", 10);
    if (Number.isNaN(keywordId))
      return res.status(400).json({ error: "Invalid keyword id" });

    // Ownership check — 404 (don't leak existence) if not the client's keyword.
    const [keyword] = await db
      .select({ id: keywordsTable.id, clientId: keywordsTable.clientId })
      .from(keywordsTable)
      .where(eq(keywordsTable.id, keywordId));
    if (!keyword || keyword.clientId !== clientId)
      return res.status(404).json({ error: "Keyword not found" });

    const variants = await db
      .select()
      .from(keywordVariantsTable)
      .where(
        and(
          eq(keywordVariantsTable.keywordId, keywordId),
          eq(keywordVariantsTable.isActive, true),
        ),
      )
      .orderBy(desc(keywordVariantsTable.generatedAt));

    res.json({ variants, total: variants.length });
  } catch (err) {
    req.log.error({ err }, "Portal keyword variants error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
