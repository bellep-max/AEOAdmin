import { useQuery } from "@tanstack/react-query";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {};
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, {
    credentials: "include",
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

export type Period = "weekly" | "monthly" | "quarterly" | "lifetime";
export type Status =
  | "new"
  | "improved"
  | "steady"
  | "declined"
  | "missing"
  | "pending"
  | "unavailable";
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
  currentReportId: number | null;
  currentPosition: number | null;
  currentDate: string | null;
  currentVariant: string | null;
  previousReportId: number | null;
  previousPosition: number | null;
  previousDate: string | null;
  firstReportId: number | null;
  firstPosition: number | null;
  firstDate: string | null;
  change: number | null;
  status: Status;
  freshness: Freshness;
  lastRunAt: string | null;
}

export interface PeriodResponse {
  period: Period;
  window: {
    currentStart: string;
    currentEnd: string;
    previousStart: string;
    previousEnd: string;
  };
  rows: PeriodRow[];
}

export interface PeriodFilters {
  period: Period;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  /* Optional ET YYYY-MM-DD overrides. When set, that column's source row
     is pinned to the audit on that exact date per (keyword, platform). */
  firstDate?: string | null;
  prevDate?: string | null;
  currentDate?: string | null;
}

export function buildPeriodUrl(filters: PeriodFilters): string {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.clientId != null)
    params.set("clientId", String(filters.clientId));
  if (filters.businessId != null)
    params.set("businessId", String(filters.businessId));
  if (filters.aeoPlanId != null)
    params.set("aeoPlanId", String(filters.aeoPlanId));
  if (filters.firstDate) params.set("firstDate", filters.firstDate);
  if (filters.prevDate) params.set("prevDate", filters.prevDate);
  if (filters.currentDate) params.set("currentDate", filters.currentDate);
  return `/api/ranking-reports/period-comparison?${params}`;
}

export function usePeriodComparison(
  filters: PeriodFilters,
  /** When false, the query is held back (no network call). Used to require a
   *  client selection before loading the full dataset — the all-clients payload
   *  is large and makes the page lag. */
  enabled = true,
) {
  return useQuery<PeriodResponse>({
    queryKey: [
      "/api/ranking-reports/period-comparison",
      filters.period,
      filters.clientId,
      filters.businessId,
      filters.aeoPlanId,
      filters.firstDate ?? null,
      filters.prevDate ?? null,
      filters.currentDate ?? null,
    ],
    enabled,
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
  return new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/* ET-anchored date formatters. The Rankings API returns date fields
   (firstDate/previousDate/currentDate) as YYYY-MM-DD text in ET. Parse
   those components manually as a local Date so we never round-trip
   through UTC midnight and shift to the prior day on browsers east of
   UTC. (Earlier bug: Manila browser saw "Apr 17" rows as "Apr 18"
   because the API used to return T04:00:00Z timestamps that crossed
   the ET-midnight boundary during display.) */
const ET = "America/New_York";

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function fmtDayET(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const d = parseYmd(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtShortET(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const d = parseYmd(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function fmtIsoDateET(d: Date): string {
  /* "YYYY-MM-DD" in ET. sv-SE locale renders ISO date format. */
  return d.toLocaleDateString("sv-SE", { timeZone: ET });
}

export function fmtDateTimeET(d: Date): string {
  const date = d.toLocaleDateString("en-US", {
    timeZone: ET,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} at ${time}`;
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
  return new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export const PLATFORM_ORDER = ["chatgpt", "gemini", "perplexity"] as const;

export const PLATFORM_COLORS: Record<string, string> = {
  chatgpt:
    "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  gemini: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
  perplexity:
    "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400",
};

/**
 * Platforms with a known platform-wide outage (the upstream platform isn't
 * reporting). For these, a keyword with no row shows an explicit "Unavailable"
 * status instead of an empty cell, so nobody reads a blank as "rank lost".
 * Flip this list (remove the platform) when it's reporting again — every
 * surface keys off this one constant.
 */
export const UNAVAILABLE_PLATFORMS: readonly string[] = ["gemini"];

export function isPlatformUnavailable(platform: string): boolean {
  return UNAVAILABLE_PLATFORMS.includes(platform.toLowerCase());
}

/** Synthetic placeholder row marking a platform as unavailable for a keyword. */
function makeUnavailableRow(platform: string, like: PeriodRow): PeriodRow {
  return {
    keywordId: like.keywordId,
    keywordText: like.keywordText,
    platform,
    clientId: like.clientId,
    clientName: like.clientName,
    businessId: like.businessId,
    businessName: like.businessName,
    aeoPlanId: like.aeoPlanId,
    campaignName: like.campaignName,
    currentReportId: null,
    currentPosition: null,
    currentDate: null,
    currentVariant: null,
    previousReportId: null,
    previousPosition: null,
    previousDate: null,
    firstReportId: null,
    firstPosition: null,
    firstDate: null,
    change: null,
    status: "unavailable",
    freshness: "never",
    lastRunAt: null,
  };
}

/**
 * Return a keyword's platform rows in PLATFORM_ORDER, appending an "unavailable"
 * placeholder for each configured-unavailable platform that has no real row.
 * No-op when the keyword has no rows at all — a brand-new keyword should read
 * "No data yet", not show a lone outage chip.
 */
export function sortPlatformsWithUnavailable(
  rows: readonly PeriodRow[],
): PeriodRow[] {
  const out = [...rows];
  if (rows.length > 0) {
    const present = new Set(rows.map((r) => r.platform.toLowerCase()));
    for (const platform of UNAVAILABLE_PLATFORMS) {
      if (!present.has(platform))
        out.push(makeUnavailableRow(platform, rows[0]));
    }
  }
  const idx = (p: string) => {
    const i = PLATFORM_ORDER.indexOf(p as (typeof PLATFORM_ORDER)[number]);
    return i === -1 ? 99 : i;
  };
  return out.sort((a, b) => idx(a.platform) - idx(b.platform));
}

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

export function aggregatePlatforms(
  rows: readonly PeriodRow[],
): PlatformAggregate[] {
  const byPlatform = new Map<string, PeriodRow[]>();
  for (const r of rows) {
    const list = byPlatform.get(r.platform);
    if (list) list.push(r);
    else byPlatform.set(r.platform, [r]);
  }
  const ordered: string[] = [
    ...PLATFORM_ORDER.filter((p) => byPlatform.has(p)),
    ...[...byPlatform.keys()].filter(
      (p) => !PLATFORM_ORDER.includes(p as (typeof PLATFORM_ORDER)[number]),
    ),
  ];
  return ordered.map((platform) => {
    const list = byPlatform.get(platform) ?? [];
    const cur = list
      .map((r) => r.currentPosition)
      .filter((n): n is number => n != null);
    const prev = list
      .map((r) => r.previousPosition)
      .filter((n): n is number => n != null);
    const first = list
      .map((r) => r.firstPosition)
      .filter((n): n is number => n != null);
    const avgCur = avg(cur);
    const avgPrev = avg(prev);
    const avgFirstVal = avg(first);
    const avgCurRounded = avgCur != null ? Math.round(avgCur) : null;
    const avgPrevRounded = avgPrev != null ? Math.round(avgPrev) : null;
    const avgFirstRounded =
      avgFirstVal != null ? Math.round(avgFirstVal) : null;
    const change =
      avgCurRounded != null && avgPrevRounded != null
        ? avgPrevRounded - avgCurRounded
        : null;
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

export function periodLabel(p: Period): {
  short: string;
  long: string;
  previousLabel: string;
  currentLabel: string;
} {
  switch (p) {
    case "weekly":
      return {
        short: "Biweekly",
        long: "Current 2 weeks vs previous 2 weeks (ET)",
        previousLabel: "Last 2 weeks",
        currentLabel: "Current rank",
      };
    case "monthly":
      return {
        short: "Month",
        long: "Current month vs last month",
        previousLabel: "Last month",
        currentLabel: "Current rank",
      };
    case "quarterly":
      return {
        short: "Quarter",
        long: "Current quarter vs last quarter",
        previousLabel: "Last quarter",
        currentLabel: "Current rank",
      };
    case "lifetime":
      return {
        short: "Lifetime",
        long: "First ever vs latest",
        previousLabel: "Initial rank",
        currentLabel: "Current rank",
      };
  }
}
