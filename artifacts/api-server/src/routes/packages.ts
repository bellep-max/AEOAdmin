import { Router } from "express";
import { db } from "@workspace/db";
import { customPackagesTable, PACKAGE_CREATORS } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireSalesAllowed, requireAdmin } from "../middlewares/role-auth";
import { isScopedRole } from "../lib/scoped-access";

const router = Router();

/* GET /api/packages — list all custom packages.
   Scoped roles see their slice: sales only Free Trial, account-manager
   everything except Free Trial. */
router.get("/", requireSalesAllowed, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(customPackagesTable)
      .orderBy(customPackagesTable.createdAt);
    const visible = rows.filter((p) => {
      const isFreeTrial = (p.name || "").toLowerCase().includes("free");
      // Non-owner (scoped) roles never see the free-trial package; owners see all.
      if (isScopedRole(req)) return !isFreeTrial;
      return true;
    });
    res.json(visible);
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

/* PATCH /api/packages/:id — update a custom package.
   Accepts any subset of: name, description, target, features (array),
   color, tier, createdBy. Other fields are left untouched. */
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const body = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name)
        return res.status(400).json({ error: "Package name is required" });
      update.name = name;
    }
    if ("description" in body)
      update.description =
        typeof body.description === "string"
          ? body.description.trim() || null
          : null;
    if ("target" in body)
      update.target =
        typeof body.target === "string" ? body.target.trim() || null : null;
    if ("features" in body)
      update.features = Array.isArray(body.features)
        ? JSON.stringify(body.features)
        : null;
    if ("color" in body) {
      const color = typeof body.color === "string" ? body.color.trim() : "";
      if (!color) return res.status(400).json({ error: "Color is required" });
      update.color = color;
    }
    if ("tier" in body)
      update.tier =
        typeof body.tier === "string" ? body.tier.trim() || null : null;
    if ("createdBy" in body) {
      if (
        typeof body.createdBy !== "string" ||
        !(PACKAGE_CREATORS as readonly string[]).includes(body.createdBy)
      ) {
        return res.status(400).json({
          error: `createdBy must be one of: ${PACKAGE_CREATORS.join(", ")}`,
        });
      }
      update.createdBy = body.createdBy;
    }

    if (Object.keys(update).length === 0)
      return res.status(400).json({ error: "No fields to update" });

    const [pkg] = await db
      .update(customPackagesTable)
      .set(update as Partial<typeof customPackagesTable.$inferInsert>)
      .where(eq(customPackagesTable.id, id))
      .returning();

    if (!pkg) return res.status(404).json({ error: "Not found" });
    res.json(pkg);
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
