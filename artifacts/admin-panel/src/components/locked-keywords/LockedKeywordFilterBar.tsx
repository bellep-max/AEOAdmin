import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rawFetch } from "@/lib/api-fetch";

export interface LockedKeywordFilters {
  clientId: string;
  businessId: string;
  aeoPlanId: string;
  platform: string;
  status: string;
  maintenanceLevel: string;
  search: string;
}

export const EMPTY_FILTERS: LockedKeywordFilters = {
  clientId: "",
  businessId: "",
  aeoPlanId: "",
  platform: "",
  status: "",
  maintenanceLevel: "",
  search: "",
};

function countActive(f: LockedKeywordFilters): number {
  return Object.values(f).filter((v) => v !== "").length;
}

export function LockedKeywordFilterBar({
  filters,
  onChange,
}: {
  filters: LockedKeywordFilters;
  onChange: (next: LockedKeywordFilters) => void;
}) {
  const { data: clients = [] } = useQuery({
    queryKey: ["lk-filter-clients"],
    queryFn: async () => {
      const r = await rawFetch("/api/clients?status=active&limit=200");
      const b = await r.json();
      return (b.data ?? b) as { id: number; businessName: string }[];
    },
  });

  const { data: businesses = [] } = useQuery({
    queryKey: ["lk-filter-businesses", filters.clientId],
    enabled: !!filters.clientId,
    queryFn: async () => {
      const r = await rawFetch(`/api/businesses?clientId=${filters.clientId}`);
      const b = await r.json();
      return (b.data ?? b) as { id: number; name: string }[];
    },
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ["lk-filter-campaigns", filters.clientId, filters.businessId],
    enabled: !!filters.clientId,
    queryFn: async () => {
      const params = filters.businessId ? `?businessId=${filters.businessId}` : "";
      const r = await rawFetch(`/api/clients/${filters.clientId}/aeo-plans${params}`);
      const b = await r.json();
      return (b.data ?? b) as { id: number; name: string | null; planType: string }[];
    },
  });

  const set = <K extends keyof LockedKeywordFilters>(key: K, value: string) => {
    const next = { ...filters, [key]: value };
    if (key === "clientId") {
      next.businessId = "";
      next.aeoPlanId = "";
    }
    if (key === "businessId") {
      next.aeoPlanId = "";
    }
    onChange(next);
  };

  const activeCount = countActive(filters);

  return (
    <Card className="sticky top-0 z-10">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search keyword, client, business…"
              value={filters.search}
              onChange={(e) => set("search", e.target.value)}
              className="pl-8 h-9"
            />
          </div>

          <Select value={filters.clientId || "all"} onValueChange={(v) => set("clientId", v === "all" ? "" : v)}>
            <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All clients" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.businessName}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select
            value={filters.businessId || "all"}
            onValueChange={(v) => set("businessId", v === "all" ? "" : v)}
            disabled={!filters.clientId}
          >
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All businesses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All businesses</SelectItem>
              {businesses.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select
            value={filters.aeoPlanId || "all"}
            onValueChange={(v) => set("aeoPlanId", v === "all" ? "" : v)}
            disabled={!filters.clientId}
          >
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All campaigns" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name ?? c.planType}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.platform || "all"} onValueChange={(v) => set("platform", v === "all" ? "" : v)}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All platforms" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              <SelectItem value="chatgpt">ChatGPT</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
              <SelectItem value="perplexity">Perplexity</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.status || "all"} onValueChange={(v) => set("status", v === "all" ? "" : v)}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="healthy">Healthy</SelectItem>
              <SelectItem value="monitor">Monitor</SelectItem>
              <SelectItem value="unlock_recommended">Unlock Recommended</SelectItem>
              <SelectItem value="unlock_now">Unlock Now</SelectItem>
              <SelectItem value="insufficient_data">Insufficient Data</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.maintenanceLevel || "all"} onValueChange={(v) => set("maintenanceLevel", v === "all" ? "" : v)}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All maintenance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All maintenance</SelectItem>
              <SelectItem value="minimum">Minimum</SelectItem>
              <SelectItem value="recommended">Recommended</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1" onClick={() => onChange(EMPTY_FILTERS)}>
              <X className="w-3.5 h-3.5" />
              Clear filters ({activeCount})
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
