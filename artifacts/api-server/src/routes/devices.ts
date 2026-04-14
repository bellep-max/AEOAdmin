import { Router } from "express";
import { db } from "@workspace/db";
import { devicesTable, insertDeviceSchema, sessionsTable } from "@workspace/db/schema";
import { eq, count, sql } from "drizzle-orm";
import { ok, created, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

router.get("/farm-status", async (req, res) => {
  try {
    const devices = await db.select().from(devicesTable);
    const available = devices.filter((d) => d.status === "available").length;
    const inUse = devices.filter((d) => d.status === "in_use").length;
    const offline = devices.filter((d) => d.status === "offline").length;
    const retiredToday = devices.filter((d) => d.retiredToday).length;
    const total = devices.length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [sessionsToday] = await db
      .select({ count: count() })
      .from(sessionsTable)
      .where(sql`${sessionsTable.timestamp} >= ${today}`);

    const avgSessionsPerDevice = total > 0 ? Number(sessionsToday.count) / total : 0;

    ok(res, {
      total,
      available,
      inUse,
      offline,
      retiredToday,
      averageSessionsPerDevice: Math.round(avgSessionsPerDevice * 100) / 100,
      maxSessionsPerDevicePerDay: 1,
      currentUtilization: total > 0 ? inUse / total : 0,
      devices,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching device farm status");
    serverError(res);
  }
});

router.get("/", async (req, res) => {
  try {
    const { status } = req.query as Record<string, string>;
    const devices = await db
      .select()
      .from(devicesTable)
      .where(status ? eq(devicesTable.status, status as typeof devicesTable.status.enumValues[number]) : undefined);
    ok(res, devices);
  } catch (err) {
    req.log.error({ err }, "Error fetching devices");
    serverError(res);
  }
});

router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertDeviceSchema);
    if (!data) return;

    const [device] = await db
      .insert(devicesTable)
      .values(data)
      .returning();
    created(res, device);
  } catch (err) {
    req.log.error({ err }, "Error creating device");
    serverError(res);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body;

    const DEVICE_FIELDS = ["deviceIdentifier", "label", "serial", "port", "useAdb", "brand", "model", "status", "retiredToday", "lastUsedAt"] as const;
    const updates: Record<string, unknown> = {};
    for (const f of DEVICE_FIELDS) {
      if (f in body) updates[f] = body[f];
    }

    const [device] = await db
      .update(devicesTable)
      .set(updates)
      .where(eq(devicesTable.id, id))
      .returning();
    if (!device) return notFound(res);
    ok(res, device);
  } catch (err) {
    req.log.error({ err }, "Error updating device");
    serverError(res);
  }
});

export default router;
