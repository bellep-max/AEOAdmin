import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, insertAuditLogSchema, clientsTable, keywordsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { ok, created, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { clientId, keywordId, platform } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (clientId) conditions.push(eq(auditLogsTable.clientId, parseInt(clientId)));
    if (keywordId) conditions.push(eq(auditLogsTable.keywordId, parseInt(keywordId)));
    if (platform) conditions.push(eq(auditLogsTable.platform, platform));

    const logs = await db
      .select({
        id: auditLogsTable.id,
        clientId: auditLogsTable.clientId,
        keywordId: auditLogsTable.keywordId,
        deviceId: auditLogsTable.deviceId,
        platform: auditLogsTable.platform,
        screenshotPath: auditLogsTable.screenshotPath,
        responseText: auditLogsTable.responseText,
        proxyUsername: auditLogsTable.proxyUsername,
        createdAt: auditLogsTable.createdAt,
        clientName: clientsTable.businessName,
        keywordText: keywordsTable.keywordText,
      })
      .from(auditLogsTable)
      .leftJoin(clientsTable, eq(auditLogsTable.clientId, clientsTable.id))
      .leftJoin(keywordsTable, eq(auditLogsTable.keywordId, keywordsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogsTable.createdAt));

    ok(res, logs);
  } catch (err) {
    req.log.error({ err }, "Error fetching audit logs");
    serverError(res);
  }
});

router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertAuditLogSchema);
    if (!data) return;

    const [log] = await db
      .insert(auditLogsTable)
      .values(data)
      .returning();
    created(res, log);
  } catch (err) {
    req.log.error({ err }, "Error creating audit log");
    serverError(res);
  }
});

export default router;
