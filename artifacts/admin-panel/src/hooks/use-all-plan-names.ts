import { useState, useEffect } from "react";
import { PLAN_NAMES } from "@/lib/plan-meta";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function rawFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { headers });
}

/**
 * Returns the merged list of standard plan names + custom package names
 * fetched from /api/packages. Falls back to standard names only on error.
 */
export function useAllPlanNames(): string[] {
  const [allNames, setAllNames] = useState<string[]>(PLAN_NAMES);

  useEffect(() => {
    rawFetch("/api/packages")
      .then((r) => (r.ok ? r.json() : []))
      .then((customs: { name: string }[]) => {
        const customNames = customs.map((c) => c.name);
        const merged = [...PLAN_NAMES, ...customNames.filter((n) => !PLAN_NAMES.includes(n))];
        setAllNames(merged);
      })
      .catch(() => {/* keep standard names */});
  }, []);

  return allNames;
}
