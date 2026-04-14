import { Router } from "express";
import { db } from "@workspace/db";
import { sessionPlatformsTable, insertSessionPlatformSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ok, created, badRequest, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { sessionId } = req.query as Record<string, string>;

    if (!sessionId) return badRequest(res, "sessionId query param is required");

    const rows = await db
      .select()
      .from(sessionPlatformsTable)
      .where(eq(sessionPlatformsTable.sessionId, parseInt(sessionId)));

    ok(res, rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching session platforms");
    serverError(res);
  }
});

router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertSessionPlatformSchema);
    if (!data) return;

    const [entry] = await db
      .insert(sessionPlatformsTable)
      .values(data)
      .returning();

    created(res, entry);
  } catch (err) {
    req.log.error({ err }, "Error creating session platform");
    serverError(res);
  }
});

export default router;
