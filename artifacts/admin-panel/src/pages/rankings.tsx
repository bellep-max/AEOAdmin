import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BarChart3, Building2, X, Download, FileDown } from "lucide-react";
import { RankingRunBanner } from "@/components/RankingRunBanner";
import { PeriodOverview } from "@/components/PeriodOverview";
import { PeriodByClientTab } from "@/components/PeriodByClientTab";
import { rawFetch, usePeriodComparison, periodLabel, type Period, type PeriodRow } from "@/lib/period-comparison";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

interface PivotRow {
  client: string;
  business: string;
  campaign: string;
  keyword: string;
  chatgptPrev: string; chatgptCurr: string; chatgptChange: string; chatgptStatus: string;
  geminiPrev: string; geminiCurr: string; geminiChange: string; geminiStatus: string;
  perplexityPrev: string; perplexityCurr: string; perplexityChange: string; perplexityStatus: string;
}

function pivotRows(rows: PeriodRow[]): PivotRow[] {
  const byKeyword = new Map<number, { base: PeriodRow; platforms: Map<string, PeriodRow> }>();
  for (const r of rows) {
    let entry = byKeyword.get(r.keywordId);
    if (!entry) { entry = { base: r, platforms: new Map() }; byKeyword.set(r.keywordId, entry); }
    entry.platforms.set(r.platform, r);
  }
  const pos = (n: number | null) => n == null ? "—" : `#${n}`;
  const chg = (n: number | null) => n == null ? "—" : n > 0 ? `+${n}` : String(n);
  return [...byKeyword.values()]
    .sort((a, b) => (a.base.clientName ?? "").localeCompare(b.base.clientName ?? ""))
    .map(({ base, platforms }) => {
      const g = (p: string) => platforms.get(p);
      return {
        client: base.clientName ?? "",
        business: base.businessName ?? "",
        campaign: base.campaignName ?? "",
        keyword: base.keywordText,
        chatgptPrev: pos(g("chatgpt")?.previousPosition ?? null), chatgptCurr: pos(g("chatgpt")?.currentPosition ?? null),
        chatgptChange: chg(g("chatgpt")?.change ?? null), chatgptStatus: g("chatgpt")?.status ?? "—",
        geminiPrev: pos(g("gemini")?.previousPosition ?? null), geminiCurr: pos(g("gemini")?.currentPosition ?? null),
        geminiChange: chg(g("gemini")?.change ?? null), geminiStatus: g("gemini")?.status ?? "—",
        perplexityPrev: pos(g("perplexity")?.previousPosition ?? null), perplexityCurr: pos(g("perplexity")?.currentPosition ?? null),
        perplexityChange: chg(g("perplexity")?.change ?? null), perplexityStatus: g("perplexity")?.status ?? "—",
      };
    });
}

function exportRankingsCSV(rows: PeriodRow[], label: string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const headers = [
    "Client", "Business", "Campaign", "Keyword",
    "ChatGPT Initial", "ChatGPT Current", "ChatGPT Change", "ChatGPT Status",
    "Gemini Initial", "Gemini Current", "Gemini Change", "Gemini Status",
    "Perplexity Initial", "Perplexity Current", "Perplexity Change", "Perplexity Status",
  ];
  const pivoted = pivotRows(rows);
  const lines = pivoted.map((r) => [
    esc(r.client), esc(r.business), esc(r.campaign), esc(r.keyword),
    esc(r.chatgptPrev), esc(r.chatgptCurr), esc(r.chatgptChange), esc(r.chatgptStatus),
    esc(r.geminiPrev), esc(r.geminiCurr), esc(r.geminiChange), esc(r.geminiStatus),
    esc(r.perplexityPrev), esc(r.perplexityCurr), esc(r.perplexityChange), esc(r.perplexityStatus),
  ].join(","));
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `rankings-${label}-${format(new Date(), "yyyy-MM-dd")}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportRankingsPDF(rows: PeriodRow[], label: string, periodTitle: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text("Signal AEO — Rankings Report", 10, 11);
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
  doc.text(periodTitle, 10, 18);
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}`, pageW - 10, 18, { align: "right" });

  const pivoted = pivotRows(rows);
  const grouped = new Map<string, PivotRow[]>();
  for (const r of pivoted) {
    const key = r.client || "Unassigned";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  let startY = 30;
  const footerFn = (data: { pageNumber: number }) => {
    const pages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    doc.setFontSize(6.5); doc.setTextColor(150);
    doc.text(`Signal AEO Admin Panel  ·  Confidential  ·  Page ${data.pageNumber} of ${pages}`, pageW / 2, pageH - 5, { align: "center" });
  };

  grouped.forEach((clientRows, clientName) => {
    if (startY > pageH - 40) { doc.addPage(); startY = 15; }
    doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 100, 220);
    doc.text(clientName, 10, startY);
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(120, 130, 150);
    doc.text(`${clientRows.length} keyword${clientRows.length !== 1 ? "s" : ""}`, 10, startY + 4);
    startY += 9;

    const body = clientRows.map((r) => [
      r.business, r.campaign, r.keyword,
      r.chatgptPrev, r.chatgptCurr, r.chatgptStatus,
      r.geminiPrev, r.geminiCurr, r.geminiStatus,
      r.perplexityPrev, r.perplexityCurr, r.perplexityStatus,
    ]);

    autoTable(doc, {
      startY,
      head: [["Business", "Campaign", "Keyword", "ChatGPT Init", "ChatGPT Curr", "Status", "Gemini Init", "Gemini Curr", "Status", "Perplexity Init", "Perplexity Curr", "Status"]],
      body,
      theme: "striped",
      headStyles: { fillColor: [17, 24, 39], textColor: [180, 200, 230], fontSize: 6.5, fontStyle: "bold", cellPadding: 2 },
      bodyStyles: { fontSize: 6.5, cellPadding: 1.5, textColor: [30, 30, 50] },
      alternateRowStyles: { fillColor: [245, 247, 252] },
      columnStyles: {
        0: { cellWidth: 28 }, 1: { cellWidth: 28 }, 2: { cellWidth: 35, overflow: "linebreak" },
        3: { cellWidth: 16, halign: "center" }, 4: { cellWidth: 16, halign: "center" }, 5: { cellWidth: 16, halign: "center" },
        6: { cellWidth: 16, halign: "center" }, 7: { cellWidth: 16, halign: "center" }, 8: { cellWidth: 16, halign: "center" },
        9: { cellWidth: 20, halign: "center" }, 10: { cellWidth: 20, halign: "center" }, 11: { cellWidth: 20, halign: "center" },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: footerFn,
    });

    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  });

  doc.save(`rankings-${label}-${format(new Date(), "yyyy-MM-dd")}.pdf`);
}

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

  const { data: periodData } = usePeriodComparison({
    period: effectivePeriod,
    clientId: selectedClientId,
    businessId: selectedBusinessId,
    aeoPlanId: selectedCampaignId,
  });

  const label = periodLabel(effectivePeriod);
  const hasRows = (periodData?.rows?.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Rankings</h1>
            <p className="text-sm text-muted-foreground">{label.long}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-slate-300 font-semibold"
            disabled={!hasRows}
            onClick={() => exportRankingsCSV(periodData!.rows, effectivePeriod)}
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-red-300 text-red-600 hover:text-red-700 hover:bg-red-50 font-semibold"
            disabled={!hasRows}
            onClick={() => exportRankingsPDF(periodData!.rows, effectivePeriod, label.long)}
          >
            <FileDown className="w-3.5 h-3.5" /> PDF
          </Button>
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

      {/* Single view — grouped by Client with inline Business · Campaign context */}
      <PeriodByClientTab
        period={effectivePeriod}
        clientId={selectedClientId}
        businessId={selectedBusinessId}
        aeoPlanId={selectedCampaignId}
      />
    </div>
  );
}
