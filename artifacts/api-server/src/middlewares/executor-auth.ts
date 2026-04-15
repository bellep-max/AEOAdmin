import type { Request, Response, NextFunction } from "express";

export function requireExecutorToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.EXECUTOR_TOKEN;
  if (!expected) {
    req.log.error("EXECUTOR_TOKEN is not configured on the server");
    return res.status(503).json({ error: "Executor auth not configured" });
  }
  const provided = req.header("x-executor-token");
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "Invalid or missing X-Executor-Token" });
  }
  next();
}
