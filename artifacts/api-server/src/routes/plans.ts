/**
 * @file plans.ts
 * @route /api/plans
 *
 * Exposes the Signal AEO service plan catalogue (Starter / Growth / Pro).
 * Plans are seeded in the database and read-only from the API — pricing and
 * feature sets are managed directly in the DB or seed script rather than
 * through admin UI endpoints.
 *
 * The `cost` column is stored as a numeric/decimal type in Postgres; it is
 * coerced to a JavaScript number here so JSON consumers receive a plain
 * number rather than a string (Drizzle returns numeric as string by default).
 *
 * Schema: plansTable (id, name, cost, description, features, …)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { plansTable } from "@workspace/db/schema";
import { ok, serverError } from "../lib/response";
import "../middleware/auth";

const router = Router();

/**
 * GET /api/plans
 * Returns all service plan rows with `cost` cast to a JavaScript number.
 * Used by the Plans page and anywhere plan pricing is displayed.
 */
router.get("/", async (req, res) => {
  try {
    const plans = await db.select().from(plansTable);

    ok(
      res,
      plans.map((p) => ({
        ...p,
        // Postgres numeric columns arrive as strings via node-postgres;
        // convert to number so frontend formatters (currency, charts) work
        cost: Number(p.cost),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching plans");
    serverError(res);
  }
});

export default router;
