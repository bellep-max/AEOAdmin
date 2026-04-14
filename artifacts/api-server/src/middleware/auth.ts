import type { Request, Response, NextFunction } from "express";

// Extend express-session types
declare module "express-session" {
  interface SessionData {
    userId: number;
    userEmail: string;
    userName: string;
    userRole: string;
  }
}

/**
 * Auth middleware that accepts either:
 * 1. Session-based auth (userId in session) — for admin panel
 * 2. X-Service-Key header matching SERVICE_API_KEY env var — for executor app
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Session auth (admin panel)
  if (req.session.userId) {
    next();
    return;
  }

  // Service-to-service auth (executor app)
  const serviceKey = process.env.SERVICE_API_KEY;
  const headerKey = req.headers["x-service-key"];
  if (serviceKey && headerKey === serviceKey) {
    next();
    return;
  }

  res.status(401).json({ success: false, error: "Not authenticated" });
}
