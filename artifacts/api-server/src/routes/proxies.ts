/**
 * @file proxies.ts
 * @route /api/proxies
 *
 * Manages the Decodo mobile/residential proxy pool used to rotate IP addresses
 * during AEO sessions. Each proxy can be assigned to one device at a time.
 * Credentials are stored in plain text for automated session injection.
 *
 * Schema: proxiesTable (id, label, proxyUrl, proxyType, host, port,
 *          username, password, deviceId, sessionCount, lastUsed)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { proxiesTable, devicesTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

const router = Router();

/**
 * GET /api/proxies
 * Returns the full proxy pool, left-joined with the assigned device so the
 * dashboard can show deviceIdentifier and deviceModel alongside each proxy
 * without a second round-trip.
 */
router.get("/", async (req, res) => {
  try {
    const proxies = await db
      .select({
        id:           proxiesTable.id,
        label:        proxiesTable.label,
        proxyUrl:     proxiesTable.proxyUrl,
        proxyType:    proxiesTable.proxyType,
        host:         proxiesTable.host,
        port:         proxiesTable.port,
        username:     proxiesTable.username,
        password:     proxiesTable.password,
        deviceId:     proxiesTable.deviceId,
        sessionCount: proxiesTable.sessionCount,
        lastUsed:     proxiesTable.lastUsed,
        // Device info joined from devicesTable (null when unassigned)
        deviceIdentifier: devicesTable.deviceIdentifier,
        deviceModel:      devicesTable.model,
      })
      .from(proxiesTable)
      .leftJoin(devicesTable, eq(proxiesTable.deviceId, devicesTable.id));

    res.json(proxies);
  } catch (err) {
    req.log.error({ err }, "Error fetching proxies");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/proxies
 * Creates a new proxy entry. If no proxyUrl is supplied directly, one is
 * constructed from host/port/username/password in the Decodo HTTP format:
 *   http://username:password@host:port
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body;

    // Auto-build proxyUrl from individual credential fields when not provided
    const proxyUrl = body.proxyUrl
      ?? (body.host && body.port
          ? `http://${body.username ?? ""}:${body.password ?? ""}@${body.host}:${body.port}`
          : null);

    const [proxy] = await db
      .insert(proxiesTable)
      .values({
        label:     body.label     ?? null,
        proxyUrl:  proxyUrl,
        proxyType: body.proxyType ?? "mobile",    // "mobile" | "residential"
        host:      body.host      ?? null,
        port:      body.port      ? Number(body.port) : null,
        username:  body.username  ?? null,
        password:  body.password  ?? null,
        deviceId:  body.deviceId  ? Number(body.deviceId) : null,
      })
      .returning();

    res.status(201).json(proxy);
  } catch (err) {
    req.log.error({ err }, "Error creating proxy");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/proxies/:id
 * Partial update for a proxy. Only the fields present in the request body
 * are changed. When host/port/username/password fields are updated, the
 * proxyUrl string is automatically rebuilt so both fields stay in sync.
 * Passing deviceId = null unassigns the proxy from its current device.
 */
router.patch("/:id", async (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const body = req.body;

    // Build the partial update object — only include keys that were sent
    const updates: Record<string, unknown> = {};
    if (body.label     !== undefined) updates.label     = body.label;
    if (body.proxyType !== undefined) updates.proxyType = body.proxyType;
    if (body.host      !== undefined) updates.host      = body.host;
    if (body.port      !== undefined) updates.port      = body.port ? Number(body.port) : null;
    if (body.username  !== undefined) updates.username  = body.username;
    if (body.password  !== undefined) updates.password  = body.password;
    if (body.deviceId  !== undefined) updates.deviceId  = body.deviceId ? Number(body.deviceId) : null;

    // Re-derive proxyUrl whenever any connection field changes — merge incoming
    // values with the current DB row to avoid partial overwrites
    if (body.host || body.port || body.username || body.password) {
      const current = await db
        .select()
        .from(proxiesTable)
        .where(eq(proxiesTable.id, id))
        .limit(1);

      if (current[0]) {
        const h  = body.host     ?? current[0].host;
        const p  = body.port     ?? current[0].port;
        const u  = body.username ?? current[0].username;
        const pw = body.password ?? current[0].password;
        if (h && p) {
          updates.proxyUrl = `http://${u ?? ""}:${pw ?? ""}@${h}:${p}`;
        }
      }
    }

    const [proxy] = await db
      .update(proxiesTable)
      .set(updates as Parameters<typeof db.update>[0])
      .where(eq(proxiesTable.id, id))
      .returning();

    if (!proxy) return res.status(404).json({ error: "Not found" });
    res.json(proxy);
  } catch (err) {
    req.log.error({ err }, "Error updating proxy");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/proxies/:id
 * Permanently removes a proxy from the pool. Any device that was assigned
 * to it will remain but its deviceId reference on this proxy record is gone.
 */
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(proxiesTable).where(eq(proxiesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting proxy");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
