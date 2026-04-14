import { Router } from "express";
import { db } from "@workspace/db";
import { deviceRotationsTable, insertDeviceRotationSchema } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { deviceId, date } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];

    if (deviceId) conditions.push(eq(deviceRotationsTable.deviceId, parseInt(deviceId)));
    if (date) conditions.push(eq(deviceRotationsTable.date, date));

    const rows = await db
      .select()
      .from(deviceRotationsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    ok(res, rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching device rotations");
    serverError(res);
  }
});

router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertDeviceRotationSchema);
    if (!data) return;

    const [rotation] = await db
      .insert(deviceRotationsTable)
      .values({
        ...data,
        startedAt: data.startedAt ?? new Date(),
      })
      .returning();

    created(res, rotation);
  } catch (err) {
    req.log.error({ err }, "Error creating device rotation");
    serverError(res);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return badRequest(res, "Invalid id");

    const body = req.body;
    const ROTATION_FIELDS = ["status", "completedAt"] as const;
    const updates: Record<string, unknown> = {};
    for (const f of ROTATION_FIELDS) {
      if (f in body) updates[f] = body[f];
    }

    if (body.status === "completed" && !updates.completedAt) {
      updates.completedAt = new Date();
    }

    const [rotation] = await db
      .update(deviceRotationsTable)
      .set(updates)
      .where(eq(deviceRotationsTable.id, id))
      .returning();

    if (!rotation) return notFound(res);
    ok(res, rotation);
  } catch (err) {
    req.log.error({ err }, "Error updating device rotation");
    serverError(res);
  }
});

export default router;
