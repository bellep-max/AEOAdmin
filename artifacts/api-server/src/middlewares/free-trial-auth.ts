import type { Request, Response, NextFunction } from "express";

// Dedicated token for the external free-trial signup site, kept separate from
// ONBOARDING_TOKEN so it can be rotated/revoked without touching the Recurly
// onboarding integration (least privilege: this token can only create trials).
export function requireFreeTrialToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expected = process.env.FREE_TRIAL_TOKEN;
  if (!expected) {
    req.log.error("FREE_TRIAL_TOKEN is not configured on the server");
    return res.status(503).json({ error: "Free-trial auth not configured" });
  }
  const provided = req.header("x-free-trial-token");
  if (!provided || provided !== expected) {
    return res
      .status(401)
      .json({ error: "Invalid or missing X-Free-Trial-Token" });
  }
  next();
}
