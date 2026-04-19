import type { Request, Response, NextFunction } from "express";

export function requireOnboardingToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ONBOARDING_TOKEN;
  if (!expected) {
    req.log.error("ONBOARDING_TOKEN is not configured on the server");
    return res.status(503).json({ error: "Onboarding auth not configured" });
  }
  const provided = req.header("x-onboarding-token");
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "Invalid or missing X-Onboarding-Token" });
  }
  next();
}
