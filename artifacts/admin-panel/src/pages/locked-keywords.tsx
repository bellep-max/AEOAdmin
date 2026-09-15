import { useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "wouter";
import { Trophy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rawFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import {
  LockedKeywordFilterBar,
  EMPTY_FILTERS,
  type LockedKeywordFilters,
} from "@/components/locked-keywords/LockedKeywordFilterBar";
import { LockedKeywordSummaryCards } from "@/components/locked-keywords/LockedKeywordSummaryCards";
import { ClientCampaignSummary } from "@/components/locked-keywords/ClientCampaignSummary";
import { AttentionQueue } from "@/components/locked-keywords/AttentionQueue";
import { LockedKeywordTable } from "@/components/locked-keywords/LockedKeywordTable";
import { LockedKeywordDetailDrawer } from "@/components/locked-keywords/LockedKeywordDetailDrawer";
import { UnlockConfirmationDialog } from "@/components/locked-keywords/UnlockConfirmationDialog";
import type { LockedKeywordListResponse, LockedKeywordRecord } from "@/components/locked-keywords/types";

function filtersFromParams(params: URLSearchParams): LockedKeywordFilters {
  return {
    clientId: params.get("clientId") ?? "",
    businessId: params.get("businessId") ?? "",
    aeoPlanId: params.get("aeoPlanId") ?? "",
    platform: params.get("platform") ?? "",
    status: params.get("status") ?? "",
    maintenanceLevel: params.get("maintenanceLevel") ?? "",
    search: params.get("search") ?? "",
  };
}

export default function LockedKeywords() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const hasActiveFilters = Object.values(filters).some((v) => v !== "");

  const [sort, setSort] = useState("");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<LockedKeywordRecord | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<{ record: LockedKeywordRecord; suggestedReason?: string } | null>(null);

  const handleFiltersChange = useCallback(
    (next: LockedKeywordFilters) => {
      setPage(1);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
      }
      setSearchParams(params);
    },
    [setSearchParams],
  );

  const queryKey = ["locked-keywords", filters, sort, direction, page, pageSize];
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<LockedKeywordListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      if (sort) {
        params.set("sort", sort);
        params.set("direction", direction);
      }
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const r = await rawFetch(`/api/admin/locked-keywords?${params}`);
      if (!r.ok) throw new Error("Failed to load locked keywords");
      return r.json();
    },
  });

  // The Attention Queue and the Client/Campaign Summary panel both need the
  // *entire* filtered set, not just the current page — fetched once here
  // with a high page size and shared by both, rather than duplicating the
  // list query's filter logic in two places.
  const { data: scopedData } = useQuery<LockedKeywordListResponse>({
    queryKey: ["locked-keywords-attention", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      params.set("page", "1");
      params.set("pageSize", "500");
      const r = await rawFetch(`/api/admin/locked-keywords?${params}`);
      if (!r.ok) throw new Error("Failed to load locked keywords");
      return r.json();
    },
  });

  const handleSortChange = (key: string) => {
    if (sort === key) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDirection("asc");
    }
  };

  const handleUnlocked = () => {
    qc.invalidateQueries({ queryKey: ["locked-keywords"] });
    qc.invalidateQueries({ queryKey: ["locked-keywords-attention"] });
    setSelected(null);
    setUnlockTarget(null);
    toast({ title: "Keyword variant unlocked and returned to active rotation." });
  };

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="w-6 h-6 text-emerald-500" />
            Locked Keyword Monitoring
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review locked variants, platform coverage, retention, and next monitoring checks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && <span className="text-xs text-muted-foreground">Updated {updatedAt}</span>}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <LockedKeywordFilterBar filters={filters} onChange={handleFiltersChange} />

      <ClientCampaignSummary filters={filters} lockedRecords={scopedData?.items ?? []} />

      {data && <LockedKeywordSummaryCards summary={data.summary} />}

      {scopedData && scopedData.items.length > 0 && (
        <AttentionQueue
          records={scopedData.items}
          onReview={setSelected}
          onUnlockClick={(record, suggestedReason) => setUnlockTarget({ record, suggestedReason })}
        />
      )}

      <LockedKeywordTable
        data={data}
        isLoading={isLoading}
        hasActiveFilters={hasActiveFilters}
        sort={sort}
        direction={direction}
        onSortChange={handleSortChange}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRowClick={setSelected}
      />

      <LockedKeywordDetailDrawer
        record={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onUnlockClick={(record) => setUnlockTarget({ record })}
      />

      <UnlockConfirmationDialog
        record={unlockTarget?.record ?? null}
        defaultReason={unlockTarget?.suggestedReason}
        onOpenChange={(open) => !open && setUnlockTarget(null)}
        onUnlocked={handleUnlocked}
      />
    </div>
  );
}
