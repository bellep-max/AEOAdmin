import { Router } from "express";
import { db } from "@workspace/db";
import { customPackagesTable, insertCustomPackageSchema, PACKAGE_CREATORS } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(customPackagesTable)
      .orderBy(customPackagesTable.createdAt);
    ok(res, rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching custom packages");
    serverError(res);
  }
});

router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertCustomPackageSchema);
    if (!data) return;

    if (!(PACKAGE_CREATORS as readonly string[]).includes(data.createdBy)) {
      return badRequest(res, `createdBy must be one of: ${PACKAGE_CREATORS.join(", ")}`);
    }

    const [pkg] = await db
      .insert(customPackagesTable)
      .values({
        ...data,
        features: data.features ? (typeof data.features === "string" ? data.features : JSON.stringify(data.features)) : null,
      })
      .returning();

    created(res, pkg);
  } catch (err) {
    req.log.error({ err }, "Error creating custom package");
    serverError(res);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return badRequest(res, "Invalid id");

    const [deleted] = await db
      .delete(customPackagesTable)
      .where(eq(customPackagesTable.id, id))
      .returning();

    if (!deleted) return notFound(res);
    ok(res, { deleted: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting custom package");
    serverError(res);
  }
});

export default router;
