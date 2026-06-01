import type { Request, Response, NextFunction } from "express";

/* Header-token auth for read endpoints exposed to third parties.
   Accepts either:
     - a logged-in admin session (req.session.userId), so the FE still works,
     - or `Authorization: Bearer <READ_API_TOKEN>` / `X-API-Key: <token>`.
   The token comes from env (READ_API_TOKEN). Missing/empty env => only the
   session path works; the public path 401s. */
export function requireApiToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const session = req.session as unknown as Record<string, unknown> | undefined;
  if (session?.userId) return next();

  const expected = process.env.READ_API_TOKEN ?? "";
  if (!expected) {
    return res
      .status(401)
      .json({ error: "Not authenticated" });
  }

  const raw =
    (req.headers["authorization"] as string | undefined) ?? "";
  const bearer = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  const apiKey =
    bearer || ((req.headers["x-api-key"] as string | undefined) ?? "").trim();

  /* Constant-time compare to avoid leaking match position via timing. Lengths
     must match before constant-time compare; mismatched length still hits the
     reject path but in O(1). */
  if (
    apiKey.length === expected.length &&
    timingSafeEq(apiKey, expected)
  ) {
    return next();
  }
  return res.status(401).json({ error: "Not authenticated" });
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
