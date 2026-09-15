/**
 * Data layer. Maps a resolved `Intent` to real, role-scoped API calls and
 * computes a `Dataset` from the rows that actually came back. All aggregation
 * is done by the pure functions below (unit-tested); the LLM never touches
 * these numbers except to describe them, under the guardrail.
 *
 * Endpoints used (all accept clientId/businessId scoping, enforced server-side):
 *   GET /api/ranking-reports   → raw ranking observations over time
 *   GET /api/keywords          → tracked keyword inventory
 */
import type {
  Clarification,
  ChatScope,
  DataCoverage,
  Dataset,
  Intent,
  KeywordSummaryRow,
  PlatformStat,
  RankingRow,
  SummaryBlock,
  TimeframeSpec,
} from "./types";

export type FetchResult =
  | { kind: "data"; dataset: Dataset }
  | { kind: "clarify"; clarification: Clarification };

/** Injected so the orchestrator (real fetch) and tests (stubs) share logic. */
export interface DataDeps {
  /** Resolves a path like "/api/ranking-reports?clientId=1" to parsed JSON. */
  getJson: (path: string) => Promise<unknown>;
  /** Today as YYYY-MM-DD (ET). Injected for deterministic tests. */
  today: string;
}

const TOP_N = 3;

/* ── timeframe resolution ──────────────────────────────────────────────── */

function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Resolve a relative timeframe to explicit YYYY-MM-DD bounds. Returns empty
 *  object for "all" (no bound). Never fabricates data — only computes a window
 *  the query is filtered by; coverage still reflects what actually returned. */
export function resolveTimeframe(
  tf: TimeframeSpec | undefined,
  today: string,
): { from?: string; to?: string } {
  if (!tf || tf.token === "all") return {};
  if (tf.token === "custom") return { from: tf.from, to: tf.to };

  const [y, m] = today.split("-").map(Number);
  switch (tf.token) {
    case "last_7d":
      return { from: shiftDays(today, -7), to: today };
    case "last_14d":
      return { from: shiftDays(today, -14), to: today };
    case "last_30d":
      return { from: shiftDays(today, -30), to: today };
    case "last_90d":
      return { from: shiftDays(today, -90), to: today };
    case "this_month": {
      const first = `${y}-${String(m).padStart(2, "0")}-01`;
      return { from: first, to: today };
    }
    case "last_month": {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      const first = `${ly}-${String(lm).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
      const last = `${ly}-${String(lm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { from: first, to: last };
    }
    default:
      return {};
  }
}

/* ── row parsing ───────────────────────────────────────────────────────── */

function toRankingRow(raw: unknown): RankingRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const keywordId = Number(o.keywordId);
  const date = typeof o.date === "string" ? o.date : null;
  const platform =
    typeof o.platform === "string" ? o.platform.toLowerCase() : null;
  if (!Number.isFinite(keywordId) || !date || !platform) return null;
  const pos = o.rankingPosition;
  return {
    keywordId,
    keyword: typeof o.keyword === "string" ? o.keyword : String(keywordId),
    platform,
    date,
    rankingPosition:
      pos === null || pos === undefined || pos === "" ? null : Number(pos),
    status: typeof o.status === "string" ? o.status : "success",
    searchAddress: typeof o.searchAddress === "string" ? o.searchAddress : null,
  };
}

/* ── pure aggregations ─────────────────────────────────────────────────── */

export function computeCoverage(rows: RankingRow[]): DataCoverage {
  const dates = rows
    .map((r) => r.date)
    .filter(Boolean)
    .sort();
  const platforms = [...new Set(rows.map((r) => r.platform))].sort();
  return {
    earliest: dates[0] ?? null,
    latest: dates[dates.length - 1] ?? null,
    rowCount: rows.length,
    platforms,
  };
}

/** Group successful rows into per-(keyword,platform) initial→current combos. */
export function computeCombos(rows: RankingRow[]): KeywordSummaryRow[] {
  const ranked = rows.filter(
    (r) => r.status === "success" && r.rankingPosition !== null,
  );
  const groups = new Map<string, RankingRow[]>();
  for (const r of ranked) {
    // Distinct proxy locations are distinct sessions — keep them separate so a
    // combo's initial→current change is never measured across two locations.
    const key = `${r.keywordId}::${r.platform}::${r.searchAddress ?? ""}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }
  const combos: KeywordSummaryRow[] = [];
  for (const [, arr] of groups) {
    const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const change =
      first.rankingPosition !== null && last.rankingPosition !== null
        ? first.rankingPosition - last.rankingPosition
        : null;
    combos.push({
      keywordId: first.keywordId,
      keywordText: `${first.keyword} · ${first.platform}`,
      initialDate: first.date,
      initialPosition: first.rankingPosition,
      currentDate: last.date,
      currentPosition: last.rankingPosition,
      change,
    });
  }
  return combos;
}

export function computeSummary(rows: RankingRow[]): SummaryBlock {
  const combos = computeCombos(rows);
  const currents = combos
    .map((c) => c.currentPosition)
    .filter((p): p is number => p !== null);
  const avg =
    currents.length > 0
      ? Math.round(
          (currents.reduce((a, b) => a + b, 0) / currents.length) * 10,
        ) / 10
      : null;
  return {
    keywords: combos,
    totalKeywords: combos.length,
    topThreeCount: combos.filter(
      (c) => c.currentPosition !== null && c.currentPosition <= TOP_N,
    ).length,
    improvedCount: combos.filter((c) => (c.change ?? 0) > 0).length,
    declinedCount: combos.filter((c) => (c.change ?? 0) < 0).length,
    steadyCount: combos.filter((c) => c.change === 0).length,
    avgCurrentPosition: avg,
  };
}

export function computePlatformStats(rows: RankingRow[]): PlatformStat[] {
  const combos = computeCombos(rows);
  const platforms = [...new Set(rows.map((r) => r.platform))];
  const stats: PlatformStat[] = [];
  for (const platform of platforms) {
    const platformRows = rows.filter((r) => r.platform === platform);
    const platformCombos = computeCombos(platformRows);
    const currents = platformCombos
      .map((c) => c.currentPosition)
      .filter((p): p is number => p !== null);
    stats.push({
      platform,
      avgPosition:
        currents.length > 0
          ? Math.round(
              (currents.reduce((a, b) => a + b, 0) / currents.length) * 10,
            ) / 10
          : null,
      count: platformCombos.length,
      topThreeCount: platformCombos.filter(
        (c) => c.currentPosition !== null && c.currentPosition <= TOP_N,
      ).length,
    });
  }
  return stats.sort((a, b) => a.platform.localeCompare(b.platform));
}

export function computeMovers(rows: RankingRow[]): KeywordSummaryRow[] {
  return computeCombos(rows)
    .filter((c) => c.change !== null)
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
}

/** Distinct keyword texts (case-insensitive) matching a free-text reference. */
export function findMatchingKeywords(
  rows: RankingRow[],
  text: string,
): string[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [];
  const matches = new Set<string>();
  for (const r of rows) {
    const k = r.keyword.toLowerCase();
    if (k === needle || k.includes(needle) || needle.includes(k)) {
      matches.add(r.keyword);
    }
  }
  return [...matches];
}

/* ── scoped fetch helpers ──────────────────────────────────────────────── */

function scopeQuery(scope: ChatScope): string {
  const parts = [`clientId=${scope.clientId}`];
  if (scope.businessId !== null) parts.push(`businessId=${scope.businessId}`);
  if (scope.aeoPlanId !== null) parts.push(`aeoPlanId=${scope.aeoPlanId}`);
  return parts.join("&");
}

async function fetchRankingRows(
  scope: ChatScope,
  window: { from?: string; to?: string },
  deps: DataDeps,
): Promise<RankingRow[]> {
  const params = [scopeQuery(scope), "status=success", "limit=5000"];
  if (window.from) params.push(`dateFrom=${window.from}`);
  if (window.to) params.push(`dateTo=${window.to}`);
  const json = await deps.getJson(`/api/ranking-reports?${params.join("&")}`);
  const data =
    json &&
    typeof json === "object" &&
    Array.isArray((json as { data?: unknown }).data)
      ? (json as { data: unknown[] }).data
      : Array.isArray(json)
        ? json
        : [];
  return data.map(toRankingRow).filter((r): r is RankingRow => r !== null);
}

function emptyDataset(intent: Intent, scope: ChatScope): Dataset {
  return {
    intentKind: intent.kind,
    scope,
    coverage: { earliest: null, latest: null, rowCount: 0, platforms: [] },
    isEmpty: true,
  };
}

/**
 * Fetch and assemble the `Dataset` for a resolved intent. Returns a
 * clarification instead when a keyword reference is ambiguous (multiple
 * matches) — the pipeline asks rather than picking one.
 */
export async function fetchDataset(
  intent: Intent,
  scope: ChatScope,
  deps: DataDeps,
): Promise<FetchResult> {
  const window = resolveTimeframe(intent.params.timeframe, deps.today);

  if (intent.kind === "keyword_list") {
    const json = await deps.getJson(`/api/keywords?${scopeQuery(scope)}`);
    const arr = Array.isArray(json) ? json : [];
    const keywordList = arr
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const o = raw as Record<string, unknown>;
        const keywordId = Number(o.id);
        const keywordText =
          typeof o.keywordText === "string" ? o.keywordText : "";
        if (!Number.isFinite(keywordId) || !keywordText) return null;
        return {
          keywordId,
          keywordText,
          isActive: o.isActive !== false,
          status: typeof o.status === "string" ? o.status : "unknown",
        };
      })
      .filter((k): k is NonNullable<typeof k> => k !== null);
    return {
      kind: "data",
      dataset: {
        intentKind: intent.kind,
        scope,
        coverage: {
          earliest: null,
          latest: null,
          rowCount: keywordList.length,
          platforms: [],
        },
        keywordList,
        isEmpty: keywordList.length === 0,
      },
    };
  }

  const rows = await fetchRankingRows(scope, window, deps);

  if (intent.kind === "rank_trend") {
    const kw = intent.params.keyword ?? "";
    const matches = findMatchingKeywords(rows, kw);
    if (matches.length > 1) {
      return {
        kind: "clarify",
        clarification: {
          kind: "entity",
          question: `More than one keyword matches "${kw}". Which one?`,
          options: matches.slice(0, 8).map((m) => ({ value: m, label: m })),
        },
      };
    }
    const chosen = matches[0] ?? kw;
    let series = rows.filter(
      (r) => r.keyword.toLowerCase() === chosen.toLowerCase(),
    );
    if (intent.params.platform) {
      series = series.filter((r) => r.platform === intent.params.platform);
    }
    series = [...series].sort((a, b) => a.date.localeCompare(b.date));
    if (series.length === 0)
      return { kind: "data", dataset: emptyDataset(intent, scope) };
    return {
      kind: "data",
      dataset: {
        intentKind: intent.kind,
        scope,
        coverage: computeCoverage(series),
        series,
        isEmpty: false,
      },
    };
  }

  if (rows.length === 0)
    return { kind: "data", dataset: emptyDataset(intent, scope) };

  if (intent.kind === "platform_comparison") {
    return {
      kind: "data",
      dataset: {
        intentKind: intent.kind,
        scope,
        coverage: computeCoverage(rows),
        platformStats: computePlatformStats(rows),
        isEmpty: false,
      },
    };
  }

  if (intent.kind === "top_movers") {
    const movers = computeMovers(rows);
    return {
      kind: "data",
      dataset: {
        intentKind: intent.kind,
        scope,
        coverage: computeCoverage(rows),
        movers,
        isEmpty: movers.length === 0,
      },
    };
  }

  // business_summary (default analytical answer)
  return {
    kind: "data",
    dataset: {
      intentKind: "business_summary",
      scope,
      coverage: computeCoverage(rows),
      summary: computeSummary(rows),
      platformStats: computePlatformStats(rows),
      series: rows,
      movers: computeMovers(rows).slice(0, 8),
      isEmpty: false,
    },
  };
}
