import { Router } from "express";
import { db } from "@workspace/db";
import { devicesTable, sessionsTable } from "@workspace/db/schema";
import { eq, and, count, sql } from "drizzle-orm";

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

    res.json({
      total,
      available,
      inUse,
      offline,
      retiredToday,
      averageSessionsPerDevice: Math.round(avgSessionsPerDevice * 100) / 100,
      maxSessionsPerDevicePerDay: 1,
      currentUtilization: total > 0 ? inUse / total : 0,
      devices: devices.map((d) => ({ ...d, sessionsToday: null })),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching device farm status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { status } = req.query as Record<string, string>;
    const devices = await db
      .select()
      .from(devicesTable)
      .where(status ? eq(devicesTable.status, status) : undefined);
    res.json(devices.map((d) => ({ ...d, sessionsToday: null })));
  } catch (err) {
    req.log.error({ err }, "Error fetching devices");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body;
    const [device] = await db
      .insert(devicesTable)
      .values({
        deviceIdentifier: body.deviceIdentifier,
        model: body.model,
        status: body.status ?? "available",
      })
      .returning();
    res.status(201).json({ ...device, sessionsToday: null });
  } catch (err) {
    req.log.error({ err }, "Error creating device");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [device] = await db
      .update(devicesTable)
      .set(req.body)
      .where(eq(devicesTable.id, id))
      .returning();
    if (!device) return res.status(404).json({ error: "Not found" });
    res.json({ ...device, sessionsToday: null });
  } catch (err) {
    req.log.error({ err }, "Error updating device");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
