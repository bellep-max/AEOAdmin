import { useQuery } from "@tanstack/react-query";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export function rawFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { headers, credentials: "include" });
}

export type Period = "weekly" | "monthly" | "quarterly" | "lifetime";
export type Status = "new" | "improved" | "steady" | "declined" | "missing" | "pending";
export type Freshness = "fresh" | "stale" | "cold" | "never";

export interface PeriodRow {
  keywordId: number;
  keywordText: string;
  platform: string;
  clientId: number | null;
  clientName: string | null;
  businessId: number | null;
  businessName: string | null;
  aeoPlanId: number | null;
  campaignName: string | null;
  currentPosition: number | null;
  currentDate: string | null;
  previousPosition: number | null;
  previousDate: string | null;
  firstPosition: number | null;
  firstDate: string | null;
  change: number | null;
  status: Status;
  freshness: Freshness;
  lastRunAt: string | null;
}

export interface PeriodResponse {
  period: Period;
  window: { currentStart: string; currentEnd: string; previousStart: string; previousEnd: string };
  rows: PeriodRow[];
}

export interface PeriodFilters {
  period: Period;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

export function buildPeriodUrl(filters: PeriodFilters): string {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.clientId != null) params.set("clientId", String(filters.clientId));
  if (filters.businessId != null) params.set("businessId", String(filters.businessId));
  if (filters.aeoPlanId != null) params.set("aeoPlanId", String(filters.aeoPlanId));
  return `/api/ranking-reports/period-comparison?${params}`;
}

export function usePeriodComparison(filters: PeriodFilters) {
  return useQuery<PeriodResponse>({
    queryKey: ["/api/ranking-reports/period-comparison", filters.period, filters.clientId, filters.businessId, filters.aeoPlanId],
    queryFn: async () => {
      const res = await rawFetch(buildPeriodUrl(filters));
      if (!res.ok) throw new Error("Failed to load period comparison");
      return res.json();
    },
  });
}

export function fmtPos(n: number | null | undefined): string {
  return n == null ? "—" : `#${n}`;
}

export function fmtWindow(s: string): string {
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtRelative(s: string | null): string {
  if (!s) return "—";
  const then = new Date(s).getTime();
  const now = Date.now();
  const diffHours = Math.floor((now - then) / (1000 * 60 * 60));
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const PLATFORM_ORDER = ["chatgpt", "gemini", "perplexity"] as const;

export const PLATFORM_COLORS: Record<string, string> = {
  chatgpt: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  gemini: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
  perplexity: "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400",
};

export interface StatusCounts {
  total: number;
  improved: number;
  declined: number;
  steady: number;
  newCount: number;
  missing: number;
}

export interface PlatformAggregate {
  platform: string;
  keywordCount: number;
  avgCurrent: number | null;
  avgPrevious: number | null;
  avgFirst: number | null;
  change: number | null;
  topRank: number;
  topRankThreshold: number;
  improved: number;
  declined: number;
}

export const TOP_RANK_THRESHOLD = 3;

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function aggregatePlatforms(rows: readonly PeriodRow[]): PlatformAggregate[] {
  const byPlatform = new Map<string, PeriodRow[]>();
  for (const r of rows) {
    const list = byPlatform.get(r.platform);
    if (list) list.push(r);
    else byPlatform.set(r.platform, [r]);
  }
  const ordered: string[] = [
    ...PLATFORM_ORDER.filter((p) => byPlatform.has(p)),
    ...[...byPlatform.keys()].filter((p) => !PLATFORM_ORDER.includes(p as typeof PLATFORM_ORDER[number])),
  ];
  return ordered.map((platform) => {
    const list = byPlatform.get(platform) ?? [];
    const cur = list.map((r) => r.currentPosition).filter((n): n is number => n != null);
    const prev = list.map((r) => r.previousPosition).filter((n): n is number => n != null);
    const first = list.map((r) => r.firstPosition).filter((n): n is number => n != null);
    const avgCur = avg(cur);
    const avgPrev = avg(prev);
    const avgFirstVal = avg(first);
    const avgCurRounded = avgCur != null ? Math.round(avgCur) : null;
    const avgPrevRounded = avgPrev != null ? Math.round(avgPrev) : null;
    const avgFirstRounded = avgFirstVal != null ? Math.round(avgFirstVal) : null;
    const change = avgCurRounded != null && avgPrevRounded != null ? avgPrevRounded - avgCurRounded : null;
    return {
      platform,
      keywordCount: list.length,
      avgCurrent: avgCurRounded,
      avgPrevious: avgPrevRounded,
      avgFirst: avgFirstRounded,
      change,
      topRank: cur.filter((n) => n <= TOP_RANK_THRESHOLD).length,
      topRankThreshold: TOP_RANK_THRESHOLD,
      improved: list.filter((r) => r.status === "improved").length,
      declined: list.filter((r) => r.status === "declined").length,
    };
  });
}

export function countStatuses(rows: readonly PeriodRow[]): StatusCounts {
  return {
    total: rows.length,
    improved: rows.filter((r) => r.status === "improved").length,
    declined: rows.filter((r) => r.status === "declined").length,
    steady: rows.filter((r) => r.status === "steady").length,
    newCount: rows.filter((r) => r.status === "new").length,
    missing: rows.filter((r) => r.status === "missing").length,
  };
}

export function periodLabel(p: Period): { short: string; long: string; previousLabel: string; currentLabel: string } {
  switch (p) {
    case "weekly":    return { short: "Biweekly", long: "Current 2 weeks vs previous 2 weeks (ET)", previousLabel: "Last 2 weeks", currentLabel: "Current rank" };
    case "monthly":   return { short: "Month",   long: "Current month vs last month", previousLabel: "Last month",      currentLabel: "Current rank" };
    case "quarterly": return { short: "Quarter", long: "Current quarter vs last quarter", previousLabel: "Last quarter", currentLabel: "Current rank" };
    case "lifetime":  return { short: "Lifetime", long: "First ever vs latest",      previousLabel: "Initial rank",    currentLabel: "Current rank" };
  }
}
