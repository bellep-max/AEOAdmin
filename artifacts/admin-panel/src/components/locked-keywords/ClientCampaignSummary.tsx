import { useQuery } from "@tanstack/react-query";
import { Building2, Lock, Unlock as UnlockIcon, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { rawFetch } from "@/lib/api-fetch";
import { needsAttention } from "./AttentionQueue";
import { PLATFORM_LABELS, type LockedKeywordRecord, type Platform } from "./types";
import type { LockedKeywordFilters } from "./LockedKeywordFilterBar";

const PLATFORMS: Platform[] = ["chatgpt", "gemini", "perplexity"];

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">{icon}</div>
      <div>
        <p className="text-lg font-bold leading-tight tabular-nums">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function ClientCampaignSummary({
  filters,
  lockedRecords,
}: {
  filters: LockedKeywordFilters;
  lockedRecords: LockedKeywordRecord[];
}) {
  const hasClient = !!filters.clientId;

  // Same query keys LockedKeywordFilterBar.tsx already uses — React Query
  // dedupes identical keys, so this reuses the filter bar's cached data
  // instead of firing a second network request for the same names.
  const { data: clients = [] } = useQuery({
    queryKey: ["lk-filter-clients"],
    enabled: hasClient,
    queryFn: async () => {
      const r = await rawFetch("/api/clients?status=active&limit=200");
      const b = await r.json();
      return (b.data ?? b) as { id: number; businessName: string }[];
    },
  });
  const { data: businesses = [] } = useQuery({
    queryKey: ["lk-filter-businesses", filters.clientId],
    enabled: hasClient,
    queryFn: async () => {
      const r = await rawFetch(`/api/businesses?clientId=${filters.clientId}`);
      const b = await r.json();
      return (b.data ?? b) as { id: number; name: string }[];
    },
  });
  const { data: campaigns = [] } = useQuery({
    queryKey: ["lk-filter-campaigns", filters.clientId, filters.businessId],
    enabled: hasClient && !!filters.aeoPlanId,
    queryFn: async () => {
      const params = filters.businessId ? `?businessId=${filters.businessId}` : "";
      const r = await rawFetch(`/api/clients/${filters.clientId}/aeo-plans${params}`);
      const b = await r.json();
      return (b.data ?? b) as { id: number; name: string | null; planType: string }[];
    },
  });

  // Active (non-locked) keyword count in the same scope. GET /api/keywords
  // without status=locked/includeLocked already excludes locked rows by
  // default, so the response length is exactly "active keywords in scope."
  const { data: activeKeywords = [] } = useQuery({
    queryKey: ["lk-active-keyword-count", filters.clientId, filters.businessId, filters.aeoPlanId],
    enabled: hasClient,
    queryFn: async () => {
      const params = new URLSearchParams({ clientId: filters.clientId });
      if (filters.businessId) params.set("businessId", filters.businessId);
      if (filters.aeoPlanId) params.set("aeoPlanId", filters.aeoPlanId);
      const r = await rawFetch(`/api/keywords?${params}`);
      const b = await r.json();
      return (b.data ?? b) as unknown[];
    },
  });

  if (!hasClient) return null;

  const client = clients.find((c) => String(c.id) === filters.clientId);
  const business = businesses.find((b) => String(b.id) === filters.businessId);
  const campaign = campaigns.find((c) => String(c.id) === filters.aeoPlanId);

  const title = campaign ? (campaign.name ?? campaign.planType) : client?.businessName ?? "—";
  const subtitle = campaign
    ? [business?.name, client?.businessName].filter(Boolean).join(" · ")
    : filters.businessId
      ? business?.name ?? "All campaigns"
      : "All campaigns";

  const attentionCount = lockedRecords.filter(needsAttention).length;

  const coverage = PLATFORMS.map((platform) => {
    if (lockedRecords.length === 0) return { platform, pct: null };
    const checked = lockedRecords.filter((r) => r.platformChecks.find((p) => p.platform === platform)?.checkedInCycle).length;
    return { platform, pct: Math.round((checked / lockedRecords.length) * 100) };
  });

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3 min-w-[200px]">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">{title}</p>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <Stat icon={<UnlockIcon className="w-4 h-4 text-amber-600" />} label="Active keywords" value={activeKeywords.length} />
            <Stat icon={<Lock className="w-4 h-4 text-emerald-600" />} label="Locked keywords" value={lockedRecords.length} />
            <Stat icon={<AlertTriangle className="w-4 h-4 text-destructive" />} label="Need attention" value={attentionCount} />
          </div>

          <div className="flex items-center gap-4">
            {lockedRecords.length === 0 ? (
              <p className="text-xs text-muted-foreground">No locked keywords in this scope yet</p>
            ) : (
              coverage.map((c) => (
                <div key={c.platform} className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{PLATFORM_LABELS[c.platform]}</p>
                  <p className="text-sm font-bold tabular-nums">{c.pct}%</p>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
