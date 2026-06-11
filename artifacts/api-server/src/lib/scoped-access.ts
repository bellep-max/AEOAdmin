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
import { eq, ne, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { clientAeoPlansTable, clientsTable } from "@workspace/db/schema";
import {
  isSales,
  isAccountManager,
  isChucksLocal,
} from "../middlewares/role-auth";

const FREE_TRIAL_PLAN_TYPE = "Free Trial Plans";

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
  if (!isChucksLocal(req)) return true;
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
  if (isChucksLocal(req)) {
    // In scope = a formal client_aeo_plans row of one of the two Signal plans,
    // OR the client's text plan_name is one of them (covers a client chuckslocal
    // just created with that plan before a formal plan row is attached).
    const planRows = await db
      .select({ clientId: clientAeoPlansTable.clientId })
      .from(clientAeoPlansTable)
      .where(
        inArray(clientAeoPlansTable.planType, [...LOCAL_ADMIN_PLAN_TYPES]),
      );
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
  if (!isSales(req) && !isAccountManager(req) && !isChucksLocal(req))
    return true;
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
