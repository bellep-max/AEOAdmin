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
import { Button } from "@/components/ui/button";
import { rawFetch } from "@/lib/period-comparison";
import { BarChart3, Building2, X, Download, FileDown } from "lucide-react";
import {
  ExportBiWeeklyDialog,
  type BiWeeklyExportValue,
} from "@/components/ExportBiWeeklyDialog";
import { exportBiWeeklyCSV, exportBiWeeklyPDF } from "@/lib/bi-weekly-export";
import type { BiWeeklyReport } from "@/components/BiWeeklyReportTab";

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
  const [exportMode, setExportMode] = useState<"csv" | "pdf" | null>(null);

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-slate-300 font-semibold"
            onClick={() => setExportMode("csv")}
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-red-300 text-red-600 hover:text-red-700 hover:bg-red-50 font-semibold"
            onClick={() => setExportMode("pdf")}
          >
            <FileDown className="w-3.5 h-3.5" /> PDF
          </Button>
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

      {selectedClientId === null ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-center">
          <Building2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm font-medium">
            Select a client to view the bi-weekly report
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            The report loads per client to keep it fast — pick a client above to
            begin.
          </p>
        </div>
      ) : (
        <BiWeeklyReportTab
          clientId={selectedClientId}
          businessId={selectedBusinessId}
          aeoPlanId={selectedCampaignId}
        />
      )}

      {exportMode && (
        <ExportBiWeeklyDialog
          open={!!exportMode}
          onOpenChange={(o) => {
            if (!o) setExportMode(null);
          }}
          mode={exportMode}
          defaults={{
            clientId: selectedClientId,
            businessId: selectedBusinessId,
            aeoPlanId: selectedCampaignId,
          }}
          clients={allClients ?? []}
          businesses={allBusinesses ?? []}
          plans={allPlans ?? []}
          onConfirm={(v: BiWeeklyExportValue, report: BiWeeklyReport) => {
            const filters = {
              clientName:
                v.clientId === null
                  ? null
                  : ((allClients ?? []).find((c) => c.id === v.clientId)
                      ?.businessName ?? null),
              businessName:
                v.businessId === null
                  ? null
                  : ((allBusinesses ?? []).find((b) => b.id === v.businessId)
                      ?.name ?? null),
              campaignName:
                v.aeoPlanId === null
                  ? null
                  : ((allPlans ?? []).find((p) => p.id === v.aeoPlanId)?.name ??
                    null),
            };
            if (exportMode === "csv") {
              exportBiWeeklyCSV(report, filters);
            } else {
              exportBiWeeklyPDF(report, filters);
            }
          }}
        />
      )}
    </div>
  );
}
