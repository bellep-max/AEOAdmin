import { Router } from "express";
import { db } from "@workspace/db";
import { customPackagesTable, PACKAGE_CREATORS } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* GET /api/packages — list all custom packages */
router.get("/", async (req, res) => {
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
router.post("/", async (req, res) => {
  try {
    const { name, description, target, features, color, tier, createdBy } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: "Package name is required" });
    }
    if (!color?.trim()) {
      return res.status(400).json({ error: "Color is required" });
    }
    if (!createdBy || !(PACKAGE_CREATORS as readonly string[]).includes(createdBy)) {
      return res.status(400).json({ error: `createdBy must be one of: ${PACKAGE_CREATORS.join(", ")}` });
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

/* DELETE /api/packages/:id — remove a custom package */
router.delete("/:id", async (req, res) => {
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
