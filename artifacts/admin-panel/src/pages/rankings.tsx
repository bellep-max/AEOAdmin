import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BarChart3, Building2, X } from "lucide-react";
import { RankingRunBanner } from "@/components/RankingRunBanner";
import { PeriodOverview } from "@/components/PeriodOverview";
import { PeriodByClientTab } from "@/components/PeriodByClientTab";
import { PeriodByBusinessTab } from "@/components/PeriodByBusinessTab";
import { PeriodByPlatformTab } from "@/components/PeriodByPlatformTab";
import { rawFetch, periodLabel, type Period } from "@/lib/period-comparison";

interface ClientRow {
  id: number;
  businessName: string;
}

interface BusinessRow {
  id: number;
  clientId: number;
  name: string;
}

interface PlanRow {
  id: number;
  clientId: number;
  businessId: number | null;
  name: string | null;
  planType: string;
}

type CompareMode = "period" | "lifetime";

export default function Rankings() {
  const [compareMode, setCompareMode] = useState<CompareMode>("period");
  const [period, setPeriod] = useState<Period>("weekly");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  const effectivePeriod: Period = compareMode === "lifetime" ? "lifetime" : period;

  const { data: allClients } = useQuery<ClientRow[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await rawFetch("/api/clients");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: allBusinesses } = useQuery<BusinessRow[]>({
    queryKey: ["/api/businesses"],
    queryFn: async () => {
      const res = await rawFetch("/api/businesses");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: allPlans } = useQuery<PlanRow[]>({
    queryKey: ["/api/aeo-plans"],
    queryFn: async () => {
      const res = await rawFetch("/api/aeo-plans");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const bizScope = (allBusinesses ?? []).filter((b) => selectedClientId === null || b.clientId === selectedClientId);
  const planScope = (allPlans ?? []).filter(
    (p) =>
      (selectedClientId === null || p.clientId === selectedClientId) &&
      (selectedBusinessId === null || p.businessId === selectedBusinessId)
  );

  const filtersActive = selectedClientId !== null || selectedBusinessId !== null || selectedCampaignId !== null;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rankings</h1>
          <p className="text-sm text-muted-foreground">{periodLabel(effectivePeriod).long}</p>
        </div>
      </div>

      {/* Weekly run banner */}
      <RankingRunBanner />

      {/* Cascade filter */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3">
        <Building2 className="w-5 h-5 text-slate-600 dark:text-slate-400 flex-shrink-0 ml-1" />
        <Select
          value={selectedClientId !== null ? String(selectedClientId) : "all"}
          onValueChange={(v) => {
            const next = v === "all" ? null : Number(v);
            setSelectedClientId(next);
            setSelectedBusinessId(null);
            setSelectedCampaignId(null);
          }}
        >
          <SelectTrigger className="w-56 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 h-10 text-sm font-semibold">
            <SelectValue placeholder="All Clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {(allClients ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.businessName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-slate-400">›</span>
        <Select
          value={selectedBusinessId !== null ? String(selectedBusinessId) : "all"}
          onValueChange={(v) => {
            const next = v === "all" ? null : Number(v);
            setSelectedBusinessId(next);
            setSelectedCampaignId(null);
          }}
          disabled={bizScope.length === 0}
        >
          <SelectTrigger className="w-56 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 h-10 text-sm font-semibold">
            <SelectValue placeholder="All Businesses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Businesses</SelectItem>
            {bizScope.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-slate-400">›</span>
        <Select
          value={selectedCampaignId !== null ? String(selectedCampaignId) : "all"}
          onValueChange={(v) => setSelectedCampaignId(v === "all" ? null : Number(v))}
          disabled={planScope.length === 0}
        >
          <SelectTrigger className="w-64 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 h-10 text-sm font-semibold">
            <SelectValue placeholder="All Campaigns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Campaigns</SelectItem>
            {planScope.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name ?? p.planType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setSelectedClientId(null);
              setSelectedBusinessId(null);
              setSelectedCampaignId(null);
            }}
            className="flex items-center gap-1.5 ml-auto text-sm text-slate-600 hover:text-slate-900 dark:hover:text-white font-semibold"
          >
            <X className="w-4 h-4" /> Clear filters
          </button>
        )}
      </div>

      {/* Compare mode + period dropdown */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border/50 bg-card/60 p-1">
          <Button
            size="sm"
            variant={compareMode === "period" ? "default" : "ghost"}
            onClick={() => setCompareMode("period")}
            className="h-8"
          >
            Period comparison
          </Button>
          <Button
            size="sm"
            variant={compareMode === "lifetime" ? "default" : "ghost"}
            onClick={() => setCompareMode("lifetime")}
            className="h-8"
          >
            Since start (lifetime)
          </Button>
        </div>
        {compareMode === "period" && (
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Period overview — all three periods at a glance */}
      {compareMode === "period" && (
        <PeriodOverview
          clientId={selectedClientId}
          businessId={selectedBusinessId}
          aeoPlanId={selectedCampaignId}
          activePeriod={period}
          onSelect={(p) => setPeriod(p)}
        />
      )}

      {/* Tabs */}
      <Tabs defaultValue="by-client" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3 bg-card/60">
          <TabsTrigger value="by-client">By Client</TabsTrigger>
          <TabsTrigger value="by-business">By Business</TabsTrigger>
          <TabsTrigger value="by-platform">By Platform</TabsTrigger>
        </TabsList>

        <TabsContent value="by-client" className="mt-4">
          <PeriodByClientTab
            period={effectivePeriod}
            clientId={selectedClientId}
            businessId={selectedBusinessId}
            aeoPlanId={selectedCampaignId}
          />
        </TabsContent>
        <TabsContent value="by-business" className="mt-4">
          <PeriodByBusinessTab
            period={effectivePeriod}
            clientId={selectedClientId}
            businessId={selectedBusinessId}
            aeoPlanId={selectedCampaignId}
          />
        </TabsContent>
        <TabsContent value="by-platform" className="mt-4">
          <PeriodByPlatformTab
            period={effectivePeriod}
            clientId={selectedClientId}
            businessId={selectedBusinessId}
            aeoPlanId={selectedCampaignId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
