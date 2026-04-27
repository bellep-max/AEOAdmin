import type { Request, Response, NextFunction } from "express";

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = req.session as unknown as Record<string, unknown>;
  if (!session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}
