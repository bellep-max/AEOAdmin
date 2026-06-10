import type { Request, Response, NextFunction } from "express";

/**
 * Role gate. Use to hide beta features behind an "owner" role while
 * regular admins (e.g. Mary) keep their existing access. Roles in use:
 *
 *   - "owner"    → super-admin, sees and runs beta features
 *   - "admin"    → existing admin surface only (default for all old accounts)
 *   - "sales"    → admin-panel access scoped to free-trial clients only
 *                  (see getSalesPlanFilter — adds plan_type filter to queries)
 *   - "customer" → portal user, /portal/* only, scoped to their clientId
 *
 * Apply on routes that should only be visible to the owner.
 */
export function requireOwner(req: Request, res: Response, next: NextFunction) {
  const session = req.session as unknown as Record<string, unknown>;
  if (!session.userId)
    return res.status(401).json({ error: "Not authenticated" });
  if (session.userRole !== "owner")
    return res.status(403).json({ error: "Forbidden" });
  next();
}

/** True if the request session holds an owner. Used by ad-hoc handlers. */
export function isOwner(req: Request): boolean {
  const session = req.session as unknown as Record<string, unknown>;
  return session.userRole === "owner";
}

/** True if the request session holds a sales-team user. */
export function isSales(req: Request): boolean {
  const session = req.session as unknown as Record<string, unknown>;
  return session.userRole === "sales";
}

/** True if the request session holds an account-manager user. */
export function isAccountManager(req: Request): boolean {
  const session = req.session as unknown as Record<string, unknown>;
  return session.userRole === "account-manager";
}

/**
 * Generic role gate. Accepts any of the listed roles. Use this when an
 * endpoint should be reachable by multiple roles (e.g. AEO Reporter is for
 * owner AND sales).
 */
export function requireRoles(...allowedRoles: string[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    const session = req.session as unknown as Record<string, unknown>;
    if (!session.userId)
      return res.status(401).json({ error: "Not authenticated" });
    const role = session.userRole as string | undefined;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

/**
 * Subsumptive admin-panel role hierarchy:
 *
 *   viewer  → read-only across the admin panel
 *   editor  → viewer + operational writes (update keywords, sessions, etc.)
 *   admin   → editor + destructive ops (create/delete clients, businesses,
 *             campaigns; bulk import; config writes)
 *   owner   → admin + beta features (AEO Reporter, Variants, Bi-Weekly
 *             Report, manual rotation)
 *
 * Each gate ALSO accepts every role above it. requireViewer accepts admin
 * and owner; requireEditor accepts admin and owner; etc.
 *
 * `sales` is parallel to this chain (it's tag-gated free-trial-only access),
 * not a tier. requireSalesAllowed() lists the routes a sales user can hit
 * alongside the admin/owner tier — used on /clients, /dashboard, /rankings,
 * /llm/aeo-reporter/stream. Pure admin-panel routes (other clients pages,
 * audit logs, sessions, etc.) intentionally do NOT include sales.
 *
 * `customer` is also parallel — it's the portal role, gated by the portal
 * middleware (requirePortalAuth + requireLinkedClient). It does not appear
 * in any of these hierarchies.
 */
export const requireViewer = requireRoles("viewer", "editor", "admin", "owner");
export const requireEditor = requireRoles("editor", "admin", "owner");
export const requireAdmin = requireRoles("admin", "owner");

/**
 * For endpoints reachable by the two parallel scoped roles (sales +
 * account-manager) AND the unscoped admin-panel chain. Each scoped role
 * sees only its slice of clients per the helpers in lib/scoped-access.ts.
 */
export const requireSalesAllowed = requireRoles(
  "sales",
  "account-manager",
  "viewer",
  "editor",
  "admin",
  "owner",
);

/**
 * If the session is a sales user, return the plan_type their view must be
 * scoped to (currently "Free Trial Plans"). Other roles return null, meaning
 * no filter — they see every plan. Handlers that join through
 * client_aeo_plans should add `AND plan_type = <returned value>` when this
 * helper returns non-null.
 *
 * Centralizing the literal here (rather than scattering "Free Trial Plans"
 * across handlers) keeps the policy easy to audit and easy to change if
 * sales' scope ever widens to multiple plan types.
 */
export function getSalesPlanFilter(req: Request): string | null {
  return isSales(req) ? "Free Trial Plans" : null;
}

/**
 * Accepts EITHER a valid executor token (machine flow) OR a logged-in owner
 * session (admin UI flow). Use this on endpoints that runners + the owner UI
 * both call — e.g. audit-report/run, audit-context, variants regenerate-all.
 */
export function requireExecutorOrOwner(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expected = process.env.EXECUTOR_TOKEN;
  const provided = req.header("x-executor-token");
  if (expected && provided && provided === expected) return next();

  const session = req.session as unknown as Record<string, unknown>;
  if (session.userId && session.userRole === "owner") return next();

  return res
    .status(401)
    .json({ error: "Requires executor token or owner session" });
}

/**
 * Catalog reads needed by BOTH the executor (machine flow, no session) AND
 * any admin-panel user. Accepts the executor token OR any logged-in role in
 * the viewer chain (viewer/editor/admin/owner) OR sales.
 *
 * Apply on GET endpoints the executor must read to do its job (keywords,
 * clients, businesses lists / detail) — these used to be anonymous and were
 * inadvertently locked out by the RBAC sprint.
 */
export function requireExecutorOrSalesAllowed(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expected = process.env.EXECUTOR_TOKEN;
  const provided = req.header("x-executor-token");
  if (expected && provided && provided === expected) return next();

  const session = req.session as unknown as Record<string, unknown>;
  const role = session.userRole as string | undefined;
  if (
    session.userId &&
    role &&
    ["sales", "account-manager", "viewer", "editor", "admin", "owner"].includes(
      role,
    )
  ) {
    return next();
  }

  return res.status(401).json({ error: "Not authenticated" });
}
