import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Building2,
  X,
  Download,
  FileDown,
  GitCompare,
} from "lucide-react";
import { RankingRunBanner } from "@/components/RankingRunBanner";
import { PeriodOverview } from "@/components/PeriodOverview";
import { PeriodByClientTab } from "@/components/PeriodByClientTab";
import {
  rawFetch,
  usePeriodComparison,
  periodLabel,
  fmtDayET,
  fmtIsoDateET,
  fmtDateTimeET,
  type Period,
  type PeriodRow,
} from "@/lib/period-comparison";
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
  chatgptFirst: string;
  chatgptFirstDate: string;
  chatgptPrev: string;
  chatgptPrevDate: string;
  chatgptCurr: string;
  chatgptCurrDate: string;
  chatgptChange: string;
  chatgptStatus: string;
  geminiFirst: string;
  geminiFirstDate: string;
  geminiPrev: string;
  geminiPrevDate: string;
  geminiCurr: string;
  geminiCurrDate: string;
  geminiChange: string;
  geminiStatus: string;
  perplexityFirst: string;
  perplexityFirstDate: string;
  perplexityPrev: string;
  perplexityPrevDate: string;
  perplexityCurr: string;
  perplexityCurrDate: string;
  perplexityChange: string;
  perplexityStatus: string;
}

/* Loose "has comparison" rule: keep all rows of a keyword if AT LEAST ONE
   platform has a prior rank. Drops keywords that are 100% new everywhere. */
function filterComparisonOnly(rows: PeriodRow[]): PeriodRow[] {
  const keywordsWithPrev = new Set<number>();
  for (const r of rows) {
    if (r.previousPosition != null) keywordsWithPrev.add(r.keywordId);
  }
  return rows.filter((r) => keywordsWithPrev.has(r.keywordId));
}

function pivotRows(rows: PeriodRow[]): PivotRow[] {
  const byKeyword = new Map<
    number,
    { base: PeriodRow; platforms: Map<string, PeriodRow> }
  >();
  for (const r of rows) {
    let entry = byKeyword.get(r.keywordId);
    if (!entry) {
      entry = { base: r, platforms: new Map() };
      byKeyword.set(r.keywordId, entry);
    }
    entry.platforms.set(r.platform.toLowerCase(), r);
  }
  const pos = (n: number | null) => (n == null ? "—" : `#${n}`);
  const chg = (n: number | null) =>
    n == null ? "—" : n > 0 ? `+${n}` : String(n);
  const dt = (s: string | null | undefined) => fmtDayET(s);
  return [...byKeyword.values()]
    .sort((a, b) =>
      (a.base.clientName ?? "").localeCompare(b.base.clientName ?? ""),
    )
    .map(({ base, platforms }) => {
      const g = (p: string) => platforms.get(p);
      return {
        client: base.clientName ?? "",
        business: base.businessName ?? "",
        campaign: base.campaignName ?? "",
        keyword: base.keywordText,
        chatgptFirst: pos(g("chatgpt")?.firstPosition ?? null),
        chatgptFirstDate: dt(g("chatgpt")?.firstDate),
        chatgptPrev: pos(g("chatgpt")?.previousPosition ?? null),
        chatgptPrevDate: dt(g("chatgpt")?.previousDate),
        chatgptCurr: pos(g("chatgpt")?.currentPosition ?? null),
        chatgptCurrDate: dt(g("chatgpt")?.currentDate),
        chatgptChange: chg(g("chatgpt")?.change ?? null),
        chatgptStatus: g("chatgpt")?.status ?? "—",
        geminiFirst: pos(g("gemini")?.firstPosition ?? null),
        geminiFirstDate: dt(g("gemini")?.firstDate),
        geminiPrev: pos(g("gemini")?.previousPosition ?? null),
        geminiPrevDate: dt(g("gemini")?.previousDate),
        geminiCurr: pos(g("gemini")?.currentPosition ?? null),
        geminiCurrDate: dt(g("gemini")?.currentDate),
        geminiChange: chg(g("gemini")?.change ?? null),
        geminiStatus: g("gemini")?.status ?? "—",
        perplexityFirst: pos(g("perplexity")?.firstPosition ?? null),
        perplexityFirstDate: dt(g("perplexity")?.firstDate),
        perplexityPrev: pos(g("perplexity")?.previousPosition ?? null),
        perplexityPrevDate: dt(g("perplexity")?.previousDate),
        perplexityCurr: pos(g("perplexity")?.currentPosition ?? null),
        perplexityCurrDate: dt(g("perplexity")?.currentDate),
        perplexityChange: chg(g("perplexity")?.change ?? null),
        perplexityStatus: g("perplexity")?.status ?? "—",
      };
    });
}

interface PeriodWindow {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
}

function fmtRange(start: string, end: string): string {
  const s = fmtDayET(start);
  const e = fmtDayET(end);
  return s === e ? s : `${s} – ${e}`;
}

function buildSubtitle(label: string, window: PeriodWindow | null): string {
  if (!window) return label;
  const cur = fmtRange(window.currentStart, window.currentEnd);
  const prev = fmtRange(window.previousStart, window.previousEnd);
  return `${label} · Current: ${cur} · Compared with: ${prev}`;
}

function exportRankingsCSV(
  rows: PeriodRow[],
  label: string,
  window: PeriodWindow | null,
) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const headers = [
    "Client",
    "Business",
    "Campaign",
    "Keyword",
    "ChatGPT First",
    "ChatGPT First Date",
    "ChatGPT Previous",
    "ChatGPT Previous Date",
    "ChatGPT Current",
    "ChatGPT Current Date",
    "ChatGPT Change",
    "ChatGPT Status",
    "Gemini First",
    "Gemini First Date",
    "Gemini Previous",
    "Gemini Previous Date",
    "Gemini Current",
    "Gemini Current Date",
    "Gemini Change",
    "Gemini Status",
    "Perplexity First",
    "Perplexity First Date",
    "Perplexity Previous",
    "Perplexity Previous Date",
    "Perplexity Current",
    "Perplexity Current Date",
    "Perplexity Change",
    "Perplexity Status",
  ];
  const pivoted = pivotRows(rows);
  const lines = pivoted.map((r) =>
    [
      esc(r.client),
      esc(r.business),
      esc(r.campaign),
      esc(r.keyword),
      esc(r.chatgptFirst),
      esc(r.chatgptFirstDate),
      esc(r.chatgptPrev),
      esc(r.chatgptPrevDate),
      esc(r.chatgptCurr),
      esc(r.chatgptCurrDate),
      esc(r.chatgptChange),
      esc(r.chatgptStatus),
      esc(r.geminiFirst),
      esc(r.geminiFirstDate),
      esc(r.geminiPrev),
      esc(r.geminiPrevDate),
      esc(r.geminiCurr),
      esc(r.geminiCurrDate),
      esc(r.geminiChange),
      esc(r.geminiStatus),
      esc(r.perplexityFirst),
      esc(r.perplexityFirstDate),
      esc(r.perplexityPrev),
      esc(r.perplexityPrevDate),
      esc(r.perplexityCurr),
      esc(r.perplexityCurrDate),
      esc(r.perplexityChange),
      esc(r.perplexityStatus),
    ].join(","),
  );
  /* Two metadata rows above the header so Mary can see the comparison
     period in Excel without parsing the filename. Spreadsheets render
     them as plain rows in column A; auto-filter still works on the
     header row at line 3. */
  const subtitle = buildSubtitle(label, window);
  const generated = `Generated ${fmtDateTimeET(new Date())} ET`;
  const meta = [esc(`Rankings — ${subtitle}`), esc(generated)];
  const csv = [...meta, "", headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = window
    ? `${window.currentStart}_to_${window.currentEnd}`
    : fmtIsoDateET(new Date());
  a.download = `rankings-${label}-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportRankingsPDF(
  rows: PeriodRow[],
  label: string,
  periodTitle: string,
  window: PeriodWindow | null,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Signal AEO — Rankings Report", 10, 11);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text(buildSubtitle(periodTitle, window), 10, 18);
  doc.text(`Generated: ${fmtDateTimeET(new Date())} ET`, pageW - 10, 18, {
    align: "right",
  });

  const pivoted = pivotRows(rows);
  const grouped = new Map<string, PivotRow[]>();
  for (const r of pivoted) {
    const key = r.client || "Unassigned";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  let startY = 30;
  const footerFn = (data: { pageNumber: number }) => {
    const pages = (
      doc as unknown as { internal: { getNumberOfPages: () => number } }
    ).internal.getNumberOfPages();
    doc.setFontSize(6.5);
    doc.setTextColor(150);
    doc.text(
      `Signal AEO Admin Panel  ·  Confidential  ·  Page ${data.pageNumber} of ${pages}`,
      pageW / 2,
      pageH - 5,
      { align: "center" },
    );
  };

  grouped.forEach((clientRows, clientName) => {
    if (startY > pageH - 40) {
      doc.addPage();
      startY = 15;
    }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 100, 220);
    doc.text(clientName, 10, startY);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 130, 150);
    doc.text(
      `${clientRows.length} keyword${clientRows.length !== 1 ? "s" : ""}`,
      10,
      startY + 4,
    );
    startY += 9;

    const body = clientRows.map((r) => [
      r.business,
      r.campaign,
      r.keyword,
      r.chatgptFirst,
      r.chatgptPrev,
      r.chatgptCurr,
      r.chatgptStatus,
      r.geminiFirst,
      r.geminiPrev,
      r.geminiCurr,
      r.geminiStatus,
      r.perplexityFirst,
      r.perplexityPrev,
      r.perplexityCurr,
      r.perplexityStatus,
    ]);

    autoTable(doc, {
      startY,
      head: [
        [
          "Business",
          "Campaign",
          "Keyword",
          "ChatGPT 1st",
          "ChatGPT Prev",
          "ChatGPT Curr",
          "Status",
          "Gemini 1st",
          "Gemini Prev",
          "Gemini Curr",
          "Status",
          "Perplexity 1st",
          "Perplexity Prev",
          "Perplexity Curr",
          "Status",
        ],
      ],
      body,
      theme: "striped",
      headStyles: {
        fillColor: [17, 24, 39],
        textColor: [180, 200, 230],
        fontSize: 6,
        fontStyle: "bold",
        cellPadding: 2,
      },
      bodyStyles: { fontSize: 6, cellPadding: 1.5, textColor: [30, 30, 50] },
      alternateRowStyles: { fillColor: [245, 247, 252] },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 22 },
        2: { cellWidth: 28, overflow: "linebreak" },
        3: { cellWidth: 11, halign: "center" },
        4: { cellWidth: 11, halign: "center" },
        5: { cellWidth: 11, halign: "center" },
        6: { cellWidth: 12, halign: "center" },
        7: { cellWidth: 11, halign: "center" },
        8: { cellWidth: 11, halign: "center" },
        9: { cellWidth: 11, halign: "center" },
        10: { cellWidth: 12, halign: "center" },
        11: { cellWidth: 13, halign: "center" },
        12: { cellWidth: 13, halign: "center" },
        13: { cellWidth: 13, halign: "center" },
        14: { cellWidth: 13, halign: "center" },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: footerFn,
    });

    startY =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 10;
  });

  const stamp = window
    ? `${window.currentStart}_to_${window.currentEnd}`
    : fmtIsoDateET(new Date());
  doc.save(`rankings-${label}-${stamp}.pdf`);
}

export default function Rankings() {
  const [compareMode, setCompareMode] = useState<CompareMode>("period");
  const [period, setPeriod] = useState<Period>("weekly");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(
    null,
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(
    null,
  );
  const [comparisonOnly, setComparisonOnly] = useState(false);

  const effectivePeriod: Period =
    compareMode === "lifetime" ? "lifetime" : period;

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

  const bizScope = (allBusinesses ?? []).filter(
    (b) => selectedClientId === null || b.clientId === selectedClientId,
  );
  const planScope = (allPlans ?? []).filter(
    (p) =>
      (selectedClientId === null || p.clientId === selectedClientId) &&
      (selectedBusinessId === null || p.businessId === selectedBusinessId),
  );

  const filtersActive =
    selectedClientId !== null ||
    selectedBusinessId !== null ||
    selectedCampaignId !== null;

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
            <p className="text-sm text-muted-foreground">
              {buildSubtitle(label.long, periodData?.window ?? null)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={comparisonOnly ? "default" : "outline"}
            size="sm"
            className="gap-1.5 h-9"
            onClick={() => setComparisonOnly((v) => !v)}
            title="Show only keywords with a prior audit to compare against. Affects table, CSV, and PDF."
          >
            <GitCompare className="w-3.5 h-3.5" />
            Comparison only
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-slate-300 font-semibold"
            disabled={!hasRows}
            onClick={() => {
              const rows = comparisonOnly
                ? filterComparisonOnly(periodData!.rows)
                : periodData!.rows;
              exportRankingsCSV(
                rows,
                effectivePeriod,
                periodData?.window ?? null,
              );
            }}
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-red-300 text-red-600 hover:text-red-700 hover:bg-red-50 font-semibold"
            disabled={!hasRows}
            onClick={() => {
              const rows = comparisonOnly
                ? filterComparisonOnly(periodData!.rows)
                : periodData!.rows;
              exportRankingsPDF(
                rows,
                effectivePeriod,
                label.long,
                periodData?.window ?? null,
              );
            }}
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
              <SelectItem value="weekly">Biweekly</SelectItem>
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
        comparisonOnly={comparisonOnly}
      />
    </div>
  );
}
