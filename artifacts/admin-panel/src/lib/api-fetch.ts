const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** Session-cookie fetch used across admin-panel pages. Adds the ngrok
 *  browser-warning bypass header when the API base is an ngrok tunnel. */
export function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const h: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (BASE.includes("ngrok")) h["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { credentials: "include", ...init, headers: h });
}
