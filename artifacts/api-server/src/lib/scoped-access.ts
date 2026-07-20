/**
 * Unified scoped-access helpers. Every non-owner admin role is limited to the
 * local plans (see LOCAL_ADMIN_PLAN_TYPES):
 *
 *   - sales / account-manager / chuckslocal → see ONLY clients on a local plan
 *
 * Free-trial and every other (non-local) plan are OWNER-ONLY. Admin-panel chain
 * roles (viewer/editor/admin/owner) and the executor token see everything —
 * getScopedClientIds returns null for them, which callers treat as "no filter."
 *
 * This module supersedes the older sales-only helpers in sales-scope.ts (dead).
 */
import type { Request, Response } from "express";
import { inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { clientAeoPlansTable, clientsTable } from "@workspace/db/schema";
import {
  isSales,
  isAccountManager,
  isChucksLocal,
} from "../middlewares/role-auth";

/**
 * Every non-owner admin role (sales, account-manager, chuckslocal) is a
 * plan-scoped role limited to the local plans. Owners and the unscoped
 * admin-panel chain (viewer/editor/admin) are NOT scoped — they see all plans.
 * Policy: free-trial and every non-local plan are owner-only.
 */
export function isScopedRole(req: Request): boolean {
  return isSales(req) || isAccountManager(req) || isChucksLocal(req);
}

/**
 * The only plans the `chuckslocal` role may see or assign. Both visibility
 * (getScopedClientIds) and plan-assignment validation (isPlanAllowedForScope)
 * key off this list, so widening chuckslocal's scope is a one-line change here.
 */
export const LOCAL_ADMIN_PLAN_TYPES = [
  "AEO SEO Local Plan",
  "Signal AEO SEO Local",
] as const;

/**
 * For a scoped writer, returns whether `planType` is one they're allowed to
 * assign. chuckslocal may only attach the two Signal local plans; unscoped
 * roles may assign anything (returns true).
 */
export function isPlanAllowedForScope(
  req: Request,
  planType: string | null | undefined,
): boolean {
  if (!isScopedRole(req)) return true;
  return (
    planType != null &&
    (LOCAL_ADMIN_PLAN_TYPES as readonly string[]).includes(planType)
  );
}

/**
 * Returns the list of client IDs the current session can see. Returns null
 * for unscoped sessions (admin-panel chain). An empty array means the user
 * is in a scoped role but there are zero matching clients — caller should
 * respond with an empty shape rather than running an unscoped query.
 */
export async function getScopedClientIds(
  req: Request,
): Promise<number[] | null> {
  // Owners + the unscoped admin chain see everything.
  if (!isScopedRole(req)) return null;
  // Every scoped role (sales / account-manager / chuckslocal) sees ONLY clients
  // on a local plan. In scope = a formal client_aeo_plans row of one of the
  // local plans, OR the client's text plan_name is one of them (covers a client
  // just created with that plan before a formal plan row is attached).
  const planRows = await db
    .select({ clientId: clientAeoPlansTable.clientId })
    .from(clientAeoPlansTable)
    .where(inArray(clientAeoPlansTable.planType, [...LOCAL_ADMIN_PLAN_TYPES]));
  const nameRows = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(inArray(clientsTable.planName, [...LOCAL_ADMIN_PLAN_TYPES]));
  return [
    ...new Set([
      ...planRows.map((r) => r.clientId),
      ...nameRows.map((r) => r.id),
    ]),
  ];
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
  if (!isScopedRole(req)) return true;
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
