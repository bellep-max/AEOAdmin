import React, { useState } from "react";
import { useGetRankingReports, useGetInitialVsCurrentRankings } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
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

type PlatformKw = {
  clientId: number; clientName: string;
  keywordId: number; keywordText: string;
  initialPosition: number | null;
  currentPosition: number | null;
  positionChange:  number | null;
};
type PlatformSummary = {
  platform: "chatgpt" | "gemini" | "perplexity";
  totalKeywords: number; withData: number;
  improving: number; steady: number; declining: number;
  avgCurrentRank: number | null;
  topTenCount: number;
  bestKeyword: { text: string; position: number | null; change: number | null } | null;
  keywords: PlatformKw[];
};

type CrossRow = {
  keywordText: string; clientName: string;
  chatgpt:    PlatformKw | undefined;
  gemini:     PlatformKw | undefined;
  perplexity: PlatformKw | undefined;
};

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
      head: [[
        "Keyword",
        "Initial Rank Position",
        "Initial Ranking Date",
        "Current Rank Position",
        "Current Ranking Date",
        "Position Change",
        "Performance Status",
        "Maps Presence",
        "Maps URL",
      ]],
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
        r.mapsPresence === "yes" ? "Yes" : "—",
        r.mapsUrl ?? "—",
      ]),
      headStyles: { fillColor: [25, 35, 60], textColor: [180, 190, 220], fontSize: 7.5, fontStyle: "bold" },
      bodyStyles: { fontSize: 7, textColor: [220, 225, 235] },
      alternateRowStyles: { fillColor: [22, 30, 50] },
      styles: { fillColor: [17, 24, 42], lineColor: [40, 55, 90], lineWidth: 0.2 },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 24, halign: "center" },
        2: { cellWidth: 24, halign: "center" },
        3: { cellWidth: 24, halign: "center" },
        4: { cellWidth: 24, halign: "center" },
        5: { cellWidth: 20, halign: "center" },
        6: { cellWidth: 26, halign: "center" },
        7: { cellWidth: 20, halign: "center" },
        8: { cellWidth: "auto", overflow: "ellipsize" },
      },
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

/* ── Per-business platform CSV export ──────────────────── */
type PlatByKw = Map<number, { chatgpt?: PlatformKw; gemini?: PlatformKw; perplexity?: PlatformKw }>;

function exportBizPlatformCSV(bRows: CompRow[], platByKw: PlatByKw, filename: string) {
  const esc    = (v: string)              => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const posStr = (v: number | null | undefined) => v != null ? `#${v}` : "";
  const chgStr = (v: number | null | undefined) => v == null ? "" : v > 0 ? `+${v}` : String(v);
  const headers = [
    "Business", "Keyword",
    "Initial Rank", "Initial Date",
    "Current Rank", "Current Date",
    "Position Change", "Status",
    "ChatGPT Rank", "ChatGPT Δ",
    "Gemini Rank",  "Gemini Δ",
    "Perplexity Rank", "Perplexity Δ",
    "Best Platform", "Maps URL",
  ];
  const lines = [
    headers.join(","),
    ...bRows.map((r) => {
      const plat = platByKw.get(r.keywordId) ?? {};
      const positions: [string, number][] = [
        ["ChatGPT",    plat.chatgpt?.currentPosition    ?? 9999],
        ["Gemini",     plat.gemini?.currentPosition     ?? 9999],
        ["Perplexity", plat.perplexity?.currentPosition ?? 9999],
      ];
      const bestPos = Math.min(...positions.map(([, p]) => p));
      const best = bestPos < 9999 ? (positions.find(([, p]) => p === bestPos)?.[0] ?? "") : "";
      return [
        esc(r.clientName), esc(r.keywordText),
        esc(posStr(r.initialPosition)),
        esc(r.initialDate ? format(new Date(r.initialDate), "yyyy-MM-dd") : ""),
        esc(posStr(r.currentPosition)),
        esc(r.currentDate ? format(new Date(r.currentDate), "yyyy-MM-dd") : ""),
        esc(chgStr(r.positionChange)),
        esc(r.status.charAt(0).toUpperCase() + r.status.slice(1)),
        esc(posStr(plat.chatgpt?.currentPosition)),    esc(chgStr(plat.chatgpt?.positionChange)),
        esc(posStr(plat.gemini?.currentPosition)),     esc(chgStr(plat.gemini?.positionChange)),
        esc(posStr(plat.perplexity?.currentPosition)), esc(chgStr(plat.perplexity?.positionChange)),
        esc(best), esc(r.mapsUrl ?? ""),
      ].join(",");
    }),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Per-business platform PDF export ──────────────────── */
function exportBizPlatformPDF(bizName: string, bRows: CompRow[], platByKw: PlatByKw, filename: string) {
  const doc   = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Signal AEO — Platform Keyword Report", 10, 10);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 190, 210);
  doc.text(`${bizName} · ${bRows.length} keywords`, 10, 16);
  doc.text(`Generated ${format(new Date(), "PPP")}`, pageW - 10, 16, { align: "right" });

  const PLAT_COLORS: Record<string, [number, number, number]> = {
    ChatGPT:    [52, 211, 153],
    Gemini:     [96, 165, 250],
    Perplexity: [167, 139, 250],
  };

  const posStr = (v: number | null | undefined) => v != null ? `#${v}` : "—";
  const chgStr = (v: number | null | undefined) => v == null ? "—" : v > 0 ? `+${v}` : v === 0 ? "=" : String(v);

  autoTable(doc, {
    startY: 28,
    margin: { left: 8, right: 8 },
    head: [[
      "Keyword",
      "Init Rank", "Cur Rank", "Δ", "Status",
      "ChatGPT", "ChatGPT Δ",
      "Gemini",  "Gemini Δ",
      "Perplexity", "Perplexity Δ",
      "Best",
    ]],
    body: bRows.map((r) => {
      const plat = platByKw.get(r.keywordId) ?? {};
      const positions: [string, number][] = [
        ["ChatGPT",    plat.chatgpt?.currentPosition    ?? 9999],
        ["Gemini",     plat.gemini?.currentPosition     ?? 9999],
        ["Perplexity", plat.perplexity?.currentPosition ?? 9999],
      ];
      const bestPos = Math.min(...positions.map(([, p]) => p));
      const best = bestPos < 9999 ? (positions.find(([, p]) => p === bestPos)?.[0] ?? "—") : "—";
      return [
        r.keywordText,
        posStr(r.initialPosition),
        posStr(r.currentPosition),
        chgStr(r.positionChange),
        r.status.charAt(0).toUpperCase() + r.status.slice(1),
        posStr(plat.chatgpt?.currentPosition),    chgStr(plat.chatgpt?.positionChange),
        posStr(plat.gemini?.currentPosition),     chgStr(plat.gemini?.positionChange),
        posStr(plat.perplexity?.currentPosition), chgStr(plat.perplexity?.positionChange),
        best,
      ];
    }),
    headStyles: { fillColor: [25, 35, 60], textColor: [180, 190, 220], fontSize: 7.5, fontStyle: "bold" },
    bodyStyles: { fontSize: 7, textColor: [220, 225, 235] },
    alternateRowStyles: { fillColor: [22, 30, 50] },
    styles: { fillColor: [17, 24, 42], lineColor: [40, 55, 90], lineWidth: 0.2 },
    columnStyles: {
      0:  { cellWidth: 38 },
      1:  { cellWidth: 16, halign: "center" },
      2:  { cellWidth: 16, halign: "center" },
      3:  { cellWidth: 12, halign: "center" },
      4:  { cellWidth: 22, halign: "center" },
      5:  { cellWidth: 18, halign: "center" },
      6:  { cellWidth: 14, halign: "center" },
      7:  { cellWidth: 18, halign: "center" },
      8:  { cellWidth: 14, halign: "center" },
      9:  { cellWidth: 20, halign: "center" },
      10: { cellWidth: 14, halign: "center" },
      11: { cellWidth: "auto", halign: "center" },
    },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      /* Change columns — green/red */
      if ([3, 6, 8, 10].includes(d.column.index)) {
        const v = String(d.cell.raw ?? "");
        if (v.startsWith("+")) d.cell.styles.textColor = [52, 211, 153];
        else if (v.startsWith("-")) d.cell.styles.textColor = [248, 113, 113];
      }
      /* Status column */
      if (d.column.index === 4) {
        const v = String(d.cell.raw ?? "").toLowerCase();
        if (v === "performing")      d.cell.styles.textColor = [52, 211, 153];
        else if (v === "underperforming") d.cell.styles.textColor = [248, 113, 113];
        else if (v === "steady")     d.cell.styles.textColor = [251, 191, 36];
      }
      /* Best platform column */
      if (d.column.index === 11) {
        const v = String(d.cell.raw ?? "");
        const col = PLAT_COLORS[v];
        if (col) d.cell.styles.textColor = col;
      }
    },
  });

  /* Footer */
  const pageCount = (doc as jsPDF & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(100, 110, 130);
    doc.text("Signal AEO Platform — Confidential", 8, pageH - 5);
    doc.text(`Page ${i} / ${pageCount}`, pageW - 8, pageH - 5, { align: "right" });
  }
  doc.save(filename);
}

/* ── Platform CSV export ────────────────────────────────── */
function exportPlatformCSV(crossRows: CrossRow[], filename: string) {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const chg = (v: number | null | undefined) =>
    v == null ? "" : v > 0 ? `+${v}` : String(v);
  const pos = (v: number | null | undefined) =>
    v == null ? "" : `#${v}`;

  const headers = [
    "Keyword", "Business",
    "ChatGPT Rank", "ChatGPT Change",
    "Gemini Rank",  "Gemini Change",
    "Perplexity Rank", "Perplexity Change",
    "Best Platform",
  ];

  const lines = [
    headers.join(","),
    ...crossRows.map((r) => {
      const positions: [string, number][] = [
        ["ChatGPT",    r.chatgpt?.currentPosition    ?? 9999],
        ["Gemini",     r.gemini?.currentPosition     ?? 9999],
        ["Perplexity", r.perplexity?.currentPosition ?? 9999],
      ];
      const bestPos = Math.min(...positions.map(([, p]) => p));
      const best = bestPos < 9999 ? positions.find(([, p]) => p === bestPos)?.[0] ?? "" : "";
      return [
        esc(r.keywordText),
        esc(r.clientName),
        esc(pos(r.chatgpt?.currentPosition)),
        esc(chg(r.chatgpt?.positionChange)),
        esc(pos(r.gemini?.currentPosition)),
        esc(chg(r.gemini?.positionChange)),
        esc(pos(r.perplexity?.currentPosition)),
        esc(chg(r.perplexity?.positionChange)),
        esc(best),
      ].join(",");
    }),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Platform PDF export ────────────────────────────────── */
function exportPlatformPDF(data: PlatformSummary[], crossRows: CrossRow[], filename: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  /* Cover header */
  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Signal AEO — Platform Ranking Report", 10, 10);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 190, 210);
  doc.text("ChatGPT · Gemini · Perplexity", 10, 16);
  doc.text(`Generated ${format(new Date(), "PPP")}`, pageW - 10, 16, { align: "right" });

  /* ── Platform summary table ── */
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 130, 200);
  doc.text("Platform Performance Summary", 10, 30);

  const PLAT_COLORS: Record<string, [number, number, number]> = {
    chatgpt:    [52, 211, 153],
    gemini:     [96, 165, 250],
    perplexity: [167, 139, 250],
  };
  const LABELS: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" };

  autoTable(doc, {
    startY: 34,
    margin: { left: 10, right: 10 },
    head: [["Platform", "Keywords Tracked", "With Data", "Avg Rank", "Top 10", "Improving", "Steady", "Declining", "Best Keyword"]],
    body: data.map((p) => [
      LABELS[p.platform] ?? p.platform,
      p.totalKeywords,
      p.withData,
      p.avgCurrentRank != null ? `#${p.avgCurrentRank}` : "—",
      p.topTenCount,
      p.improving,
      p.steady,
      p.declining,
      p.bestKeyword ? `${p.bestKeyword.text} (#${p.bestKeyword.position ?? "?"})` : "—",
    ]),
    headStyles: { fillColor: [25, 35, 60], textColor: [180, 190, 220], fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 8, textColor: [220, 225, 235] },
    alternateRowStyles: { fillColor: [22, 30, 50] },
    styles: { fillColor: [17, 24, 42], lineColor: [40, 55, 90], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: "bold" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "center" },
      6: { halign: "center" },
      7: { halign: "center" },
      8: { cellWidth: "auto" },
    },
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 0) {
        const plat = data[d.row.index]?.platform;
        const col = plat ? PLAT_COLORS[plat] : null;
        if (col) d.cell.styles.textColor = col;
      }
    },
  });

  /* ── Cross-platform keyword table ── */
  const afterSummary = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  let y = afterSummary;
  if (y > pageH - 30) { doc.addPage(); y = 15; }

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 130, 200);
  doc.text("Keyword Rankings by Platform", 10, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    margin: { left: 10, right: 10 },
    head: [["Keyword", "Business", "ChatGPT Rank", "ChatGPT Δ", "Gemini Rank", "Gemini Δ", "Perplexity Rank", "Perplexity Δ", "Best Platform"]],
    body: crossRows.map((r) => {
      const positions: [string, number][] = [
        ["ChatGPT",    r.chatgpt?.currentPosition    ?? 9999],
        ["Gemini",     r.gemini?.currentPosition     ?? 9999],
        ["Perplexity", r.perplexity?.currentPosition ?? 9999],
      ];
      const bestPos = Math.min(...positions.map(([, p]) => p));
      const best = bestPos < 9999 ? positions.find(([, p]) => p === bestPos)?.[0] ?? "—" : "—";
      const fmt = (pos: number | null | undefined, chg: number | null | undefined) =>
        pos != null ? `#${pos}` : "—";
      const fmtChg = (v: number | null | undefined) =>
        v == null ? "—" : v > 0 ? `+${v}` : v === 0 ? "=" : String(v);
      return [
        r.keywordText,
        r.clientName,
        fmt(r.chatgpt?.currentPosition, r.chatgpt?.positionChange),
        fmtChg(r.chatgpt?.positionChange),
        fmt(r.gemini?.currentPosition, r.gemini?.positionChange),
        fmtChg(r.gemini?.positionChange),
        fmt(r.perplexity?.currentPosition, r.perplexity?.positionChange),
        fmtChg(r.perplexity?.positionChange),
        best,
      ];
    }),
    headStyles: { fillColor: [25, 35, 60], textColor: [180, 190, 220], fontSize: 7.5, fontStyle: "bold" },
    bodyStyles: { fontSize: 7, textColor: [220, 225, 235] },
    alternateRowStyles: { fillColor: [22, 30, 50] },
    styles: { fillColor: [17, 24, 42], lineColor: [40, 55, 90], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 32 },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 22, halign: "center" },
      5: { cellWidth: 16, halign: "center" },
      6: { cellWidth: 26, halign: "center" },
      7: { cellWidth: 16, halign: "center" },
      8: { cellWidth: "auto", halign: "center" },
    },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      /* ChatGPT change col */
      if (d.column.index === 3 || d.column.index === 5 || d.column.index === 7) {
        const v = String(d.cell.raw ?? "");
        if (v.startsWith("+")) d.cell.styles.textColor = [52, 211, 153];
        else if (v.startsWith("-")) d.cell.styles.textColor = [248, 113, 113];
      }
      /* Best Platform col */
      if (d.column.index === 8) {
        const v = String(d.cell.raw ?? "").toLowerCase();
        if (v === "chatgpt") d.cell.styles.textColor = PLAT_COLORS.chatgpt;
        else if (v === "gemini") d.cell.styles.textColor = PLAT_COLORS.gemini;
        else if (v === "perplexity") d.cell.styles.textColor = PLAT_COLORS.perplexity;
      }
    },
  });

  /* Footer */
  const pageCount = (doc as jsPDF & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(100, 110, 130);
    doc.text("Signal AEO Platform — Confidential", 10, pageH - 5);
    doc.text(`Page ${i} / ${pageCount}`, pageW - 10, pageH - 5, { align: "right" });
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
    <Badge variant="outline" className={`gap-1 text-xs font-semibold ${cls}`}>
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
  return (
    <button
      onClick={onEdit}
      className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors text-xs border border-dashed border-border/40 hover:border-primary/40 rounded px-1.5 py-0.5"
      title="Add Maps link"
    >
      <Plus className="w-2.5 h-2.5" />{mapsPresence === "yes" ? "Add link" : "Add"}
    </button>
  );
}

/* ── Mini stat pill ─────────────────────────────────────── */
function Pill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${color}`}>
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
  const { data: platformData, isLoading: isPlatformLoading } = useQuery<PlatformSummary[]>({
    queryKey: ["/api/ranking-reports/platform-summary"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/ranking-reports/platform-summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch platform summary");
      return res.json();
    },
  });

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

  /* Platform lookup by keyword id */
  const platByKw: PlatByKw = new Map();
  for (const p of platformData ?? []) {
    for (const kw of p.keywords) {
      if (!platByKw.has(kw.keywordId)) platByKw.set(kw.keywordId, {});
      platByKw.get(kw.keywordId)![p.platform] = kw;
    }
  }

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
    const biz  = byBusiness.get(clientId)!;
    const slug = biz.name.replace(/\s+/g, "-").toLowerCase();
    exportBizPlatformCSV(rows, platByKw, `${slug}-platform-rankings-${dateStamp}.csv`);
  }
  function exportBizPDF(clientId: number, rows: CompRow[]) {
    const biz  = byBusiness.get(clientId)!;
    const slug = biz.name.replace(/\s+/g, "-").toLowerCase();
    exportBizPlatformPDF(biz.name, rows, platByKw, `${slug}-platform-rankings-${dateStamp}.pdf`);
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
          <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Performance Reports</h1>
          <p className="text-lg text-slate-700 dark:text-slate-300 mt-0.5">
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
          <p className="text-base uppercase tracking-widest text-black dark:text-white font-bold">AEO Performance Overview</p>
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
                  <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-sm text-black dark:text-white font-semibold">{s.label}</p>
                </div>
              </button>
            ))
          )}
        </div>
        {!isComparisonLoading && total > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
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
      <Tabs defaultValue="overall" className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-5 bg-card/60">
          <TabsTrigger value="overall">Overall</TabsTrigger>
          <TabsTrigger value="by-platform">By Platform</TabsTrigger>
          <TabsTrigger value="by-business">By Business</TabsTrigger>
          <TabsTrigger value="comparison">Before / After</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ═══════ OVERALL TAB ═══════ */}
        <TabsContent value="overall" className="mt-4 space-y-5">
          {isComparisonLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : (() => {
            /* Sort all keywords by current position (best first, nulls last) */
            const sorted = [...enriched].sort((a, b) => {
              if (a.currentPosition == null && b.currentPosition == null) return 0;
              if (a.currentPosition == null) return 1;
              if (b.currentPosition == null) return -1;
              return a.currentPosition - b.currentPosition;
            });

            return (
              <>
                {/* Leaderboard table */}
                {sorted.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground rounded-xl border border-dashed border-border/40 bg-card/20">
                    No ranking data yet.
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/50 overflow-hidden bg-card/30">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/10">
                      <TrendingUp className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        All Keywords — Ranked by Current Position
                      </span>
                      <span className="text-xs text-muted-foreground">{sorted.length} keywords</span>
                      <div className="ml-auto flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 gap-1 text-xs px-2 text-muted-foreground hover:text-foreground"
                          onClick={() => exportCSV(sorted, `aeo-overall-rankings-${dateStamp}.csv`)}
                        >
                          <Download className="w-3 h-3" />CSV
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 gap-1 text-xs px-2 text-muted-foreground hover:text-foreground"
                          onClick={() => exportPDF(sorted, `All Keywords · ${sorted.length} keywords · ${format(new Date(), "PPP")}`, `aeo-overall-rankings-${dateStamp}.pdf`)}
                        >
                          <FileDown className="w-3 h-3" />PDF
                        </Button>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableHead className="text-xs w-10 text-center">#</TableHead>
                          <TableHead className="text-xs">Keyword</TableHead>
                          <TableHead className="text-xs">Business</TableHead>
                          <TableHead className="text-xs text-center">Current Rank</TableHead>
                          <TableHead className="text-xs text-center">Initial Rank</TableHead>
                          <TableHead className="text-xs text-center">Change</TableHead>
                          <TableHead className="text-xs">Maps</TableHead>
                          <TableHead className="text-xs text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sorted.map((row, i) => (
                          <TableRow key={`overall-${row.keywordId}-${i}`} className="hover:bg-muted/10">
                            <TableCell className="text-center text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                            <TableCell className="text-base font-bold max-w-[200px] truncate text-black" title={row.keywordText}>
                              {row.keywordText}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate" title={row.clientName}>
                              {row.clientName}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <RankBadge pos={row.currentPosition} />
                                {row.currentDate && (
                                  <span className="text-[10px] text-muted-foreground/60">
                                    {format(new Date(row.currentDate), "MMM d")}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <RankBadge pos={row.initialPosition} />
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
              </>
            );
          })()}
        </TabsContent>

        {/* ═══════ BY PLATFORM TAB ═══════ */}
        <TabsContent value="by-platform" className="mt-4 space-y-6">
          {isPlatformLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
            </div>
          ) : !platformData || platformData.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground rounded-xl border border-dashed border-border/40 bg-card/20">
              No platform-specific data yet.
            </div>
          ) : (() => {
            const META: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
              chatgpt:    { label: "ChatGPT",    color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-400" },
              gemini:     { label: "Gemini",     color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/30",    dot: "bg-blue-400"    },
              perplexity: { label: "Perplexity", color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/30",  dot: "bg-violet-400"  },
            };

            /* ── Build per-keyword cross-platform table ── */
            const kwMap = new Map<number, {
              keywordText: string; clientName: string;
              chatgpt: PlatformKw | undefined;
              gemini:  PlatformKw | undefined;
              perplexity: PlatformKw | undefined;
            }>();
            for (const p of platformData) {
              for (const kw of p.keywords) {
                if (!kwMap.has(kw.keywordId)) {
                  kwMap.set(kw.keywordId, { keywordText: kw.keywordText, clientName: kw.clientName, chatgpt: undefined, gemini: undefined, perplexity: undefined });
                }
                kwMap.get(kw.keywordId)![p.platform] = kw;
              }
            }
            const crossRows = [...kwMap.values()].sort((a, b) => {
              const bestA = Math.min(a.chatgpt?.currentPosition ?? 99, a.gemini?.currentPosition ?? 99, a.perplexity?.currentPosition ?? 99);
              const bestB = Math.min(b.chatgpt?.currentPosition ?? 99, b.gemini?.currentPosition ?? 99, b.perplexity?.currentPosition ?? 99);
              return bestA - bestB;
            });

            const dateStamp = format(new Date(), "yyyy-MM-dd");

            return (
              <>
                {/* ── Export bar ── */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {crossRows.length} keywords tracked across 3 platforms
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-xs border-border/50 hover:bg-muted/40"
                      onClick={() =>
                        exportPlatformCSV(crossRows, `signal-aeo-platform-rankings-${dateStamp}.csv`)
                      }
                    >
                      <Download className="w-3 h-3" />
                      CSV
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-xs border-border/50 hover:bg-muted/40"
                      onClick={() =>
                        exportPlatformPDF(platformData, crossRows, `signal-aeo-platform-rankings-${dateStamp}.pdf`)
                      }
                    >
                      <FileDown className="w-3 h-3" />
                      PDF
                    </Button>
                  </div>
                </div>

                {/* ── Platform summary cards ── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {platformData.map((p) => {
                    const m = META[p.platform];
                    return (
                      <div key={p.platform} className={`rounded-xl border ${m.border} ${m.bg} p-4 space-y-3`}>
                        {/* Header */}
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${m.dot} shrink-0`} />
                          <span className={`font-bold text-lg ${m.color}`}>{m.label}</span>
                          <span className="ml-auto text-sm text-black dark:text-white bg-muted/30 border border-border/30 rounded px-1.5 py-0.5">
                            {p.withData}/{p.totalKeywords} keywords
                          </span>
                        </div>

                        {/* Key metrics */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-background/40 border border-border/30 p-2 text-center">
                            <p className={`text-2xl font-bold ${m.color}`}>
                              {p.avgCurrentRank != null ? `#${p.avgCurrentRank}` : "—"}
                            </p>
                            <p className="text-sm text-black dark:text-white mt-0.5">Avg Current Rank</p>
                          </div>
                          <div className="rounded-lg bg-background/40 border border-border/30 p-2 text-center">
                            <p className="text-2xl font-bold text-emerald-400">{p.topTenCount}</p>
                            <p className="text-sm text-black dark:text-white mt-0.5">In Top 10</p>
                          </div>
                        </div>

                        {/* Status pills */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1 text-sm font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                            <ArrowUp className="w-2.5 h-2.5" />{p.improving} improving
                          </span>
                          <span className="flex items-center gap-1 text-sm font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                            <Minus className="w-2.5 h-2.5" />{p.steady} steady
                          </span>
                          <span className="flex items-center gap-1 text-sm font-bold text-destructive bg-destructive/10 border border-destructive/20 rounded-full px-2 py-0.5">
                            <ArrowDown className="w-2.5 h-2.5" />{p.declining} declining
                          </span>
                        </div>

                        {/* Best keyword */}
                        {p.bestKeyword && (
                          <div className="rounded-lg bg-background/40 border border-border/30 px-2.5 py-2">
                            <p className="text-xs font-bold text-slate-600 mb-0.5">Best Keyword</p>
                            <p className="text-base font-bold text-black truncate" title={p.bestKeyword.text}>{p.bestKeyword.text}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <RankBadge pos={p.bestKeyword.position} />
                              {p.bestKeyword.change != null && p.bestKeyword.change !== 0 && (
                                <span className={`text-xs font-bold ${p.bestKeyword.change > 0 ? "text-emerald-400" : "text-destructive"}`}>
                                  {p.bestKeyword.change > 0 ? `+${p.bestKeyword.change}` : p.bestKeyword.change}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ── Cross-platform keyword comparison table ── */}
                <div className="rounded-xl border border-border/50 overflow-hidden bg-card/30">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/10">
                    <BarChart3 className="w-3.5 h-3.5 text-primary" />
                    <span className="text-base font-bold text-black dark:text-white uppercase tracking-wide">
                      Keyword Rankings — Across All Platforms
                    </span>
                    <span className="ml-auto text-sm text-black dark:text-white">{crossRows.length} keywords</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableHead className="text-sm font-bold">Keyword</TableHead>
                        <TableHead className="text-sm font-bold text-slate-600">Business</TableHead>
                        <TableHead className="text-sm font-bold text-center text-emerald-400">ChatGPT</TableHead>
                        <TableHead className="text-sm font-bold text-center text-blue-400">Gemini</TableHead>
                        <TableHead className="text-sm font-bold text-center text-violet-400">Perplexity</TableHead>
                        <TableHead className="text-sm font-bold text-center">Best</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {crossRows.map((row, i) => {
                        const positions = [
                          row.chatgpt?.currentPosition,
                          row.gemini?.currentPosition,
                          row.perplexity?.currentPosition,
                        ].filter((p): p is number => p != null);
                        const bestPos = positions.length > 0 ? Math.min(...positions) : null;
                        const bestPlatform = bestPos != null
                          ? bestPos === row.chatgpt?.currentPosition ? "ChatGPT"
                          : bestPos === row.gemini?.currentPosition ? "Gemini"
                          : "Perplexity"
                          : null;
                        const bestMeta = bestPlatform
                          ? META[bestPlatform.toLowerCase() as keyof typeof META]
                          : null;

                        return (
                          <TableRow key={`cross-${row.keywordText}-${i}`} className="hover:bg-muted/10">
                            <TableCell className="text-base font-bold max-w-[180px] truncate text-black" title={row.keywordText}>
                              {row.keywordText}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate" title={row.clientName}>
                              {row.clientName}
                            </TableCell>
                            {(["chatgpt", "gemini", "perplexity"] as const).map((plat) => {
                              const kw  = row[plat];
                              const pos = kw?.currentPosition ?? null;
                              const chg = kw?.positionChange ?? null;
                              return (
                                <TableCell key={plat} className="text-center">
                                  <div className="flex flex-col items-center gap-0.5">
                                    <RankBadge pos={pos} />
                                    {chg != null && (
                                      <span className={`text-[10px] font-bold ${chg > 0 ? "text-emerald-400" : chg < 0 ? "text-destructive" : "text-amber-400"}`}>
                                        {chg > 0 ? `+${chg}` : chg === 0 ? "=" : chg}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-center">
                              {bestPlatform && bestMeta ? (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${bestMeta.border} ${bestMeta.bg} ${bestMeta.color}`}>
                                  {bestPlatform}
                                </span>
                              ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            );
          })()}
        </TabsContent>

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
                          <p className="font-bold text-base text-black truncate">{grp.name}</p>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="text-xs text-muted-foreground">{bRows.length} keywords</span>
                            {perf   > 0 && <Pill value={perf}   label="performing"      color="text-emerald-400 border-emerald-500/25 bg-emerald-500/10" />}
                            {steady > 0 && <Pill value={steady} label="steady"          color="text-amber-400 border-amber-500/25 bg-amber-500/10" />}
                            {under  > 0 && <Pill value={under}  label="underperforming" color="text-red-400 border-red-500/25 bg-red-500/10" />}
                            {pend   > 0 && <Pill value={pend}   label="pending"         color="text-muted-foreground border-border/30 bg-muted/20" />}
                            {hasChange && (
                              <span className={`text-xs font-semibold ${avgChange > 0 ? "text-emerald-400" : avgChange < 0 ? "text-red-400" : "text-amber-400"}`}>
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
                      <div className="border-t border-border/40 overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableHead className="text-xs">Keyword</TableHead>
                              <TableHead className="text-xs text-center">Before</TableHead>
                              <TableHead className="text-xs text-center">Now</TableHead>
                              <TableHead className="text-xs text-center">Change</TableHead>
                              <TableHead className="text-xs text-center text-emerald-400/80">ChatGPT</TableHead>
                              <TableHead className="text-xs text-center text-blue-400/80">Gemini</TableHead>
                              <TableHead className="text-xs text-center text-violet-400/80">Perplexity</TableHead>
                              <TableHead className="text-xs">Maps</TableHead>
                              <TableHead className="text-xs text-right">Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {bRows.map((row, i) => {
                              const plat = platByKw.get(row.keywordId) ?? {};
                              return (
                                <TableRow key={`${row.keywordId}-${i}`} className="hover:bg-muted/10">
                                  <TableCell className="text-sm max-w-[180px] truncate" title={row.keywordText}>
                                    {row.keywordText}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <div className="flex flex-col items-center gap-0.5">
                                      <RankBadge pos={row.initialPosition} />
                                      {row.initialDate && (
                                        <span className="text-[10px] text-muted-foreground/60">
                                          {format(new Date(row.initialDate), "MMM d")}
                                        </span>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <div className="flex flex-col items-center gap-0.5">
                                      <RankBadge pos={row.currentPosition} />
                                      {row.currentDate && (
                                        <span className="text-[10px] text-muted-foreground/60">
                                          {format(new Date(row.currentDate), "MMM d")}
                                        </span>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <ChangeCell change={row.positionChange ?? null} />
                                  </TableCell>
                                  {/* Platform rank cells */}
                                  {(["chatgpt", "gemini", "perplexity"] as const).map((plt) => {
                                    const pk = plat[plt];
                                    return (
                                      <TableCell key={plt} className="text-center">
                                        <div className="flex flex-col items-center gap-0.5">
                                          <RankBadge pos={pk?.currentPosition} />
                                          {pk?.positionChange != null && pk.positionChange !== 0 && (
                                            <span className={`text-[10px] font-bold ${pk.positionChange > 0 ? "text-emerald-400" : "text-destructive"}`}>
                                              {pk.positionChange > 0 ? `+${pk.positionChange}` : pk.positionChange}
                                            </span>
                                          )}
                                        </div>
                                      </TableCell>
                                    );
                                  })}
                                  <TableCell>
                                    <MapsCell mapsPresence={row.mapsPresence} mapsUrl={row.mapsUrl} onEdit={() => openMapsEdit(row)} />
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <StatusBadge status={row.status} />
                                  </TableCell>
                                </TableRow>
                              );
                            })}
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
                        <TableCell className="font-bold text-base text-black">{row.clientName}</TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[180px] truncate">{row.keywordText}</TableCell>
                        <TableCell>
                          <MapsCell mapsPresence={row.mapsPresence} mapsUrl={row.mapsUrl} onEdit={() => openMapsEdit(row)} />
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <RankBadge pos={row.initialPosition} />
                            {row.initialDate && (
                              <span className="text-[10px] text-muted-foreground/60">{format(new Date(row.initialDate), "MMM d")}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <RankBadge pos={row.currentPosition} />
                            {row.currentDate && (
                              <span className="text-[10px] text-muted-foreground/60">{format(new Date(row.currentDate), "MMM d")}</span>
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
                        <p className="font-bold text-base text-black">{row.clientName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{row.keywordText}</p>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 rounded-lg bg-muted/20 p-2 text-center border border-border/30">
                        <p className="text-[10px] text-muted-foreground mb-1">Before</p>
                        <RankBadge pos={row.initialPosition} />
                      </div>
                      <div className="shrink-0"><ChangeCell change={row.positionChange ?? null} /></div>
                      <div className="flex-1 rounded-lg bg-muted/20 p-2 text-center border border-border/30">
                        <p className="text-[10px] text-muted-foreground mb-1">Now</p>
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
                          <div className="text-[10px] opacity-60">{formatDistanceToNow(new Date(report.createdAt), { addSuffix: true })}</div>
                        </TableCell>
                        <TableCell className="font-bold text-base text-black">{report.clientName || `Client #${report.clientId}`}</TableCell>
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
                            ? <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">Initial</Badge>
                            : <Badge variant="outline" className="text-[10px] bg-muted/40 text-muted-foreground border-border/30">Check-in</Badge>
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
              <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">
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
