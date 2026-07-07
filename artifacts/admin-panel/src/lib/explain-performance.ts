import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  usePeriodComparison,
  summarizeProgress,
  sortMovers,
  aggregatePlatforms,
  rawFetch,
  type KeywordProgress,
} from "@/lib/period-comparison";

export type Level = "client" | "business" | "campaign";

/** One plain-English blurb per dashboard component. Keys match the backend. */
export interface ExplainSections {
  overall: string;
  trend: string;
  movers: string;
  platforms: string;
}

export type ExplainSection = keyof ExplainSections;

export function levelFromIds(
  clientId: number | null,
  businessId: number | null,
  aeoPlanId: number | null,
): Level {
  if (aeoPlanId != null) return "campaign";
  if (businessId != null) return "business";
  return "client";
}

interface ExplainMover {
  keyword: string;
  first: number | null;
  current: number | null;
  delta: number;
}

interface ExplainPayload {
  level: Level;
  name: string;
  metrics: {
    tracked: number;
    withRank: number;
    top3: number;
    improved: number;
    declined: number;
    steady: number;
    avgFirst: number | null;
    avgCurrent: number | null;
  };
  platforms: {
    platform: string;
    avgCurrent: number | null;
    top3: number;
    tracked: number;
  }[];
  movers: ExplainMover[];
  decliners: ExplainMover[];
}

const toMover = (k: KeywordProgress): ExplainMover => ({
  keyword: k.keywordText,
  first: k.firstBest,
  current: k.currentBest,
  delta: k.improvement as number,
});

export interface ExplainScope {
  name: string | null | undefined;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

/** Fetches the per-section AI explanations for a scope. The payload is derived
 *  from the SAME period-comparison rows the cards render, so the wording always
 *  matches the numbers. react-query dedups: every AIExplain on the page (overall,
 *  trend, movers, platforms) shares one network call. */
export function useExplainPerformance(scope: ExplainScope) {
  const { clientId, businessId, aeoPlanId } = scope;
  const { data } = usePeriodComparison({
    period: "lifetime",
    clientId,
    businessId,
    aeoPlanId,
  });

  const payload = useMemo<ExplainPayload | null>(() => {
    const rows = data?.rows ?? [];
    if (rows.length === 0) return null;
    const s = summarizeProgress(rows);
    if (s.withRank === 0) return null;
    const movers = sortMovers(s.keywords);
    return {
      level: levelFromIds(clientId, businessId, aeoPlanId),
      name: scope.name ?? "",
      metrics: {
        tracked: s.keywords.length,
        withRank: s.withRank,
        top3: s.inTop3,
        improved: s.improved,
        declined: s.declined,
        steady: s.steady,
        avgFirst: s.avgFirst,
        avgCurrent: s.avgCurrent,
      },
      platforms: aggregatePlatforms(rows).map((p) => ({
        platform: p.platform,
        avgCurrent: p.avgCurrent,
        top3: p.topRank,
        tracked: p.keywordCount,
      })),
      movers: movers
        .filter((k) => (k.improvement as number) > 0)
        .slice(0, 5)
        .map(toMover),
      decliners: s.keywords
        .filter((k) => k.improvement != null && k.improvement < 0)
        .sort((a, b) => (a.improvement as number) - (b.improvement as number))
        .slice(0, 3)
        .map(toMover),
    };
  }, [data, clientId, businessId, aeoPlanId, scope.name]);

  const query = useQuery<{ sections: ExplainSections; cached: boolean }>({
    queryKey: ["/api/llm/explain-performance", payload],
    enabled: payload != null,
    staleTime: 6 * 60 * 60 * 1000,
    queryFn: async () => {
      const res = await rawFetch("/api/llm/explain-performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to generate explanation");
      return res.json();
    },
  });

  return { ...query, hasData: payload != null };
}
