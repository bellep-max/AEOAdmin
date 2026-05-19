import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BiWeeklyReportTab } from "@/components/BiWeeklyReportTab";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rawFetch } from "@/lib/period-comparison";
import { BarChart3, Building2, X } from "lucide-react";

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

export default function RankingsBiWeekly() {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(
    null,
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(
    null,
  );

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

  const byName = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });

  const clientsSorted = [...(allClients ?? [])].sort((a, b) =>
    byName(a.businessName, b.businessName),
  );
  const bizScope = (allBusinesses ?? [])
    .filter((b) => selectedClientId === null || b.clientId === selectedClientId)
    .sort((a, b) => byName(a.name, b.name));
  const planScope = (allPlans ?? [])
    .filter(
      (p) =>
        (selectedClientId === null || p.clientId === selectedClientId) &&
        (selectedBusinessId === null || p.businessId === selectedBusinessId),
    )
    .sort((a, b) => byName(a.name ?? a.planType, b.name ?? b.planType));

  const filtersActive =
    selectedClientId !== null ||
    selectedBusinessId !== null ||
    selectedCampaignId !== null;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Bi-Weekly Report
            </h1>
            <p className="text-sm text-muted-foreground">
              Latest batch · old-file status · ranking trend · client health
              matrix
            </p>
          </div>
        </div>
      </div>

      {/* Scope filter (client → business → campaign) */}
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
            {clientsSorted.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.businessName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-slate-400">›</span>
        <Select
          value={
            selectedBusinessId !== null ? String(selectedBusinessId) : "all"
          }
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
              <SelectItem key={b.id} value={String(b.id)}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-slate-400">›</span>
        <Select
          value={
            selectedCampaignId !== null ? String(selectedCampaignId) : "all"
          }
          onValueChange={(v) =>
            setSelectedCampaignId(v === "all" ? null : Number(v))
          }
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

      <BiWeeklyReportTab
        clientId={selectedClientId}
        businessId={selectedBusinessId}
        aeoPlanId={selectedCampaignId}
      />
    </div>
  );
}
