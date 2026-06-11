import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** The only plans the chuckslocal role may assign. Mirrors LOCAL_ADMIN_PLAN_TYPES
 *  on the server (lib/scoped-access.ts). */
export const LOCAL_ADMIN_PLAN_NAMES = [
  "Signal AEO Plan",
  "Signal AEO SEO Local",
];

function rawFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { headers, credentials: "include" });
}

/**
 * Returns plan names fetched from the DB only:
 * standard plans from /api/plans + custom packages from /api/packages.
 * Returns [] when no plans exist in the database.
 */
export function useAllPlanNames(): string[] {
  const [allNames, setAllNames] = useState<string[]>([]);
  const { isChucksLocal } = useAuth();

  useEffect(() => {
    Promise.all([
      rawFetch("/api/plans").then((r) => (r.ok ? r.json() : [])),
      rawFetch("/api/packages").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(
        ([standardPlans, customPlans]: [
          { planName: string }[],
          { name: string }[],
        ]) => {
          const standardNames = standardPlans
            .map((p) => p.planName)
            .filter(Boolean);
          const customNames = customPlans.map((p) => p.name).filter(Boolean);
          const merged = [
            ...standardNames,
            ...customNames.filter((n) => !standardNames.includes(n)),
          ];
          setAllNames(merged);
        },
      )
      .catch(() => setAllNames([]));
  }, []);

  // chuckslocal may only assign his two Signal plans — restrict the picker to
  // those (intersected with what actually exists). The server enforces this too.
  if (isChucksLocal) {
    return allNames.filter((n) => LOCAL_ADMIN_PLAN_NAMES.includes(n));
  }
  return allNames;
}
