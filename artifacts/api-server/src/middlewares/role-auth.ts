import type { Request, Response, NextFunction } from "express";

/**
 * Role gate. Use to hide beta features behind an "owner" role while
 * regular admins (e.g. Mary) keep their existing access. Roles supported:
 *
 *   - "owner"  → super-admin, sees and runs beta features
 *   - "admin"  → existing admin surface only (default for all old accounts)
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
