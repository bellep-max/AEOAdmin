import { Router } from "express";
import { db } from "@workspace/db";
import { customPackagesTable, PACKAGE_CREATORS } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireViewer, requireAdmin } from "../middlewares/role-auth";

const router = Router();

/* GET /api/packages — list all custom packages */
router.get("/", requireViewer, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(customPackagesTable)
      .orderBy(customPackagesTable.createdAt);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching custom packages");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/packages — create a new custom package */
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { name, description, target, features, color, tier, createdBy } =
      req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: "Package name is required" });
    }
    if (!color?.trim()) {
      return res.status(400).json({ error: "Color is required" });
    }
    if (
      !createdBy ||
      !(PACKAGE_CREATORS as readonly string[]).includes(createdBy)
    ) {
      return res.status(400).json({
        error: `createdBy must be one of: ${PACKAGE_CREATORS.join(", ")}`,
      });
    }

    const [pkg] = await db
      .insert(customPackagesTable)
      .values({
        name: name.trim(),
        description: description?.trim() ?? null,
        target: target?.trim() ?? null,
        features: features ? JSON.stringify(features) : null,
        color: color.trim(),
        tier: tier?.trim() ?? null,
        createdBy,
      })
      .returning();

    res.status(201).json(pkg);
  } catch (err) {
    req.log.error({ err }, "Error creating custom package");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/packages/:id — update a custom package */
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const { name, description, target, features, color, tier } = req.body;
    if (name !== undefined && !name?.trim())
      return res.status(400).json({ error: "Package name cannot be empty" });

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() ?? null;
    if (target !== undefined) updates.target = target?.trim() ?? null;
    if (features !== undefined) updates.features = features ? JSON.stringify(features) : null;
    if (color !== undefined) updates.color = color.trim();
    if (tier !== undefined) updates.tier = tier?.trim() ?? null;

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: "No fields to update" });

    const [updated] = await db
      .update(customPackagesTable)
      .set(updates)
      .where(eq(customPackagesTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating custom package");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* DELETE /api/packages/:id — remove a custom package */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [deleted] = await db
      .delete(customPackagesTable)
      .where(eq(customPackagesTable.id, id))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting custom package");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
