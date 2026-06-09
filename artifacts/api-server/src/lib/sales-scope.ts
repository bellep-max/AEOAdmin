/**
 * Sales-scope helpers.
 *
 * The sales role is restricted to free-trial clients. Any handler that
 * returns client-keyed data (lists, aggregates, per-keyword reports) must
 * call getSalesEligibleClientIds(req) and intersect its result with the
 * query. Returning null means the caller is NOT a sales session and no
 * filter should be applied (admin/owner see everything).
 *
 * Centralizing this avoids the "Free Trial Plans" literal leaking into
 * every route, and keeps the policy easy to change if sales' scope ever
 * widens to more plan types.
 */
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { clientAeoPlansTable } from "@workspace/db/schema";
import { getSalesPlanFilter, isSales } from "../middlewares/role-auth";

/**
 * Returns the list of client IDs a sales session is allowed to see (clients
 * with at least one free-trial plan). Returns null for non-sales sessions —
 * the caller should treat null as "no filter, see everything." An empty
 * array means sales is logged in but there are no free-trial clients today;
 * the caller should respond with the empty shape rather than running an
 * unscoped query.
 */
export async function getSalesEligibleClientIds(
  req: Request,
): Promise<number[] | null> {
  const planFilter = getSalesPlanFilter(req);
  if (!planFilter) return null;
  const rows = await db
    .select({ clientId: clientAeoPlansTable.clientId })
    .from(clientAeoPlansTable)
    .where(eq(clientAeoPlansTable.planType, planFilter));
  return [...new Set(rows.map((r) => r.clientId))];
}

/**
 * Inline gate helper for per-row endpoints. Looks up the entity's clientId
 * (caller-provided) and 404s the response if sales is requesting an entity
 * outside their eligible set. Non-sales sessions pass through unchanged.
 *
 * Returns true when the handler should continue, false when it has already
 * sent a 404. Always check the return value:
 *
 *   if (!(await assertSalesAccessToClient(req, res, biz.clientId))) return;
 */
export async function assertSalesAccessToClient(
  req: Request,
  res: Response,
  clientId: number | null,
): Promise<boolean> {
  if (!isSales(req)) return true;
  if (clientId == null) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  const eligibleIds = await getSalesEligibleClientIds(req);
  if (!eligibleIds || !eligibleIds.includes(clientId)) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}
