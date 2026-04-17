import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, clientsTable, keywordsTable, devicesTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

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

    res.json(logs);
  } catch (err) {
    req.log.error({ err }, "Error fetching audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body;
    const [log] = await db
      .insert(auditLogsTable)
      .values({
        clientId: body.clientId ?? null,
        keywordId: body.keywordId ?? null,
        deviceId: body.deviceId ?? null,
        platform: body.platform ?? null,
        screenshotPath: body.screenshotPath ?? null,
        responseText: body.responseText ?? null,
        proxyUsername: body.proxyUsername ?? null,
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
