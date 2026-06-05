import { Router } from "express";
import { db } from "@workspace/db";
import { keywordsTable, keywordLinksTable, keywordVariantsTable, clientAeoPlansTable, clientsTable, businessesTable, sessionsTable, auditLogsTable } from "@workspace/db/schema";
import { eq, and, inArray, sql, desc, isNull } from "drizzle-orm";
import { generateVariants } from "../services/variant-generator";
import { rotateWinners } from "../services/keyword-rotation";

const router = Router();

/* ────────────────────────────────────────────────────────────
   GET /api/keywords
   Returns all AEO keywords, optionally filtered by clientId
──────────────────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    const { clientId, businessId, aeoPlanId, includeArchived } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId)   conditions.push(eq(keywordsTable.clientId,   parseInt(clientId)));
    if (businessId) conditions.push(eq(keywordsTable.businessId, parseInt(businessId)));
    if (aeoPlanId)  conditions.push(eq(keywordsTable.aeoPlanId,  parseInt(aeoPlanId)));
    // By default exclude archived; pass includeArchived=true to see them
    if (includeArchived !== "true") conditions.push(isNull(keywordsTable.archivedAt));
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
        archivedAt: keywordsTable.archivedAt,
        archiveReason: keywordsTable.archiveReason,
        replacementSuggestion: keywordsTable.replacementSuggestion,
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
      .leftJoin(clientAeoPlansTable, eq(keywordsTable.aeoPlanId, clientAeoPlansTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const ids = keywords.map((k) => k.id);
    const linksByKeyword = new Map<number, typeof keywordLinksTable.$inferSelect[]>();
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

    res.json(keywords.map((k) => ({
      ...k,
      clientName:   k.joinedClientName   ?? null,
      businessName: k.joinedBusinessName ?? null,
      campaignName: k.joinedCampaignName ?? null,
      lastRunAt:    k.lastRunAt ?? null,
      links: linksByKeyword.get(k.id) ?? [],
    })));
  } catch (err) {
    req.log.error({ err }, "Error fetching keywords");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/keywords/:id
   Returns a single keyword with its links inline
──────────────────────────────────────────────────────────── */
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [row] = await db
      .select({
        kw:           keywordsTable,
        clientName:   clientsTable.businessName,
        businessName: businessesTable.name,
        campaignName: clientAeoPlansTable.name,
      })
      .from(keywordsTable)
      .leftJoin(clientsTable,        eq(keywordsTable.clientId,   clientsTable.id))
      .leftJoin(businessesTable,     eq(keywordsTable.businessId, businessesTable.id))
      .leftJoin(clientAeoPlansTable, eq(keywordsTable.aeoPlanId,  clientAeoPlansTable.id))
      .where(eq(keywordsTable.id, id));
    if (!row) return res.status(404).json({ error: "Not found" });
    const links = await db
      .select()
      .from(keywordLinksTable)
      .where(eq(keywordLinksTable.keywordId, id))
      .orderBy(keywordLinksTable.createdAt);
    res.json({
      ...row.kw,
      clientName:   row.clientName   ?? null,
      businessName: row.businessName ?? null,
      campaignName: row.campaignName ?? null,
      links,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords
   Create a new keyword for a business
──────────────────────────────────────────────────────────── */
router.post("/", async (req, res) => {
  try {
    const body = req.body;
    if (!body.keywordText?.trim()) {
      return res.status(400).json({ error: "keywordText is required" });
    }
    if (body.aeoPlanId == null) {
      return res.status(400).json({ error: "aeoPlanId (campaign) is required — keywords must belong to a campaign" });
    }

    const [plan] = await db
      .select()
      .from(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.id, Number(body.aeoPlanId)));
    if (!plan) return res.status(400).json({ error: "aeoPlanId does not reference an existing campaign" });

    if (body.clientId != null && Number(body.clientId) !== plan.clientId) {
      return res.status(400).json({ error: "clientId does not match the campaign's client" });
    }
    if (body.businessId != null && plan.businessId != null && Number(body.businessId) !== plan.businessId) {
      return res.status(400).json({ error: "businessId does not match the campaign's business" });
    }

    const [keyword] = await db
      .insert(keywordsTable)
      .values({
        clientId: plan.clientId,
        businessId: plan.businessId,
        aeoPlanId: plan.id,
        keywordText: body.keywordText.trim(),
        keywordType: body.keywordType ? Number(body.keywordType) : 3,
        isActive:   body.isActive !== false,
        isPrimary:  body.isPrimary ? Number(body.isPrimary) : 0,
        verificationStatus: body.verificationStatus ?? null,
        initialSearchCount30Days:  body.initialSearchCount30Days  ?? null,
        followupSearchCount30Days: body.followupSearchCount30Days ?? null,
        initialSearchCountLife:    body.initialSearchCountLife    ?? null,
        followupSearchCountLife:   body.followupSearchCountLife   ?? null,
        backlinkClickCount30Days:  body.backlinkClickCount30Days  ?? null,
        backlinkClickCountLife:    body.backlinkClickCountLife    ?? null,
        initialRankReportCount:    body.initialRankReportCount    ?? null,
        currentRankReportCount:    body.currentRankReportCount    ?? null,
        linkTypeLabel:         body.linkTypeLabel         ?? null,
        linkActive:            body.linkActive !== false,
        initialRankReportLink: body.initialRankReportLink ?? null,
        currentRankReportLink: body.currentRankReportLink ?? null,
      })
      .returning();
    res.status(201).json(keyword);
  } catch (err) {
    req.log.error({ err }, "Error creating keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/keywords/:id/links
   Returns all associated links for a keyword
──────────────────────────────────────────────────────────── */
router.get("/:id/links", async (req, res) => {
  try {
    const keywordId = parseInt(req.params.id);
    const links = await db
      .select()
      .from(keywordLinksTable)
      .where(eq(keywordLinksTable.keywordId, keywordId))
      .orderBy(keywordLinksTable.createdAt);
    res.json(links);
  } catch (err) {
    req.log.error({ err }, "Error fetching keyword links");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords/:id/links
   Add a new associated link to a keyword
──────────────────────────────────────────────────────────── */
router.post("/:id/links", async (req, res) => {
  try {
    const keywordId = parseInt(req.params.id);
    const body      = req.body;
    const [link] = await db
      .insert(keywordLinksTable)
      .values({
        keywordId,
        linkUrl:               body.linkUrl               ?? null,
        linkTypeLabel:         body.linkTypeLabel         ?? null,
        embeddedUrl:            body.embeddedUrl            ?? null,
        linkActive:            body.linkActive !== false,
        initialRankReportLink: body.initialRankReportLink ?? null,
        currentRankReportLink: body.currentRankReportLink ?? null,
      })
      .returning();
    // Ensure keyword is marked as type 4 (Keywords with Backlinks)
    await db.update(keywordsTable)
      .set({ keywordType: 4 })
      .where(eq(keywordsTable.id, keywordId));
    res.status(201).json(link);
  } catch (err) {
    req.log.error({ err }, "Error creating keyword link");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   PATCH /api/keywords/:id/links/:linkId
   Update an associated link
──────────────────────────────────────────────────────────── */
router.patch("/:id/links/:linkId", async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const body   = req.body as Record<string, unknown>;
    const allowed: Record<string, unknown> = {};
    if (body.linkUrl                !== undefined) allowed.linkUrl                = body.linkUrl ?? null;
    if (body.linkTypeLabel         !== undefined) allowed.linkTypeLabel         = body.linkTypeLabel ?? null;
    if (body.embeddedUrl           !== undefined) allowed.embeddedUrl           = body.embeddedUrl ?? null;
    if (body.linkActive            !== undefined) allowed.linkActive            = Boolean(body.linkActive);
    if (body.initialRankReportLink !== undefined) allowed.initialRankReportLink = body.initialRankReportLink ?? null;
    if (body.currentRankReportLink !== undefined) allowed.currentRankReportLink = body.currentRankReportLink ?? null;
    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    const [link] = await db
      .update(keywordLinksTable)
      .set(allowed)
      .where(eq(keywordLinksTable.id, linkId))
      .returning();
    if (!link) return res.status(404).json({ error: "Not found" });
    res.json(link);
  } catch (err) {
    req.log.error({ err }, "Error updating keyword link");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   DELETE /api/keywords/:id/links/:linkId
   Remove an associated link from a keyword
──────────────────────────────────────────────────────────── */
router.delete("/:id/links/:linkId", async (req, res) => {
  try {
    const keywordId = parseInt(req.params.id);
    const linkId    = parseInt(req.params.linkId);
    await db.delete(keywordLinksTable).where(eq(keywordLinksTable.id, linkId));
    // If no links remain, revert keyword to type 3 (Keywords)
    const remaining = await db.select().from(keywordLinksTable)
      .where(eq(keywordLinksTable.keywordId, keywordId));
    if (remaining.length === 0) {
      await db.update(keywordsTable)
        .set({ keywordType: 3 })
        .where(eq(keywordsTable.id, keywordId));
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting keyword link");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   PATCH /api/keywords/:id
   Update keyword fields
──────────────────────────────────────────────────────────── */
router.patch("/:id", async (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const body = req.body as Record<string, unknown>;

    const allowed: Record<string, unknown> = {};
    if (body.keywordText      !== undefined) allowed.keywordText      = String(body.keywordText).trim();
    if (body.keywordType      !== undefined) allowed.keywordType      = Number(body.keywordType);
    if (body.isActive         !== undefined) allowed.isActive         = Boolean(body.isActive);
    if (body.isPrimary        !== undefined) allowed.isPrimary        = Number(body.isPrimary);
    if (body.aeoPlanId        !== undefined) allowed.aeoPlanId        = body.aeoPlanId === null ? null : Number(body.aeoPlanId);
    if (body.businessId       !== undefined) allowed.businessId       = body.businessId === null ? null : Number(body.businessId);
    if (body.clientId         !== undefined) allowed.clientId         = Number(body.clientId);
    if (body.verificationStatus !== undefined) allowed.verificationStatus = body.verificationStatus === null ? null : String(body.verificationStatus);
    if (body.status            !== undefined) allowed.status            = body.status === null ? null : String(body.status);
    // Archive/lock fields — needed to unlock/restore a keyword back into rotation.
    if (body.archivedAt        !== undefined) allowed.archivedAt        = body.archivedAt === null ? null : new Date(body.archivedAt as string);
    if (body.archiveReason     !== undefined) allowed.archiveReason     = body.archiveReason === null ? null : String(body.archiveReason);
    if (body.replacementSuggestion !== undefined) allowed.replacementSuggestion = body.replacementSuggestion === null ? null : String(body.replacementSuggestion);
    if (body.notes             !== undefined) allowed.notes             = body.notes === null ? null : String(body.notes);
    if (body.implementedBy     !== undefined) allowed.implementedBy     = body.implementedBy === null ? null : String(body.implementedBy);
    if (body.linkTypeLabel    !== undefined) allowed.linkTypeLabel    = body.linkTypeLabel === null ? null : String(body.linkTypeLabel);
    if (body.linkActive       !== undefined) allowed.linkActive       = Boolean(body.linkActive);
    if (body.initialRankReportLink  !== undefined) allowed.initialRankReportLink  = body.initialRankReportLink  === null ? null : String(body.initialRankReportLink);
    if (body.currentRankReportLink  !== undefined) allowed.currentRankReportLink  = body.currentRankReportLink  === null ? null : String(body.currentRankReportLink);
    if (body.initialSearchCount30Days  !== undefined) allowed.initialSearchCount30Days  = body.initialSearchCount30Days === null ? null : Number(body.initialSearchCount30Days);
    if (body.followupSearchCount30Days !== undefined) allowed.followupSearchCount30Days = body.followupSearchCount30Days === null ? null : Number(body.followupSearchCount30Days);
    if (body.initialSearchCountLife    !== undefined) allowed.initialSearchCountLife    = body.initialSearchCountLife === null ? null : Number(body.initialSearchCountLife);
    if (body.followupSearchCountLife   !== undefined) allowed.followupSearchCountLife   = body.followupSearchCountLife === null ? null : Number(body.followupSearchCountLife);
    if (body.backlinkClickCount30Days  !== undefined) allowed.backlinkClickCount30Days  = body.backlinkClickCount30Days === null ? null : Number(body.backlinkClickCount30Days);
    if (body.backlinkClickCountLife    !== undefined) allowed.backlinkClickCountLife    = body.backlinkClickCountLife === null ? null : Number(body.backlinkClickCountLife);
    if (body.initialRankReportCount    !== undefined) allowed.initialRankReportCount    = body.initialRankReportCount === null ? null : Number(body.initialRankReportCount);
    if (body.currentRankReportCount    !== undefined) allowed.currentRankReportCount    = body.currentRankReportCount === null ? null : Number(body.currentRankReportCount);

    if (body.dateAdded !== undefined && body.dateAdded !== null) {
      const d = new Date(body.dateAdded as string);
      if (!isNaN(d.getTime())) allowed.dateAdded = d;
    }

    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const [keyword] = await db
      .update(keywordsTable)
      .set(allowed)
      .where(eq(keywordsTable.id, id))
      .returning();

    if (!keyword) return res.status(404).json({ error: "Not found" });
    res.json(keyword);
  } catch (err) {
    req.log.error({ err }, "Error updating keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   DELETE /api/keywords/:id
   Soft-archive the keyword (sets isActive=false + archivedAt).
   Mirrors the clients soft-delete behavior so archived keywords
   show up on /keyword-rotation/archived and can be restored.
──────────────────────────────────────────────────────────── */
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    await db
      .update(keywordsTable)
      .set({
        isActive: false,
        archivedAt: new Date(),
        archiveReason: "Archived from keyword list",
      })
      .where(and(eq(keywordsTable.id, id), isNull(keywordsTable.archivedAt)));

    // 204 whether or not a row was updated — idempotent from the FE's perspective.
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error archiving keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords/:id/archive
   Soft-archive a keyword (sets isActive=false + records reason)
   Body: { reason?: string }
──────────────────────────────────────────────────────────── */
router.post("/:id/archive", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const reason = (req.body as { reason?: string })?.reason ?? "Manually archived via rotation dashboard";

    const [kw] = await db
      .update(keywordsTable)
      .set({ isActive: false, archivedAt: new Date(), archiveReason: reason })
      .where(eq(keywordsTable.id, id))
      .returning();

    if (!kw) return res.status(404).json({ error: "Keyword not found" });
    res.json({ success: true, keyword: kw });
  } catch (err) {
    req.log.error({ err }, "Error archiving keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords/:id/generate-replacement
   Archive this keyword + use AI to generate a replacement keyword
   and optionally create it in the DB.
   Body: { createKeyword?: boolean, reason?: string }
──────────────────────────────────────────────────────────── */
router.post("/:id/generate-replacement", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const body = (req.body ?? {}) as { createKeyword?: boolean; reason?: string };
    const reason = body.reason ?? "No ranking improvement after 5 runs — auto-replaced";

    // Load keyword + business context
    const [row] = await db
      .select({
        kw:           keywordsTable,
        businessName: businessesTable.name,
        city:         businessesTable.city,
        state:        businessesTable.state,
      })
      .from(keywordsTable)
      .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
      .where(eq(keywordsTable.id, id));

    if (!row) return res.status(404).json({ error: "Keyword not found" });

    // Generate AI variant suggestions (reuse existing variant generator)
    const suggestions = await generateVariants({
      keyword:      row.kw.keywordText,
      businessName: row.businessName ?? undefined,
      city:         row.city ?? undefined,
      state:        row.state ?? undefined,
      count:        5,
    });

    // generateVariants returns { variants: string[], ... }
    const variantList = suggestions.variants;
    const replacement = variantList[0] ?? `best ${row.kw.keywordText}`;

    // Archive original keyword
    await db
      .update(keywordsTable)
      .set({ isActive: false, archivedAt: new Date(), archiveReason: reason, replacementSuggestion: replacement })
      .where(eq(keywordsTable.id, id));

    // Optionally auto-create the replacement keyword
    let newKeyword = null;
    if (body.createKeyword) {
      [newKeyword] = await db
        .insert(keywordsTable)
        .values({
          clientId:    row.kw.clientId,
          businessId:  row.kw.businessId,
          aeoPlanId:   row.kw.aeoPlanId,
          keywordText: replacement,
          keywordType: row.kw.keywordType,
          isActive:    true,
          status:      "new",
          notes:       `Auto-generated as replacement for "${row.kw.keywordText}"`,
        })
        .returning();
    }

    res.json({
      archived:       true,
      replacement,
      allSuggestions: variantList,
      newKeyword,
    });
  } catch (err) {
    req.log.error({ err }, "Error generating replacement keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/keywords/:id/variants
   List variants for a keyword (active only by default)
──────────────────────────────────────────────────────────── */
router.get("/:id/variants", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const includeInactive = req.query.includeInactive === "true";

    const rows = await db
      .select()
      .from(keywordVariantsTable)
      .where(
        includeInactive
          ? eq(keywordVariantsTable.keywordId, id)
          : and(eq(keywordVariantsTable.keywordId, id), eq(keywordVariantsTable.isActive, true)),
      )
      .orderBy(desc(keywordVariantsTable.generatedAt));

    res.json({ variants: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Error fetching variants");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords/:id/variants/generate
   Generate fresh AI variants for a Top-1/3 keyword and store them.
   Body: { count?: number }
──────────────────────────────────────────────────────────── */
router.post("/:id/variants/generate", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const count = Math.min(Number((req.body as { count?: number })?.count ?? 5), 20);

    const [row] = await db
      .select({ kw: keywordsTable, businessName: businessesTable.name, city: businessesTable.city, state: businessesTable.state })
      .from(keywordsTable)
      .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
      .where(eq(keywordsTable.id, id));

    if (!row) return res.status(404).json({ error: "Keyword not found" });

    const genResult = await generateVariants({
      keyword:      row.kw.keywordText,
      businessName: row.businessName ?? undefined,
      city:         row.city ?? undefined,
      state:        row.state ?? undefined,
      count,
    });

    // Deactivate old variants, insert new batch
    await db
      .update(keywordVariantsTable)
      .set({ isActive: false })
      .where(eq(keywordVariantsTable.keywordId, id));

    const inserted = await db
      .insert(keywordVariantsTable)
      .values(
        genResult.variants.map((v) => ({
          keywordId:   id,
          variantText: v,
          isActive:    true,
          sourceModel: "deepseek-chat",
          weekOf:      new Date().toISOString().slice(0, 10),
        })),
      )
      .returning();

    res.json({ variants: inserted, total: inserted.length });
  } catch (err) {
    req.log.error({ err }, "Error generating variants");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/keywords/rotate-winners
   Auto-lock-on-win: scan active keywords (optionally one client),
   archive any that hold top-3 on any platform (current rank), and
   rotate in an AI-generated replacement. Pass {dryRun:true} to preview.
   Body: { clientId?, businessId?, aeoPlanId?, dryRun? } — businessId/aeoPlanId
   scope rotation to a single campaign.
──────────────────────────────────────────────────────────── */
router.post("/rotate-winners", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { clientId?: number; businessId?: number; aeoPlanId?: number; keywordIds?: unknown; dryRun?: boolean };
    const clientId = body.clientId != null ? Number(body.clientId) : undefined;
    const businessId = body.businessId != null ? Number(body.businessId) : undefined;
    const aeoPlanId = body.aeoPlanId != null ? Number(body.aeoPlanId) : undefined;
    for (const [name, val] of [["clientId", clientId], ["businessId", businessId], ["aeoPlanId", aeoPlanId]] as const) {
      if (val != null && Number.isNaN(val)) {
        return res.status(400).json({ error: `${name} must be a number` });
      }
    }
    let keywordIds: number[] | undefined;
    if (body.keywordIds != null) {
      if (!Array.isArray(body.keywordIds)) {
        return res.status(400).json({ error: "keywordIds must be an array" });
      }
      keywordIds = body.keywordIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
    const result = await rotateWinners({ clientId, businessId, aeoPlanId, keywordIds, dryRun: body.dryRun === true });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error rotating winning keywords");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
