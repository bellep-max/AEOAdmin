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
import { proxiesTable, insertProxySchema, devicesTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { ok, created, noContent, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

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
        sessionCount: sql<number>`0`,
        lastUsed:     proxiesTable.lastUsed,
        // Device info joined from devicesTable (null when unassigned)
        deviceIdentifier: devicesTable.deviceIdentifier,
        deviceModel:      devicesTable.model,
      })
      .from(proxiesTable)
      .leftJoin(devicesTable, eq(proxiesTable.deviceId, devicesTable.id));

    ok(res, proxies);
  } catch (err) {
    req.log.error({ err }, "Error fetching proxies");
    serverError(res);
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
    const data = validateBody(req, res, insertProxySchema);
    if (!data) return;

    // Auto-build proxyUrl from individual credential fields when not provided
    const proxyUrl = data.proxyUrl
      ?? (data.host && data.port
          ? `http://${data.username ?? ""}:${data.password ?? ""}@${data.host}:${data.port}`
          : null);

    const [proxy] = await db
      .insert(proxiesTable)
      .values({ ...data, proxyUrl })
      .returning();

    created(res, proxy);
  } catch (err) {
    req.log.error({ err }, "Error creating proxy");
    serverError(res);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(proxiesTable.id, id))
      .returning();

    if (!proxy) return notFound(res);
    ok(res, proxy);
  } catch (err) {
    req.log.error({ err }, "Error updating proxy");
    serverError(res);
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
    noContent(res);
  } catch (err) {
    req.log.error({ err }, "Error deleting proxy");
    serverError(res);
  }
});

export default router;
