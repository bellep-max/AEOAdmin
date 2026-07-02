import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
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
  buildPeriodUrl,
  isPlatformUnavailable,
  type Period,
  type PeriodResponse,
  type PeriodRow,
} from "@/lib/period-comparison";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ExportRankingsDialog,
  type ExportFiltersValue,
} from "@/components/ExportRankingsDialog";
import { SendReportDialog } from "@/components/SendReportDialog";
import { SalesEmailDialog } from "@/components/SalesEmailDialog";
import { useAuth } from "@/lib/auth";
import { Mail, TrendingUp } from "lucide-react";

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

/* Keep only rows whose Current audit matches the picked date. Both
   `date` and `r.currentDate` are YYYY-MM-DD text strings (the API
   returns the unambiguous `date` text column, not the timestamp), so
   string equality is correct. */
function filterByCurrentDate(rows: PeriodRow[], date: string): PeriodRow[] {
  if (date === "all" || !date) return rows;
  return rows.filter((r) => (r.currentDate ?? "").slice(0, 10) === date);
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
      // Missing data on an outage platform (e.g. Gemini) reads as "Unavailable"
      // in exports too, so a client report never shows a bare "—" there.
      const statusOf = (p: string) =>
        g(p)?.status ?? (isPlatformUnavailable(p) ? "Unavailable" : "—");
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
        chatgptStatus: statusOf("chatgpt"),
        geminiFirst: pos(g("gemini")?.firstPosition ?? null),
        geminiFirstDate: dt(g("gemini")?.firstDate),
        geminiPrev: pos(g("gemini")?.previousPosition ?? null),
        geminiPrevDate: dt(g("gemini")?.previousDate),
        geminiCurr: pos(g("gemini")?.currentPosition ?? null),
        geminiCurrDate: dt(g("gemini")?.currentDate),
        geminiChange: chg(g("gemini")?.change ?? null),
        geminiStatus: statusOf("gemini"),
        perplexityFirst: pos(g("perplexity")?.firstPosition ?? null),
        perplexityFirstDate: dt(g("perplexity")?.firstDate),
        perplexityPrev: pos(g("perplexity")?.previousPosition ?? null),
        perplexityPrevDate: dt(g("perplexity")?.previousDate),
        perplexityCurr: pos(g("perplexity")?.currentPosition ?? null),
        perplexityCurrDate: dt(g("perplexity")?.currentDate),
        perplexityChange: chg(g("perplexity")?.change ?? null),
        perplexityStatus: statusOf("perplexity"),
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

interface ExportFilters {
  clientName: string | null;
  businessName: string | null;
  campaignName: string | null;
  auditDate: string | null;
  comparisonOnly: boolean;
}

function buildFiltersLine(f: ExportFilters): string | null {
  const parts: string[] = [];
  if (f.clientName) parts.push(`Client = ${f.clientName}`);
  if (f.businessName) parts.push(`Business = ${f.businessName}`);
  if (f.campaignName) parts.push(`Campaign = ${f.campaignName}`);
  if (f.auditDate) parts.push(`Audit date = ${fmtDayET(f.auditDate)}`);
  if (f.comparisonOnly) parts.push("Comparison only");
  return parts.length > 0 ? `Filters: ${parts.join(" · ")}` : null;
}

function exportRankingsCSV(
  rows: PeriodRow[],
  label: string,
  window: PeriodWindow | null,
  filters: ExportFilters,
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
  /* Metadata rows above the header so Mary can see the comparison period
     and active filters in Excel without parsing the filename. Spreadsheets
     render them as plain rows in column A. */
  const subtitle = buildSubtitle(label, window);
  const filtersLine = buildFiltersLine(filters);
  const generated = `Generated ${fmtDateTimeET(new Date())} ET`;
  const meta = [esc(`Rankings — ${subtitle}`)];
  if (filtersLine) meta.push(esc(filtersLine));
  meta.push(esc(generated));
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
  filters: ExportFilters,
) {
  const filtersLine = buildFiltersLine(filters);
  const headerBandHeight = filtersLine ? 30 : 24;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, headerBandHeight, "F");
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
  if (filtersLine) {
    doc.setTextColor(200, 215, 240);
    doc.text(filtersLine, 10, 25);
  }

  const pivoted = pivotRows(rows);

  // Empty-state guard: never produce a blank PDF — say so plainly instead.
  if (pivoted.length === 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 130, 150);
    doc.text(
      "No ranking data for the selected filters.",
      10,
      headerBandHeight + 16,
    );
    doc.save(`rankings-${label}-empty-${fmtIsoDateET(new Date())}.pdf`);
    return;
  }

  const grouped = new Map<string, PivotRow[]>();
  for (const r of pivoted) {
    const key = r.client || "Unassigned";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  // Per-client summary (Top-3 / improved / declined) from the raw rows so the
  // reader gets the headline numbers without scanning the table.
  const summaryByClient = new Map<
    string,
    { top3: Set<number>; improved: number; declined: number }
  >();
  for (const r of rows) {
    const key = r.clientName || "Unassigned";
    let s = summaryByClient.get(key);
    if (!s) {
      s = { top3: new Set(), improved: 0, declined: 0 };
      summaryByClient.set(key, s);
    }
    if (r.currentPosition != null && r.currentPosition <= 3)
      s.top3.add(r.keywordId);
    if (r.status === "improved") s.improved++;
    else if (r.status === "declined") s.declined++;
  }

  let startY = headerBandHeight + 6;
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
    const sum = summaryByClient.get(clientName);
    const sumTxt = sum
      ? `  ·  ${sum.top3.size} in Top 3  ·  ${sum.improved} improved  ·  ${sum.declined} declined`
      : "";
    doc.text(
      `${clientRows.length} keyword${clientRows.length !== 1 ? "s" : ""}${sumTxt}`,
      10,
      startY + 4,
    );
    startY += 9;

    // Strip ", YYYY" so "May 12, 2026" → "May 12" (saves cell width)
    const shortDate = (s: string) => s.replace(/,\s*\d{4}$/, "");
    // Combine "#9" + "May 12" into two-line cell content. Empty when no data.
    const rd = (rank: string, date: string) => {
      if (!rank || rank === "—") return date ? `—\n${shortDate(date)}` : "—";
      return date ? `${rank}\n${shortDate(date)}` : rank;
    };

    // Status -> color tint (cell fill) so the eye finds wins/losses fast.
    const statusFill = (s: string): [number, number, number] | undefined => {
      const k = (s ?? "").toLowerCase();
      if (k === "improved") return [220, 252, 231]; // green-100
      if (k === "declined") return [254, 226, 226]; // red-100
      if (k === "steady") return [241, 245, 249]; // slate-100
      if (k === "new") return [219, 234, 254]; // blue-100
      return undefined;
    };

    const body = clientRows.map((r) => [
      r.business,
      r.campaign,
      r.keyword,
      rd(r.chatgptFirst, r.chatgptFirstDate),
      rd(r.chatgptPrev, r.chatgptPrevDate),
      rd(r.chatgptCurr, r.chatgptCurrDate),
      r.chatgptStatus,
      rd(r.geminiFirst, r.geminiFirstDate),
      rd(r.geminiPrev, r.geminiPrevDate),
      rd(r.geminiCurr, r.geminiCurrDate),
      r.geminiStatus,
      rd(r.perplexityFirst, r.perplexityFirstDate),
      rd(r.perplexityPrev, r.perplexityPrevDate),
      rd(r.perplexityCurr, r.perplexityCurrDate),
      r.perplexityStatus,
    ]);

    autoTable(doc, {
      startY,
      head: [
        [
          { content: "Business", rowSpan: 2 },
          { content: "Campaign", rowSpan: 2 },
          { content: "Keyword", rowSpan: 2 },
          {
            content: "ChatGPT",
            colSpan: 4,
            styles: { fillColor: [16, 90, 60], halign: "center" },
          },
          {
            content: "Gemini",
            colSpan: 4,
            styles: { fillColor: [29, 78, 132], halign: "center" },
          },
          {
            content: "Perplexity",
            colSpan: 4,
            styles: { fillColor: [88, 28, 135], halign: "center" },
          },
        ],
        [
          { content: "Initial", styles: { halign: "center" } },
          { content: "Previous", styles: { halign: "center" } },
          { content: "Current", styles: { halign: "center" } },
          { content: "Status", styles: { halign: "center" } },
          { content: "Initial", styles: { halign: "center" } },
          { content: "Previous", styles: { halign: "center" } },
          { content: "Current", styles: { halign: "center" } },
          { content: "Status", styles: { halign: "center" } },
          { content: "Initial", styles: { halign: "center" } },
          { content: "Previous", styles: { halign: "center" } },
          { content: "Current", styles: { halign: "center" } },
          { content: "Status", styles: { halign: "center" } },
        ],
      ],
      body,
      theme: "striped",
      headStyles: {
        fillColor: [17, 24, 39],
        textColor: [255, 255, 255],
        fontSize: 7.5,
        fontStyle: "bold",
        cellPadding: 2,
        halign: "left",
        valign: "middle",
      },
      bodyStyles: {
        fontSize: 6.5,
        cellPadding: 1.5,
        textColor: [30, 30, 50],
        valign: "middle",
        overflow: "linebreak",
      },
      alternateRowStyles: { fillColor: [245, 247, 252] },
      /* A4 landscape = 297mm; margins 8+8 leave 281mm usable.
         77 (left cols) + 68×3 (platform groups) = 281 exactly. */
      columnStyles: {
        0: { cellWidth: 22 }, // Business
        1: { cellWidth: 22 }, // Campaign
        2: { cellWidth: 33, overflow: "linebreak" }, // Keyword
        3: { cellWidth: 17, halign: "center" }, // CG Initial
        4: { cellWidth: 17, halign: "center" }, // CG Previous
        5: { cellWidth: 17, halign: "center" }, // CG Current
        6: { cellWidth: 17, halign: "center", fontStyle: "bold" }, // CG Status
        7: { cellWidth: 17, halign: "center" }, // Gem Initial
        8: { cellWidth: 17, halign: "center" }, // Gem Previous
        9: { cellWidth: 17, halign: "center" }, // Gem Current
        10: { cellWidth: 17, halign: "center", fontStyle: "bold" }, // Gem Status
        11: { cellWidth: 17, halign: "center" }, // Px Initial
        12: { cellWidth: 17, halign: "center" }, // Px Previous
        13: { cellWidth: 17, halign: "center" }, // Px Current
        14: { cellWidth: 17, halign: "center", fontStyle: "bold" }, // Px Status
      },
      margin: { left: 8, right: 8 },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        // Color the three Status cells (indexes 6, 10, 14)
        if (
          data.column.index === 6 ||
          data.column.index === 10 ||
          data.column.index === 14
        ) {
          const fill = statusFill(String(data.cell.raw ?? ""));
          if (fill) data.cell.styles.fillColor = fill;
        }
      },
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
  const [auditDate, setAuditDate] = useState<string>("all");
  /* Optional per-column date overrides (ET YYYY-MM-DD). When set, the
     corresponding First/Prev/Current column reads the audit on that exact
     date per (keyword, platform) instead of the period default. */
  const [firstDateOverride, setFirstDateOverride] = useState<string | null>(
    null,
  );
  const [prevDateOverride, setPrevDateOverride] = useState<string | null>(null);
  const [currentDateOverride, setCurrentDateOverride] = useState<string | null>(
    null,
  );
  const [exportMode, setExportMode] = useState<"csv" | "pdf" | null>(null);
  const [sendReportOpen, setSendReportOpen] = useState(false);
  const [salesEmailOpen, setSalesEmailOpen] = useState(false);
  const { isOwner, isSales, isAdmin } = useAuth();
  const canSendSalesEmail = isOwner || isSales || isAdmin;
  const queryClient = useQueryClient();

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
    selectedCampaignId !== null ||
    firstDateOverride !== null ||
    prevDateOverride !== null ||
    currentDateOverride !== null;

  // Lazy-load: hold the (large) all-clients fetch until a client is picked.
  // The page lagged badly loading every client up front; now nothing loads
  // until the operator selects a client.
  const clientChosen = selectedClientId !== null;
  const { data: periodData } = usePeriodComparison(
    {
      period: effectivePeriod,
      clientId: selectedClientId,
      businessId: selectedBusinessId,
      aeoPlanId: selectedCampaignId,
      firstDate: firstDateOverride,
      prevDate: prevDateOverride,
      currentDate: currentDateOverride,
    },
    clientChosen,
  );

  const label = periodLabel(effectivePeriod);
  const hasRows = (periodData?.rows?.length ?? 0) > 0;

  /* Distinct Current-audit dates in ET, newest first. Used by the audit-date
     dropdown so the operator can drill into one specific audit run. */
  const auditDates = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of periodData?.rows ?? []) {
      if (r.currentDate) set.add(r.currentDate.slice(0, 10));
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [periodData]);

  /* Build the row set the page (and downloads) actually use. Stacks
     audit-date filter, Current-pin filter (drops rows with no Current on the
     pinned date so the operator doesn't scroll past 2k blanks), and the
     comparison-only filter. */
  const filteredRows = useMemo<PeriodRow[]>(() => {
    let rs = periodData?.rows ?? [];
    rs = filterByCurrentDate(rs, auditDate);
    if (currentDateOverride) rs = filterByCurrentDate(rs, currentDateOverride);
    if (comparisonOnly) rs = filterComparisonOnly(rs);
    return rs;
  }, [periodData, auditDate, currentDateOverride, comparisonOnly]);
  const hasFilteredRows = filteredRows.length > 0;

  const exportFilters: ExportFilters = useMemo(
    () => ({
      clientName:
        selectedClientId === null
          ? null
          : ((allClients ?? []).find((c) => c.id === selectedClientId)
              ?.businessName ?? null),
      businessName:
        selectedBusinessId === null
          ? null
          : ((allBusinesses ?? []).find((b) => b.id === selectedBusinessId)
              ?.name ?? null),
      campaignName:
        selectedCampaignId === null
          ? null
          : ((allPlans ?? []).find((p) => p.id === selectedCampaignId)?.name ??
            null),
      auditDate: auditDate === "all" ? null : auditDate,
      comparisonOnly,
    }),
    [
      selectedClientId,
      selectedBusinessId,
      selectedCampaignId,
      auditDate,
      comparisonOnly,
      allClients,
      allBusinesses,
      allPlans,
    ],
  );

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
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-indigo-300 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-semibold"
            onClick={() => setSendReportOpen(true)}
            disabled={selectedClientId == null}
            title={
              selectedClientId == null
                ? "Pick a client first"
                : "Email this client a report with the latest rankings + screenshots"
            }
          >
            <Mail className="w-3.5 h-3.5" /> Send Report
          </Button>
          {canSendSalesEmail && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-emerald-300 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 font-semibold"
              onClick={() => setSalesEmailOpen(true)}
              disabled={selectedClientId == null}
              title={
                selectedClientId == null
                  ? "Pick a client first"
                  : "Email this client their before/after ranking improvement proof"
              }
            >
              <TrendingUp className="w-3.5 h-3.5" /> Sales Email
            </Button>
          )}
        </div>
      </div>

      <SendReportDialog
        open={sendReportOpen}
        onClose={() => setSendReportOpen(false)}
        clientId={selectedClientId}
        businessId={selectedBusinessId}
        aeoPlanId={selectedCampaignId}
      />

      <SalesEmailDialog
        open={salesEmailOpen}
        onClose={() => setSalesEmailOpen(false)}
        clientId={selectedClientId}
      />

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
            <SelectValue placeholder="Select a client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Select a client</SelectItem>
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
        <div className="h-6 w-px bg-slate-300 dark:bg-slate-600 mx-1" />
        <ColumnDatePicker
          label="First"
          value={firstDateOverride}
          onChange={setFirstDateOverride}
          availableDates={auditDates}
        />
        <ColumnDatePicker
          label="Prev"
          value={prevDateOverride}
          onChange={setPrevDateOverride}
          availableDates={auditDates}
        />
        <ColumnDatePicker
          label="Current"
          value={currentDateOverride}
          onChange={setCurrentDateOverride}
          availableDates={auditDates}
        />
        <div className="h-6 w-px bg-slate-300 dark:bg-slate-600 mx-1" />
        <Select value={auditDate} onValueChange={setAuditDate}>
          <SelectTrigger className="w-48 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 h-10 text-sm font-semibold">
            <SelectValue placeholder="Audit date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All audits</SelectItem>
            {auditDates.map((d, i) => (
              <SelectItem key={d} value={d}>
                {fmtDayET(d)}
                {i === 0 ? " (latest)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
          title="Rows showing (after filters) of total rows returned by the server"
        >
          <span className="text-slate-500 dark:text-slate-400">Showing</span>
          <span className="tabular-nums">
            {filteredRows.length.toLocaleString()}
          </span>
          <span className="text-slate-400">/</span>
          <span className="tabular-nums">
            {(periodData?.rows?.length ?? 0).toLocaleString()}
          </span>
        </span>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setSelectedClientId(null);
              setSelectedBusinessId(null);
              setSelectedCampaignId(null);
              setFirstDateOverride(null);
              setPrevDateOverride(null);
              setCurrentDateOverride(null);
            }}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 dark:hover:text-white font-semibold"
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

      {!clientChosen ? (
        <Card className="border-border/50 border-dashed">
          <CardContent className="py-16 text-center">
            <Building2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              Select a client to view rankings
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Rankings load per client to keep the page fast — pick a client
              above to begin.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
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
            auditDate={auditDate}
            firstDate={firstDateOverride}
            prevDate={prevDateOverride}
            currentDate={currentDateOverride}
          />
        </>
      )}

      {/* Export dialog (PDF or CSV) — reviews/edits filters before generating */}
      {exportMode && (
        <ExportRankingsDialog
          open={!!exportMode}
          onOpenChange={(o) => {
            if (!o) setExportMode(null);
          }}
          mode={exportMode}
          defaults={{
            clientId: selectedClientId,
            businessId: selectedBusinessId,
            aeoPlanId: selectedCampaignId,
            period,
            compareMode,
            auditDate,
            comparisonOnly,
          }}
          clients={allClients ?? []}
          businesses={allBusinesses ?? []}
          plans={allPlans ?? []}
          onConfirm={async (v: ExportFiltersValue) => {
            const eff: Period =
              v.compareMode === "lifetime" ? "lifetime" : v.period;
            const data = await queryClient.fetchQuery<PeriodResponse>({
              queryKey: [
                "/api/ranking-reports/period-comparison",
                eff,
                v.clientId,
                v.businessId,
                v.aeoPlanId,
              ],
              queryFn: async () => {
                const res = await rawFetch(
                  buildPeriodUrl({
                    period: eff,
                    clientId: v.clientId,
                    businessId: v.businessId,
                    aeoPlanId: v.aeoPlanId,
                  }),
                );
                if (!res.ok) throw new Error("Failed");
                return res.json();
              },
            });
            let rows = data.rows;
            rows = filterByCurrentDate(rows, v.auditDate);
            if (v.comparisonOnly) rows = filterComparisonOnly(rows);

            const ef: ExportFilters = {
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
              auditDate: v.auditDate === "all" ? null : v.auditDate,
              comparisonOnly: v.comparisonOnly,
            };

            if (exportMode === "csv") {
              exportRankingsCSV(rows, eff, data.window, ef);
            } else {
              exportRankingsPDF(
                rows,
                eff,
                periodLabel(eff).long,
                data.window,
                ef,
              );
            }
          }}
        />
      )}
    </div>
  );
}

interface ColumnDatePickerProps {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  /* YYYY-MM-DD strings of dates that actually have audits. The picker uses
     this to (a) open on a useful default month and (b) gray out empty days
     so the operator doesn't pin a column to a date with no data. */
  availableDates: string[];
}

const ymdToDate = (s: string): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};

/* Single-day picker that pins which audit date a column reads from.
   Stores ET YYYY-MM-DD strings; null = use the default selection. */
function ColumnDatePicker({
  label,
  value,
  onChange,
  availableDates,
}: ColumnDatePickerProps) {
  const parsed = value ? ymdToDate(value) : undefined;
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  /* Pick a sensible month for the calendar to open on so the operator
     lands on real data instead of an empty future month. Order: selected
     date > most recent audit date > today. */
  const defaultMonth = useMemo(() => {
    if (parsed) return parsed;
    if (availableDates.length > 0) return ymdToDate(availableDates[0]);
    return undefined;
  }, [parsed, availableDates]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-10 gap-1.5 border-2 ${
            value
              ? "border-primary text-primary bg-primary/5"
              : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
          } font-semibold`}
        >
          <CalendarIcon className="w-3.5 h-3.5" />
          <span className="text-[11px] uppercase text-muted-foreground">
            {label}
          </span>
          <span className="text-xs">{value ? fmtDayET(value) : "Any"}</span>
          {value ? (
            <span
              role="button"
              tabIndex={0}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange(null);
                }
              }}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700"
              aria-label={`Clear ${label} date`}
            >
              <X className="w-3 h-3" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parsed}
          defaultMonth={defaultMonth}
          disabled={(d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return !availableSet.has(`${y}-${m}-${day}`);
          }}
          onSelect={(d) => {
            if (!d) {
              onChange(null);
              return;
            }
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            onChange(`${y}-${m}-${day}`);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
