import type { Response } from "express";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    limit?: number;
    offset?: number;
  };
}

export function ok<T>(res: Response, data: T, meta?: ApiResponse<T>["meta"]): void {
  const body: ApiResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  res.json(body);
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json({ success: true, data } as ApiResponse<T>);
}

export function noContent(res: Response): void {
  res.status(204).send();
}

export function badRequest(res: Response, message: string): void {
  res.status(400).json({ success: false, error: message } as ApiResponse<never>);
}

export function unauthorized(res: Response, message = "Not authenticated"): void {
  res.status(401).json({ success: false, error: message } as ApiResponse<never>);
}

export function notFound(res: Response, message = "Not found"): void {
  res.status(404).json({ success: false, error: message } as ApiResponse<never>);
}

export function serverError(res: Response, message = "Internal server error"): void {
  res.status(500).json({ success: false, error: message } as ApiResponse<never>);
}
