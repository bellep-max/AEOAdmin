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
  if (!session.userId) return res.status(401).json({ error: "Not authenticated" });
  if (session.userRole !== "owner") return res.status(403).json({ error: "Forbidden" });
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

/**
 * Generic role gate. Accepts any of the listed roles. Use this when an
 * endpoint should be reachable by multiple roles (e.g. AEO Reporter is for
 * owner AND sales).
 */
export function requireRoles(...allowedRoles: string[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    const session = req.session as unknown as Record<string, unknown>;
    if (!session.userId) return res.status(401).json({ error: "Not authenticated" });
    const role = session.userRole as string | undefined;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

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
export function requireExecutorOrOwner(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.EXECUTOR_TOKEN;
  const provided = req.header("x-executor-token");
  if (expected && provided && provided === expected) return next();

  const session = req.session as unknown as Record<string, unknown>;
  if (session.userId && session.userRole === "owner") return next();

  return res.status(401).json({ error: "Requires executor token or owner session" });
}
