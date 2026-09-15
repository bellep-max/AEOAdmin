import { useQuery } from "@tanstack/react-query";
import { rawFetch } from "@/lib/period-comparison";

export type SummaryScope = "client" | "business" | "campaign";
export type Comparison = "prior-run" | "all-time";

export interface SummaryMetrics {
  tracked: number;
  withRank: number;
  top3: number;
  improved: number;
  declined: number;
  steady: number;
  avgCurrent: number | null;
  avgFirst: number | null;
}

export interface SummaryPlatform {
  platform: string;
  label: string;
  tracked: number;
  top3: number;
  avgCurrent: number | null;
}

export interface SummaryMover {
  keyword: string;
  first: number | null;
  current: number | null;
}

export interface LockedPlatform {
  platform: string;
  label: string;
  position: number | null;
  reason: string;
}

export interface LockedKeyword {
  keyword: string;
  campaignName: string | null;
  businessName: string | null;
  platforms: LockedPlatform[];
}

export interface WatchKeyword {
  keyword: string;
  latestPosition: number | null;
  stallingSince: string | null;
}

export interface DeclineKeyword {
  keyword: string;
  from: number | null;
  to: number | null;
  reason: string;
}

export interface SummaryReport {
  scope: SummaryScope;
  businessId: number | null;
  aeoPlanId: number | null;
  date: string | null;
  comparison: Comparison;
  metrics: SummaryMetrics;
  platforms: SummaryPlatform[];
  movers: SummaryMover[];
  locked: LockedKeyword[];
  watch: WatchKeyword[];
  declines: DeclineKeyword[];
  glossaryVersion: string;
}

export interface AvailableDate {
  date: string;
  count: number;
}

export interface NarrativeStep {
  title: string;
  body: string;
}

export interface NarrativeSections {
  overall: string;
  trend: string;
  movers: string;
  platforms: string;
  locked: string;
  declines: string;
}

export interface OverviewBlock {
  heading: string;
  body: string;
}

export interface SummaryNarrative {
  overview: OverviewBlock[];
  sections: NarrativeSections;
  howAeoWorks: NarrativeStep[];
  cached: boolean;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export interface Glossary {
  version: string;
  terms: Record<string, GlossaryTerm>;
}

/** The scope inputs the admin Summary Report endpoints share. `date === null`
 *  means all-time; a concrete date means "period ending then" (prior-run). */
export interface SummaryScopeParams {
  clientId: number;
  scope: SummaryScope;
  businessId: number | null;
  aeoPlanId: number | null;
  date: string | null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await rawFetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

function scopeQuery(params: {
  clientId: number;
  scope: SummaryScope;
  businessId: number | null;
  aeoPlanId: number | null;
}): string {
  const qs = new URLSearchParams({
    clientId: String(params.clientId),
    scope: params.scope,
  });
  if (params.businessId != null)
    qs.set("businessId", String(params.businessId));
  if (params.aeoPlanId != null) qs.set("aeoPlanId", String(params.aeoPlanId));
  return qs.toString();
}

export function useGlossary() {
  return useQuery<Glossary>({
    queryKey: ["/api/ranking-reports/glossary"],
    queryFn: () => fetchJson<Glossary>("/api/ranking-reports/glossary"),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useAvailableDates(params: {
  clientId: number;
  scope: SummaryScope;
  businessId: number | null;
  aeoPlanId: number | null;
}) {
  const q = scopeQuery(params);
  return useQuery<{ dates: AvailableDate[] }>({
    queryKey: ["/api/ranking-reports/summary/available-dates", q],
    queryFn: () =>
      fetchJson<{ dates: AvailableDate[] }>(
        `/api/ranking-reports/summary/available-dates?${q}`,
      ),
    enabled: !!params.clientId,
  });
}

export function useSummaryReport(params: SummaryScopeParams) {
  const base = scopeQuery(params);
  const q = params.date ? `${base}&date=${params.date}` : base;
  return useQuery<SummaryReport>({
    queryKey: ["/api/ranking-reports/summary", q],
    queryFn: () =>
      fetchJson<SummaryReport>(`/api/ranking-reports/summary?${q}`),
    enabled: !!params.clientId,
  });
}

export function useSummaryNarrative(params: SummaryScopeParams) {
  const base = scopeQuery(params);
  const q = params.date ? `${base}&date=${params.date}` : base;
  return useQuery<SummaryNarrative>({
    queryKey: ["/api/ranking-reports/summary/narrative", q],
    queryFn: () =>
      fetchJson<SummaryNarrative>(
        `/api/ranking-reports/summary/narrative?${q}`,
      ),
    enabled: !!params.clientId,
    staleTime: 60 * 60 * 1000,
  });
}
