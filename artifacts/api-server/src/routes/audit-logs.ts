import { Router } from "express";
import { db } from "@workspace/db";
import {
  auditLogsTable,
  clientsTable,
  businessesTable,
  clientAeoPlansTable,
  keywordsTable,
} from "@workspace/db/schema";
import { eq, and, desc, count, gte, lte, sql } from "drizzle-orm";
import { rankingReportsTable } from "@workspace/db/schema";
import { requireExecutorToken } from "../middlewares/executor-auth";

const router = Router();

function parseFilterDate(raw: string, kind: "start" | "end"): Date {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  if (!isDateOnly) return new Date(raw);
  const [y, m, d] = raw.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", hour12: false,
  }).formatToParts(noon);
  const etHour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
  const offsetHours = 12 - (etHour === 24 ? 0 : etHour);
  const startUtc = Date.UTC(y, m - 1, d, offsetHours);
  if (kind === "start") return new Date(startUtc);
  return new Date(startUtc + 24 * 60 * 60 * 1000);
}

/* ────────────────────────────────────────────────────────────
   GET /api/audit-logs
──────────────────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    const {
      clientId,
      businessId,
      campaignId,
      keywordId,
      platform,
      mode,
      status,
      from,
      to,
      limit = "50",
      offset = "0",
    } = req.query as Record<string, string>;

    const conditions = [] as ReturnType<typeof eq>[];
    if (clientId)   conditions.push(eq(auditLogsTable.clientId,   parseInt(clientId)));
    if (businessId) conditions.push(eq(auditLogsTable.businessId, parseInt(businessId)));
    if (campaignId) conditions.push(eq(auditLogsTable.campaignId, parseInt(campaignId)));
    if (keywordId)  conditions.push(eq(auditLogsTable.keywordId,  parseInt(keywordId)));
    if (platform)   conditions.push(eq(auditLogsTable.platform,   platform));
    if (mode)       conditions.push(eq(auditLogsTable.mode,       mode));
    if (status)     conditions.push(eq(auditLogsTable.status,     status));
    if (from)       conditions.push(gte(auditLogsTable.timestamp, parseFilterDate(from, "start")));
    if (to)         conditions.push(lte(auditLogsTable.timestamp, parseFilterDate(to,   "end")));

    const lim = Math.min(parseInt(limit), 200);
    const off = parseInt(offset);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: count() })
      .from(auditLogsTable)
      .where(where);

    const logs = await db
      .select({
        id:              auditLogsTable.id,
        clientId:        auditLogsTable.clientId,
        businessId:      auditLogsTable.businessId,
        campaignId:      auditLogsTable.campaignId,
        keywordId:       auditLogsTable.keywordId,
        deviceId:        auditLogsTable.deviceId,
        bizName:         auditLogsTable.bizName,
        campaignName:    auditLogsTable.campaignName,
        keywordText:     auditLogsTable.keywordText,
        timestamp:       auditLogsTable.timestamp,
        createdAt:       auditLogsTable.createdAt,
        platform:        auditLogsTable.platform,
        mode:            auditLogsTable.mode,
        device:          auditLogsTable.device,
        status:          auditLogsTable.status,
        durationSeconds: auditLogsTable.durationSeconds,
        rankPosition:    auditLogsTable.rankPosition,
        rankTotal:       auditLogsTable.rankTotal,
        mentioned:       auditLogsTable.mentioned,
        rankContext:     auditLogsTable.rankContext,
        screenshotPath:  auditLogsTable.screenshotPath,
        responseText:    auditLogsTable.responseText,
        prompt:          auditLogsTable.prompt,
        error:           auditLogsTable.error,
        proxyUsername:   auditLogsTable.proxyUsername,
        proxyIp:         auditLogsTable.proxyIp,
        proxyCity:       auditLogsTable.proxyCity,
        proxyRegion:     auditLogsTable.proxyRegion,
        proxyZip:        auditLogsTable.proxyZip,
        /* joins for denormalized fallback */
        joinedClientName:    clientsTable.businessName,
        joinedBusinessName:  businessesTable.name,
        joinedCampaignName:  clientAeoPlansTable.name,
        joinedKeywordText:   keywordsTable.keywordText,
      })
      .from(auditLogsTable)
      .leftJoin(clientsTable,        eq(auditLogsTable.clientId,   clientsTable.id))
      .leftJoin(businessesTable,     eq(auditLogsTable.businessId, businessesTable.id))
      .leftJoin(clientAeoPlansTable, eq(auditLogsTable.campaignId, clientAeoPlansTable.id))
      .leftJoin(keywordsTable,       eq(auditLogsTable.keywordId,  keywordsTable.id))
      .where(where)
      .orderBy(desc(auditLogsTable.timestamp))
      .limit(lim)
      .offset(off);

    res.json({
      logs: logs.map((l) => ({
        ...l,
        clientName:   l.joinedClientName ?? null,
        bizName:      l.bizName      ?? l.joinedBusinessName ?? null,
        campaignName: l.campaignName ?? l.joinedCampaignName ?? null,
        keywordText:  l.keywordText  ?? l.joinedKeywordText  ?? null,
      })),
      total:  Number(totalResult.count),
      offset: off,
      limit:  lim,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/audit-logs
──────────────────────────────────────────────────────────── */
router.post("/", requireExecutorToken, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const [log] = await db
      .insert(auditLogsTable)
      .values({
        clientId:        body.clientId   != null ? Number(body.clientId)   : null,
        businessId:      body.businessId != null ? Number(body.businessId) : null,
        campaignId:      body.campaignId != null ? Number(body.campaignId) : null,
        keywordId:       body.keywordId  != null ? Number(body.keywordId)  : null,
        deviceId:        body.deviceId   != null ? Number(body.deviceId)   : null,
        bizName:         (body.bizName        as string | null | undefined) ?? null,
        campaignName:    (body.campaignName   as string | null | undefined) ?? null,
        keywordText:     (body.keywordText ?? body.keyword) as string | null ?? null,
        platform:        (body.platform       as string | null | undefined) ?? null,
        mode:            (body.mode           as string | null | undefined) ?? null,
        device:          (body.device         as string | null | undefined) ?? null,
        status:          (body.status         as string | null | undefined) ?? null,
        durationSeconds: body.durationSeconds != null ? Number(body.durationSeconds) : null,
        rankPosition:    body.rankPosition    != null ? Number(body.rankPosition)    : null,
        rankTotal:       body.rankTotal       != null ? Number(body.rankTotal)       : null,
        mentioned:       (body.mentioned      as string | null | undefined) ?? null,
        rankContext:     (body.rankContext    as string | null | undefined) ?? null,
        screenshotPath:  (body.screenshotPath ?? body.screenshot) as string | null ?? null,
        responseText:    (body.responseText   as string | null | undefined) ?? null,
        prompt:          (body.prompt         as string | null | undefined) ?? null,
        error:           (body.error          as string | null | undefined) ?? null,
        proxyUsername:   (body.proxyUsername  as string | null | undefined) ?? null,
        proxyIp:         (body.proxyIp        as string | null | undefined) ?? null,
        proxyCity:       (body.proxyCity      as string | null | undefined) ?? null,
        proxyRegion:     (body.proxyRegion    as string | null | undefined) ?? null,
        proxyZip:        (body.proxyZip       as string | null | undefined) ?? null,
      })
      .returning();
    res.status(201).json(log);
  } catch (err) {
    req.log.error({ err }, "Error creating audit log");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/audit-logs/sync
   Backfills audit_logs from ranking_reports for rows that
   don't have a matching audit_log entry yet.
──────────────────────────────────────────────────────────── */
router.post("/sync", async (req, res) => {
  try {
    const { from, to, dryRun } = req.query as Record<string, string>;
    const isDryRun = dryRun === "true" || dryRun === "1";

    const result = await db.execute(sql`
      WITH to_insert AS (
        SELECT
          k.client_id                                    AS client_id,
          k.business_id                                  AS business_id,
          k.aeo_plan_id                                  AS campaign_id,
          rr.keyword_id                                  AS keyword_id,
          rr.platform                                    AS platform,
          'success'                                      AS status,
          rr.ranking_position                            AS rank_position,
          NULL::integer                                  AS rank_total,
          rr.created_at                                  AS "timestamp",
          k.keyword_text                                 AS keyword_text,
          b.name                                         AS biz_name,
          COALESCE(p.name, p.plan_type)                  AS campaign_name
        FROM ranking_reports rr
        JOIN keywords k        ON rr.keyword_id = k.id
        LEFT JOIN businesses b ON k.business_id = b.id
        LEFT JOIN client_aeo_plans p ON k.aeo_plan_id = p.id
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_logs al
          WHERE al.keyword_id = rr.keyword_id
            AND al.platform   = rr.platform
            AND al."timestamp"::date = rr.created_at::date
        )
        ${from ? sql`AND rr.created_at >= ${new Date(from as string)}` : sql``}
        ${to   ? sql`AND rr.created_at <  ${new Date(to as string)}` : sql``}
      )
      ${isDryRun
        ? sql`SELECT count(*)::int AS inserted FROM to_insert`
        : sql`
          INSERT INTO audit_logs
            (client_id, business_id, campaign_id, keyword_id, platform, status,
             rank_position, rank_total, "timestamp",
             keyword_text, biz_name, campaign_name)
          SELECT * FROM to_insert
          RETURNING id
        `}
    `);

    const count_ = isDryRun
      ? (result.rows[0] as Record<string, unknown>).inserted ?? 0
      : result.rowCount ?? 0;

    res.json({ synced: Number(count_), dryRun: isDryRun });
  } catch (err) {
    req.log.error({ err }, "Error syncing audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [deleted] = await db
      .delete(auditLogsTable)
      .where(eq(auditLogsTable.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, deleted });
  } catch (err) {
    req.log.error({ err }, "Error deleting audit log");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
