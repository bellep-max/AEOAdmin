import React, { useState } from "react";
import { useGetRankingReports, useGetInitialVsCurrentRankings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowUp, ArrowDown, Minus, MapPin, TrendingUp, TrendingDown,
  Clock, CheckCircle2, AlertCircle, Search, BarChart3,
  ExternalLink, PencilLine, Plus, Loader2, Link2,
  Download, FileDown, ChevronDown, Building2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Types ──────────────────────────────────────────────── */
type PerfStatus = "performing" | "steady" | "underperforming" | "pending";

type CompRow = {
  clientId: number;
  clientName: string;
  keywordId: number;
  keywordText: string;
  currentReportId: number | null;
  initialDate: string | null;
  initialPosition: number | null;
  currentDate: string | null;
  currentPosition: number | null;
  positionChange: number | null;
  isInTopTen: boolean;
  mapsPresence: string | null;
  mapsUrl: string | null;
  status: PerfStatus;
};

/* ── CSV export ─────────────────────────────────────────── */
function exportCSV(rows: CompRow[], filename: string) {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = [
    "Business", "Keyword",
    "Initial Position", "Initial Date",
    "Current Position", "Current Date",
    "Position Change", "Status",
    "Maps Presence", "Maps URL",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        esc(r.clientName),
        esc(r.keywordText),
        esc(r.initialPosition != null ? String(r.initialPosition) : ""),
        esc(r.initialDate ? format(new Date(r.initialDate), "yyyy-MM-dd") : ""),
        esc(r.currentPosition != null ? String(r.currentPosition) : ""),
        esc(r.currentDate ? format(new Date(r.currentDate), "yyyy-MM-dd") : ""),
        esc(r.positionChange != null ? String(r.positionChange) : ""),
        esc(r.status.charAt(0).toUpperCase() + r.status.slice(1)),
        esc(r.mapsPresence ?? ""),
        esc(r.mapsUrl ?? ""),
      ].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── PDF export ─────────────────────────────────────────── */
function exportPDF(rows: CompRow[], title: string, filename: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Signal AEO — Performance Report", 10, 10);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 190, 210);
  doc.text(title, 10, 16);
  doc.text(`Generated ${format(new Date(), "PPP")}`, pageW - 10, 16, { align: "right" });

  /* Group by business */
  const groups = new Map<number, { name: string; rows: CompRow[] }>();
  for (const r of rows) {
    if (!groups.has(r.clientId)) groups.set(r.clientId, { name: r.clientName, rows: [] });
    groups.get(r.clientId)!.rows.push(r);
  }

  let y = 28;

  for (const [, grp] of groups) {
    const perf = grp.rows.filter((r) => r.status === "performing").length;
    const under = grp.rows.filter((r) => r.status === "underperforming").length;
    const steady = grp.rows.filter((r) => r.status === "steady").length;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 120, 220);
    doc.text(grp.name, 10, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(130, 140, 160);
    doc.text(
      `${grp.rows.length} keywords  ·  ${perf} performing  ·  ${steady} steady  ·  ${under} underperforming`,
      10, y + 4,
    );
    y += 8;

    autoTable(doc, {
      startY: y,
      margin: { left: 10, right: 10 },
      head: [["Keyword", "Before Rank", "Before Date", "Current Rank", "Current Date", "Change", "Status", "Maps"]],
      body: grp.rows.map((r) => [
        r.keywordText,
        r.initialPosition != null ? `#${r.initialPosition}` : "N/A",
        r.initialDate ? format(new Date(r.initialDate), "MMM d, yyyy") : "—",
        r.currentPosition != null ? `#${r.currentPosition}` : "N/A",
        r.currentDate ? format(new Date(r.currentDate), "MMM d, yyyy") : "—",
        r.positionChange != null
          ? (r.positionChange > 0 ? `+${r.positionChange}` : String(r.positionChange))
          : "—",
        r.status.charAt(0).toUpperCase() + r.status.slice(1),
        r.mapsUrl ? "Listed" : r.mapsPresence === "yes" ? "Yes" : "—",
      ]),
      headStyles: { fillColor: [25, 35, 60], textColor: [180, 190, 220], fontSize: 7.5, fontStyle: "bold" },
      bodyStyles: { fontSize: 7.5, textColor: [220, 225, 235] },
      alternateRowStyles: { fillColor: [22, 30, 50] },
      styles: { fillColor: [17, 24, 42], lineColor: [40, 55, 90], lineWidth: 0.2 },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 5) {
          const v = String(data.cell.raw ?? "");
          if (v.startsWith("+")) data.cell.styles.textColor = [52, 211, 153];
          else if (v.startsWith("-")) data.cell.styles.textColor = [248, 113, 113];
        }
        if (data.section === "body" && data.column.index === 6) {
          const v = String(data.cell.raw ?? "").toLowerCase();
          if (v === "performing") data.cell.styles.textColor = [52, 211, 153];
          else if (v === "underperforming") data.cell.styles.textColor = [248, 113, 113];
          else if (v === "steady") data.cell.styles.textColor = [251, 191, 36];
        }
      },
    });

    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    if (y > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 15; }
  }

  /* Footer */
  const pageCount = (doc as jsPDF & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(100, 110, 130);
    doc.text("Signal AEO Platform — Confidential", 10, doc.internal.pageSize.getHeight() - 5);
    doc.text(`Page ${i} / ${pageCount}`, pageW - 10, doc.internal.pageSize.getHeight() - 5, { align: "right" });
  }

  doc.save(filename);
}

/* ── Helpers ────────────────────────────────────────────── */
function getStatus(change: number | null, cur: number | null, init: number | null): PerfStatus {
  if (change === null || init === null || cur === null) return "pending";
  if (change > 0) return "performing";
  if (change < 0) return "underperforming";
  return "steady";
}

function StatusBadge({ status }: { status: PerfStatus }) {
  const map = {
    performing:      { label: "Performing",     cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25", icon: CheckCircle2 },
    steady:          { label: "Steady",          cls: "bg-amber-500/15 text-amber-400 border-amber-500/25",       icon: Minus        },
    underperforming: { label: "Underperforming", cls: "bg-destructive/15 text-destructive border-destructive/25", icon: AlertCircle  },
    pending:         { label: "Pending",         cls: "bg-muted/40 text-muted-foreground border-border/40",        icon: Clock        },
  } satisfies Record<PerfStatus, { label: string; cls: string; icon: React.ElementType }>;
  const { label, cls, icon: Icon } = map[status];
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] font-semibold ${cls}`}>
      <Icon className="w-2.5 h-2.5" />{label}
    </Badge>
  );
}

function RankBadge({ pos }: { pos: number | null | undefined }) {
  if (!pos) return <Badge variant="outline" className="bg-muted/30 text-muted-foreground">N/A</Badge>;
  if (pos <= 3)  return <Badge className="bg-amber-400/90 text-amber-950 font-bold">#{pos}</Badge>;
  if (pos <= 7)  return <Badge className="bg-slate-300/90 text-slate-900">#{pos}</Badge>;
  if (pos <= 10) return <Badge className="bg-amber-700/80 text-white">#{pos}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">#{pos}</Badge>;
}

function ChangeCell({ change }: { change: number | null }) {
  if (change === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (change === 0)    return <span className="flex items-center gap-0.5 text-amber-400 font-mono text-sm"><Minus className="w-3 h-3" />0</span>;
  const up = change > 0;
  return (
    <span className={`flex items-center gap-0.5 font-bold font-mono text-sm ${up ? "text-emerald-400" : "text-destructive"}`}>
      {up ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
      {Math.abs(change)}
    </span>
  );
}

function MapsCell({
  mapsPresence, mapsUrl, onEdit,
}: { mapsPresence: string | null; mapsUrl: string | null; onEdit: () => void }) {
  if (mapsUrl) {
    return (
      <div className="flex items-center gap-1.5">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors text-xs font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          <MapPin className="w-3 h-3" />
          Maps
          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
        </a>
        <button
          onClick={onEdit}
          className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          title="Edit link"
        >
          <PencilLine className="w-3 h-3" />
        </button>
      </div>
    );
  }
  if (mapsPresence === "yes") {
    return (
      <button
        onClick={onEdit}
        className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors text-xs border border-dashed border-border/40 hover:border-primary/40 rounded px-1.5 py-0.5"
        title="Add Maps link"
      >
        <Plus className="w-2.5 h-2.5" /> Add link
      </button>
    );
  }
  return <span className="text-muted-foreground/40 text-xs">—</span>;
}

/* ── Mini stat pill ─────────────────────────────────────── */
function Pill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>
      {value} {label}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════
   Main Page
════════════════════════════════════════════════════════════ */
export default function Rankings() {
  const queryClient  = useQueryClient();
  const { toast }    = useToast();

  const { data: reports,    isLoading: isReportsLoading    } = useGetRankingReports();
  const { data: comparison, isLoading: isComparisonLoading } = useGetInitialVsCurrentRankings();

  const [statusFilter,  setStatusFilter]  = useState<PerfStatus | "all">("all");
  const [search,        setSearch]        = useState("");
  const [bizExpanded,   setBizExpanded]   = useState<Set<number>>(new Set());

  const [mapsDialog, setMapsDialog] = useState<{
    open: boolean; reportId: number | null; clientName: string; keyword: string; url: string;
  }>({ open: false, reportId: null, clientName: "", keyword: "", url: "" });
  const [savingMaps, setSavingMaps] = useState(false);

  /* Enrich rows with status */
  const enriched: CompRow[] = (comparison as CompRow[] | undefined ?? []).map((row) => ({
    ...row,
    status: getStatus(row.positionChange ?? null, row.currentPosition ?? null, row.initialPosition ?? null),
  }));

  const counts = {
    performing:      enriched.filter((r) => r.status === "performing").length,
    steady:          enriched.filter((r) => r.status === "steady").length,
    underperforming: enriched.filter((r) => r.status === "underperforming").length,
    pending:         enriched.filter((r) => r.status === "pending").length,
  };
  const total       = enriched.length;
  const successRate = total > 0 ? Math.round((counts.performing / total) * 100) : 0;

  const filtered = enriched.filter((row) => {
    const matchStatus = statusFilter === "all" || row.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q
      || (row.clientName  ?? "").toLowerCase().includes(q)
      || (row.keywordText ?? "").toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  /* Group by client for "By Business" tab */
  const byBusiness = new Map<number, { name: string; rows: CompRow[] }>();
  for (const r of enriched) {
    if (!byBusiness.has(r.clientId)) byBusiness.set(r.clientId, { name: r.clientName, rows: [] });
    byBusiness.get(r.clientId)!.rows.push(r);
  }
  const bizList = [...byBusiness.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  /* ── Export helpers ── */
  const dateStamp = format(new Date(), "yyyy-MM-dd");

  function exportAllCSV() {
    exportCSV(filtered, `aeo-performance-report-${dateStamp}.csv`);
  }
  function exportAllPDF() {
    exportPDF(
      filtered,
      `All businesses · ${filtered.length} keywords · ${format(new Date(), "PPP")}`,
      `aeo-performance-report-${dateStamp}.pdf`,
    );
  }
  function exportBizCSV(clientId: number, rows: CompRow[]) {
    const slug = byBusiness.get(clientId)!.name.replace(/\s+/g, "-").toLowerCase();
    exportCSV(rows, `${slug}-performance-${dateStamp}.csv`);
  }
  function exportBizPDF(clientId: number, rows: CompRow[]) {
    const biz  = byBusiness.get(clientId)!;
    const slug = biz.name.replace(/\s+/g, "-").toLowerCase();
    exportPDF(
      rows,
      `${biz.name} · ${rows.length} keywords · ${format(new Date(), "PPP")}`,
      `${slug}-performance-${dateStamp}.pdf`,
    );
  }

  function openMapsEdit(row: CompRow) {
    setMapsDialog({
      open: true,
      reportId: row.currentReportId,
      clientName: row.clientName,
      keyword: row.keywordText,
      url: row.mapsUrl ?? "",
    });
  }

  async function saveMapsUrl() {
    if (!mapsDialog.reportId) return;
    setSavingMaps(true);
    try {
      const res = await fetch(`${BASE}/api/ranking-reports/${mapsDialog.reportId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapsUrl:      mapsDialog.url.trim() || null,
          mapsPresence: mapsDialog.url.trim() ? "yes" : "no",
        }),
      });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["/api/ranking-reports/initial-vs-current"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/ranking-reports"] });
      toast({ title: "Maps link saved" });
      setMapsDialog((d) => ({ ...d, open: false }));
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSavingMaps(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Performance Reports</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Initial vs current rankings — AI answer engine visibility across all clients
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"
            className="gap-1.5 border-border/50 text-muted-foreground hover:text-foreground"
            onClick={exportAllCSV} disabled={filtered.length === 0}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm"
            className="gap-1.5 border-rose-500/30 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/50"
            onClick={exportAllPDF} disabled={filtered.length === 0}>
            <FileDown className="w-3.5 h-3.5" /> PDF Report
          </Button>
        </div>
      </div>

      {/* ── AEO Performance Overview ── */}
      <div className="rounded-xl border border-border/50 bg-card/40 p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-primary" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AEO Performance Overview</p>
          {!isComparisonLoading && total > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              <span className="font-bold text-emerald-400">{successRate}%</span> success rate
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {isComparisonLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)
          ) : (
            [
              { key: "performing",      label: "Performing",      value: counts.performing,      icon: TrendingUp,   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
              { key: "steady",          label: "Steady",          value: counts.steady,          icon: Minus,        color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20"   },
              { key: "underperforming", label: "Underperforming", value: counts.underperforming, icon: TrendingDown, color: "text-destructive",  bg: "bg-destructive/10", border: "border-destructive/20" },
              { key: "pending",         label: "Pending",         value: counts.pending,         icon: Clock,        color: "text-muted-foreground", bg: "bg-muted/20",   border: "border-border/30"      },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(statusFilter === s.key as PerfStatus ? "all" : s.key as PerfStatus)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  statusFilter === s.key
                    ? `${s.border} ${s.bg}`
                    : "border-border/30 bg-transparent hover:border-border/50"
                }`}
              >
                <div className={`w-8 h-8 rounded-lg ${s.bg} ${s.border} border flex items-center justify-center shrink-0`}>
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <div>
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              </button>
            ))
          )}
        </div>
        {!isComparisonLoading && total > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
              <span>AEO Effectiveness</span>
              <span>{counts.performing}/{total} keywords improving</span>
            </div>
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="by-business" className="w-full">
        <TabsList className="grid w-full max-w-sm grid-cols-3 bg-card/60">
          <TabsTrigger value="by-business">By Business</TabsTrigger>
          <TabsTrigger value="comparison">Before / After</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ═══════ BY BUSINESS TAB ═══════ */}
        <TabsContent value="by-business" className="mt-4 space-y-3">
          {isComparisonLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : bizList.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground rounded-xl border border-dashed border-border/40 bg-card/20">
              No performance data yet.
            </div>
          ) : (
            <div className="space-y-2">
              {bizList.map(([clientId, grp]) => {
                const isOpen = bizExpanded.has(clientId);
                const bRows  = grp.rows;
                const perf   = bRows.filter((r) => r.status === "performing").length;
                const under  = bRows.filter((r) => r.status === "underperforming").length;
                const steady = bRows.filter((r) => r.status === "steady").length;
                const pend   = bRows.filter((r) => r.status === "pending").length;
                const avgChange = bRows
                  .filter((r) => r.positionChange != null)
                  .reduce((acc, r) => acc + (r.positionChange ?? 0), 0);
                const hasChange = bRows.some((r) => r.positionChange != null);

                return (
                  <div key={clientId} className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
                    {/* Business header row */}
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <button
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        onClick={() => setBizExpanded((p) => {
                          const n = new Set(p);
                          n.has(clientId) ? n.delete(clientId) : n.add(clientId);
                          return n;
                        })}
                      >
                        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-foreground truncate">{grp.name}</p>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{bRows.length} keywords</span>
                            {perf   > 0 && <Pill value={perf}   label="performing"      color="text-emerald-400 border-emerald-500/25 bg-emerald-500/10" />}
                            {steady > 0 && <Pill value={steady} label="steady"          color="text-amber-400 border-amber-500/25 bg-amber-500/10" />}
                            {under  > 0 && <Pill value={under}  label="underperforming" color="text-red-400 border-red-500/25 bg-red-500/10" />}
                            {pend   > 0 && <Pill value={pend}   label="pending"         color="text-muted-foreground border-border/30 bg-muted/20" />}
                            {hasChange && (
                              <span className={`text-[10px] font-semibold ${avgChange > 0 ? "text-emerald-400" : avgChange < 0 ? "text-red-400" : "text-amber-400"}`}>
                                {avgChange > 0 ? "+" : ""}{avgChange} net positions
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>

                      {/* Per-business export buttons */}
                      <div className="flex items-center gap-1 shrink-0 pl-2">
                        <button
                          onClick={() => exportBizCSV(clientId, bRows)}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/40 hover:border-border/70 rounded-lg px-2 py-1.5 bg-muted/10 hover:bg-muted/20 transition-all"
                        >
                          <Download className="w-3 h-3" /> CSV
                        </button>
                        <button
                          onClick={() => exportBizPDF(clientId, bRows)}
                          className="flex items-center gap-1.5 text-xs text-rose-400/70 hover:text-rose-400 border border-rose-500/20 hover:border-rose-500/50 rounded-lg px-2 py-1.5 bg-rose-500/5 hover:bg-rose-500/10 transition-all"
                        >
                          <FileDown className="w-3 h-3" /> PDF
                        </button>
                      </div>
                    </div>

                    {/* Expanded keyword table */}
                    {isOpen && (
                      <div className="border-t border-border/40">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableHead className="text-xs">Keyword</TableHead>
                              <TableHead className="text-xs text-center">Before</TableHead>
                              <TableHead className="text-xs text-center">Now</TableHead>
                              <TableHead className="text-xs text-center">Change</TableHead>
                              <TableHead className="text-xs">Maps</TableHead>
                              <TableHead className="text-xs text-right">Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {bRows.map((row, i) => (
                              <TableRow key={`${row.keywordId}-${i}`} className="hover:bg-muted/10">
                                <TableCell className="text-sm max-w-[200px] truncate" title={row.keywordText}>
                                  {row.keywordText}
                                </TableCell>
                                <TableCell className="text-center">
                                  <div className="flex flex-col items-center gap-0.5">
                                    <RankBadge pos={row.initialPosition} />
                                    {row.initialDate && (
                                      <span className="text-[9px] text-muted-foreground/60">
                                        {format(new Date(row.initialDate), "MMM d")}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-center">
                                  <div className="flex flex-col items-center gap-0.5">
                                    <RankBadge pos={row.currentPosition} />
                                    {row.currentDate && (
                                      <span className="text-[9px] text-muted-foreground/60">
                                        {format(new Date(row.currentDate), "MMM d")}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-center">
                                  <ChangeCell change={row.positionChange ?? null} />
                                </TableCell>
                                <TableCell>
                                  <MapsCell mapsPresence={row.mapsPresence} mapsUrl={row.mapsUrl} onEdit={() => openMapsEdit(row)} />
                                </TableCell>
                                <TableCell className="text-right">
                                  <StatusBadge status={row.status} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ═══════ COMPARISON TAB ═══════ */}
        <TabsContent value="comparison" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search client or keyword…"
                className="pl-8 bg-card/60 border-border/50 h-8 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["all", "performing", "steady", "underperforming", "pending"] as const).map((s) => {
                const labels = { all: "All", performing: "Performing", steady: "Steady", underperforming: "Underperforming", pending: "Pending" };
                const colors = {
                  all:             "bg-primary text-primary-foreground border-primary",
                  performing:      "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
                  steady:          "bg-amber-500/20 text-amber-400 border-amber-500/40",
                  underperforming: "bg-destructive/20 text-destructive border-destructive/40",
                  pending:         "bg-muted/40 text-muted-foreground border-border/40",
                };
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      statusFilter === s ? colors[s] : "border-border/40 text-muted-foreground hover:border-border/70 bg-transparent"
                    }`}
                  >
                    {labels[s]}{s !== "all" && <span className="ml-1 opacity-60">({counts[s] ?? 0})</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {isComparisonLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground rounded-xl border border-dashed border-border/40 bg-card/20">No results found.</div>
          ) : (
            <>
              <div className="hidden md:block rounded-xl border border-border/50 overflow-hidden bg-card/30">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableHead className="text-xs">Client</TableHead>
                      <TableHead className="text-xs">Keyword</TableHead>
                      <TableHead className="text-xs">Maps</TableHead>
                      <TableHead className="text-xs text-center">Before</TableHead>
                      <TableHead className="text-xs text-center">Now</TableHead>
                      <TableHead className="text-xs text-center">Change</TableHead>
                      <TableHead className="text-xs text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row, i) => (
                      <TableRow key={`${row.clientId}-${row.keywordId}-${i}`} className="hover:bg-muted/20">
                        <TableCell className="font-medium text-sm">{row.clientName}</TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[180px] truncate">{row.keywordText}</TableCell>
                        <TableCell>
                          <MapsCell mapsPresence={row.mapsPresence} mapsUrl={row.mapsUrl} onEdit={() => openMapsEdit(row)} />
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <RankBadge pos={row.initialPosition} />
                            {row.initialDate && (
                              <span className="text-[9px] text-muted-foreground/60">{format(new Date(row.initialDate), "MMM d")}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <RankBadge pos={row.currentPosition} />
                            {row.currentDate && (
                              <span className="text-[9px] text-muted-foreground/60">{format(new Date(row.currentDate), "MMM d")}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <ChangeCell change={row.positionChange ?? null} />
                        </TableCell>
                        <TableCell className="text-right">
                          <StatusBadge status={row.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="md:hidden space-y-2">
                {filtered.map((row, i) => (
                  <div key={`m-${row.clientId}-${row.keywordId}-${i}`} className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm text-foreground">{row.clientName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{row.keywordText}</p>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 rounded-lg bg-muted/20 p-2 text-center border border-border/30">
                        <p className="text-[9px] text-muted-foreground mb-1">Before</p>
                        <RankBadge pos={row.initialPosition} />
                      </div>
                      <div className="shrink-0"><ChangeCell change={row.positionChange ?? null} /></div>
                      <div className="flex-1 rounded-lg bg-muted/20 p-2 text-center border border-border/30">
                        <p className="text-[9px] text-muted-foreground mb-1">Now</p>
                        <RankBadge pos={row.currentPosition} />
                      </div>
                    </div>
                    <MapsCell mapsPresence={row.mapsPresence} mapsUrl={row.mapsUrl} onEdit={() => openMapsEdit(row)} />
                  </div>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ═══════ HISTORY TAB ═══════ */}
        <TabsContent value="history" className="mt-4">
          {isReportsLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
          ) : (
            <div className="rounded-xl border border-border/50 overflow-hidden bg-card/30">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs">Keyword</TableHead>
                    <TableHead className="text-xs text-center">Position</TableHead>
                    <TableHead className="text-xs">Maps</TableHead>
                    <TableHead className="text-xs">AI Snippet</TableHead>
                    <TableHead className="text-xs text-right">Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!reports || reports.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground text-sm">No ranking history yet.</TableCell>
                    </TableRow>
                  ) : (
                    (reports as (typeof reports[number] & { mapsUrl?: string | null })[]).map((report) => (
                      <TableRow key={report.id} className="hover:bg-muted/20">
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          <div>{format(new Date(report.createdAt), "MMM d, yyyy")}</div>
                          <div className="text-[9px] opacity-60">{formatDistanceToNow(new Date(report.createdAt), { addSuffix: true })}</div>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{report.clientName || `Client #${report.clientId}`}</TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[160px] truncate">{report.keywordText || `Keyword #${report.keywordId}`}</TableCell>
                        <TableCell className="text-center"><RankBadge pos={report.rankingPosition} /></TableCell>
                        <TableCell>
                          {report.mapsUrl ? (
                            <a
                              href={report.mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-xs transition-colors"
                            >
                              <MapPin className="w-3 h-3" />Maps<ExternalLink className="w-2.5 h-2.5 opacity-60" />
                            </a>
                          ) : report.mapsPresence === "yes" ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                              <MapPin className="w-3 h-3" />Listed
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate" title={report.reasonRecommended ?? ""}>
                          {report.reasonRecommended ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {report.isInitialRanking
                            ? <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/20">Initial</Badge>
                            : <Badge variant="outline" className="text-[9px] bg-muted/40 text-muted-foreground border-border/30">Check-in</Badge>
                          }
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ════ Maps Link Dialog ════ */}
      <Dialog open={mapsDialog.open} onOpenChange={(o) => !savingMaps && setMapsDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="sm:max-w-[440px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <DialogTitle>Google Maps Link</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">
                  {mapsDialog.clientName} · {mapsDialog.keyword}
                </p>
              </div>
            </div>
            <DialogDescription className="sr-only">Add or edit the Google Maps listing link</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Google Maps URL
              </Label>
              <div className="relative">
                <Link2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-9 bg-muted/30 border-border/60 h-10 font-mono text-sm"
                  placeholder="https://maps.google.com/?cid=…"
                  value={mapsDialog.url}
                  onChange={(e) => setMapsDialog((d) => ({ ...d, url: e.target.value }))}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Paste the Google Maps business listing URL. Leave blank to remove the link.
              </p>
            </div>

            {mapsDialog.url && (
              <a
                href={mapsDialog.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Preview link in new tab
              </a>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 border-border/50"
                onClick={() => setMapsDialog((d) => ({ ...d, open: false }))}
                disabled={savingMaps}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={saveMapsUrl}
                disabled={savingMaps}
                style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}
              >
                {savingMaps ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Link"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
