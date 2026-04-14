/**
 * Shared API fetch utility for pages that use raw fetch instead of generated hooks.
 * Handles:
 * - Base URL from VITE_API_URL
 * - ngrok header bypass
 * - Cookie credentials
 * - Auto-unwrapping { success, data } envelope
 */

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, {
    credentials: "include",
    ...init,
    headers,
  });
}

/**
 * Fetch JSON from the API, auto-unwrapping the { success, data } envelope.
 */
export async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = await res.text();
    let errorMsg = `API error ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      errorMsg = parsed?.error ?? errorMsg;
    } catch {
      // use default
    }
    throw new Error(errorMsg);
  }
  if (res.status === 204) return null as T;
  const json = await res.json();
  // Auto-unwrap envelope
  if (json && typeof json === "object" && "success" in json && "data" in json) {
    return json.data as T;
  }
  return json as T;
}
