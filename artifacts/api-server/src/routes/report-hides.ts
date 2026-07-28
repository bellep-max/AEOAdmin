/* Admin controls for hiding data from graphs/reports (admin pages + portal):
 * per-scope hidden audit dates and per-keyword hide flags. Hiding is display
 * only — tracking, imports and raw data stay untouched. */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  hiddenReportDatesTable,
  hiddenKeywordPlatformsTable,
  keywordsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/role-auth";
import { hiddenDateRowsForScope } from "../lib/report-hides";

const router = Router();

function intOrNull(v: unknown): number | null {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/* GET /api/report-hides?clientId=&businessId=&aeoPlanId=
   Everything hidden that APPLIES to this view (cascade-resolved), plus the
   hidden keywords in scope — the manage/unhide feed. */
router.get("/", requireAdmin, async (req, res) => {
  try {
    const clientId = intOrNull(req.query.clientId);
    const businessId = intOrNull(req.query.businessId);
    const aeoPlanId = intOrNull(req.query.aeoPlanId);
    if (clientId == null && businessId == null && aeoPlanId == null)
      return res
        .status(400)
        .json({ error: "clientId, businessId or aeoPlanId required" });

    const dates = await hiddenDateRowsForScope({
      clientId,
      businessId,
      aeoPlanId,
    });

    const hiddenKeywords = await db
      .select({
        id: keywordsTable.id,
        keywordText: keywordsTable.keywordText,
        businessId: keywordsTable.businessId,
        aeoPlanId: keywordsTable.aeoPlanId,
      })
      .from(keywordsTable)
      .where(
        and(
          eq(keywordsTable.hiddenFromReports, true),
          clientId != null ? eq(keywordsTable.clientId, clientId) : undefined,
          businessId != null
            ? eq(keywordsTable.businessId, businessId)
            : undefined,
          aeoPlanId != null
            ? eq(keywordsTable.aeoPlanId, aeoPlanId)
            : undefined,
        ),
      );

    const hiddenKeywordPlatforms = await db
      .select({
        id: hiddenKeywordPlatformsTable.id,
        keywordId: hiddenKeywordPlatformsTable.keywordId,
        platform: hiddenKeywordPlatformsTable.platform,
        keywordText: keywordsTable.keywordText,
      })
      .from(hiddenKeywordPlatformsTable)
      .innerJoin(
        keywordsTable,
        eq(hiddenKeywordPlatformsTable.keywordId, keywordsTable.id),
      )
      .where(
        and(
          clientId != null ? eq(keywordsTable.clientId, clientId) : undefined,
          businessId != null
            ? eq(keywordsTable.businessId, businessId)
            : undefined,
          aeoPlanId != null
            ? eq(keywordsTable.aeoPlanId, aeoPlanId)
            : undefined,
        ),
      );

    return res.json({ dates, hiddenKeywords, hiddenKeywordPlatforms });
  } catch (err) {
    req.log.error({ err }, "Error listing report hides");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/report-hides/keyword-platforms
   { keywordId, platform, hidden: boolean } — hide/unhide ONE platform's data
   for a keyword; the other platforms stay visible. */
router.post("/keyword-platforms", requireAdmin, async (req, res) => {
  try {
    const body = req.body ?? {};
    const keywordId = intOrNull(body.keywordId);
    const platform =
      typeof body.platform === "string"
        ? body.platform.trim().toLowerCase()
        : "";
    const hidden = Boolean(body.hidden);
    if (
      keywordId == null ||
      !["chatgpt", "gemini", "perplexity"].includes(platform)
    )
      return res
        .status(400)
        .json({ error: "keywordId and a valid platform required" });

    if (hidden) {
      const [row] = await db
        .insert(hiddenKeywordPlatformsTable)
        .values({ keywordId, platform })
        .onConflictDoNothing()
        .returning();
      return res.status(201).json(row ?? { alreadyHidden: true });
    }
    await db
      .delete(hiddenKeywordPlatformsTable)
      .where(
        and(
          eq(hiddenKeywordPlatformsTable.keywordId, keywordId),
          eq(hiddenKeywordPlatformsTable.platform, platform),
        ),
      );
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error toggling keyword-platform hide");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/report-hides/dates  { clientId, businessId?, aeoPlanId?, date } */
router.post("/dates", requireAdmin, async (req, res) => {
  try {
    const body = req.body ?? {};
    const clientId = intOrNull(body.clientId);
    const businessId = intOrNull(body.businessId);
    const aeoPlanId = intOrNull(body.aeoPlanId);
    const date = typeof body.date === "string" ? body.date.trim() : "";
    if (clientId == null || !YMD_RE.test(date))
      return res
        .status(400)
        .json({ error: "clientId and date (YYYY-MM-DD) required" });

    const [row] = await db
      .insert(hiddenReportDatesTable)
      .values({ clientId, businessId, aeoPlanId, date })
      .onConflictDoNothing()
      .returning();
    return res.status(201).json(row ?? { alreadyHidden: true });
  } catch (err) {
    req.log.error({ err }, "Error hiding report date");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* DELETE /api/report-hides/dates/:id — unhide. */
router.delete("/dates/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });
    const deleted = await db
      .delete(hiddenReportDatesTable)
      .where(eq(hiddenReportDatesTable.id, id))
      .returning({ id: hiddenReportDatesTable.id });
    if (deleted.length === 0)
      return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error unhiding report date");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/report-hides/keywords/:id  { hidden: boolean } */
router.post("/keywords/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    const hidden = Boolean(req.body?.hidden);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });
    const [row] = await db
      .update(keywordsTable)
      .set({ hiddenFromReports: hidden })
      .where(eq(keywordsTable.id, id))
      .returning({
        id: keywordsTable.id,
        keywordText: keywordsTable.keywordText,
        hiddenFromReports: keywordsTable.hiddenFromReports,
      });
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json(row);
  } catch (err) {
    req.log.error({ err }, "Error toggling keyword hide");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
