import { Router } from "express";
import { db } from "@workspace/db";
import {
  auditLogsTable,
  clientsTable,
  businessesTable,
  clientAeoPlansTable,
  keywordsTable,
} from "@workspace/db/schema";
import { eq, and, desc, count, gte, lte } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";

const router = Router();

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
    if (from)       conditions.push(gte(auditLogsTable.timestamp, new Date(from)));
    if (to)         conditions.push(lte(auditLogsTable.timestamp, new Date(to)));

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
