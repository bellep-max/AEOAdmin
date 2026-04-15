import { useState, useEffect } from "react";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function rawFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { headers });
}

/**
 * Returns plan names fetched from the DB only:
 * standard plans from /api/plans + custom packages from /api/packages.
 * Returns [] when no plans exist in the database.
 */
export function useAllPlanNames(): string[] {
  const [allNames, setAllNames] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      rawFetch("/api/plans").then((r) => (r.ok ? r.json() : [])),
      rawFetch("/api/packages").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([standardPlans, customPlans]: [{ planName: string }[], { name: string }[]]) => {
        const standardNames = standardPlans.map((p) => p.planName).filter(Boolean);
        const customNames = customPlans.map((p) => p.name).filter(Boolean);
        const merged = [...standardNames, ...customNames.filter((n) => !standardNames.includes(n))];
        setAllNames(merged);
      })
      .catch(() => setAllNames([]));
  }, []);

  return allNames;
}
