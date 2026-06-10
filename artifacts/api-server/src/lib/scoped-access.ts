/**
 * Unified scoped-access helpers for the two parallel client-scoping roles:
 *
 *   - sales            → sees only clients with at least one Free Trial Plans row
 *   - account-manager  → sees only clients with at least one NON-free-trial row
 *
 * Admin-panel chain roles (viewer/editor/admin/owner) and the executor token
 * see everything — getScopedClientIds returns null for them, which callers
 * treat as "no filter."
 *
 * This module supersedes the older sales-only helpers in sales-scope.ts.
 * Both files exist temporarily during migration; new code should import from
 * here.
 */
import type { Request, Response } from "express";
import { eq, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import { clientAeoPlansTable } from "@workspace/db/schema";
import { isSales, isAccountManager } from "../middlewares/role-auth";

const FREE_TRIAL_PLAN_TYPE = "Free Trial Plans";

/**
 * Returns the list of client IDs the current session can see. Returns null
 * for unscoped sessions (admin-panel chain). An empty array means the user
 * is in a scoped role but there are zero matching clients — caller should
 * respond with an empty shape rather than running an unscoped query.
 */
export async function getScopedClientIds(
  req: Request,
): Promise<number[] | null> {
  if (isSales(req)) {
    const rows = await db
      .select({ clientId: clientAeoPlansTable.clientId })
      .from(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.planType, FREE_TRIAL_PLAN_TYPE));
    return [...new Set(rows.map((r) => r.clientId))];
  }
  if (isAccountManager(req)) {
    const rows = await db
      .select({ clientId: clientAeoPlansTable.clientId })
      .from(clientAeoPlansTable)
      .where(ne(clientAeoPlansTable.planType, FREE_TRIAL_PLAN_TYPE));
    return [...new Set(rows.map((r) => r.clientId))];
  }
  return null;
}

/**
 * Inline gate helper for per-row endpoints. 404s the response when a scoped
 * session requests an entity outside its eligible set. Unscoped sessions
 * pass through unchanged. Always check the return value:
 *
 *   if (!(await assertScopedAccessToClient(req, res, biz.clientId))) return;
 */
export async function assertScopedAccessToClient(
  req: Request,
  res: Response,
  clientId: number | null,
): Promise<boolean> {
  if (!isSales(req) && !isAccountManager(req)) return true;
  if (clientId == null) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  const eligibleIds = await getScopedClientIds(req);
  if (!eligibleIds || !eligibleIds.includes(clientId)) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}
