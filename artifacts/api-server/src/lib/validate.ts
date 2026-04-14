import type { Request, Response } from "express";
import { badRequest } from "./response";

/**
 * Validate req.body against a Zod schema (from drizzle-zod or hand-written).
 * Returns the parsed data on success, or sends a 400 and returns null.
 */
export function validateBody<T>(
  req: Request,
  res: Response,
  schema: { safeParse(data: unknown): { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } },
): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const messages = (result.error?.issues ?? [])
      .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
      .join("; ");
    badRequest(res, messages || "Invalid request body");
    return null;
  }
  return result.data as T;
}
