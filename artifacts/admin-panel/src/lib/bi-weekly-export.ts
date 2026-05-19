/* CSV + PDF generators for the Bi-Weekly Report unified combos table. */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDayET, fmtDateTimeET } from "@/lib/period-comparison";
import type {
  BiWeeklyReport,
  OldComboRow,
} from "@/components/BiWeeklyReportTab";

export interface BiWeeklyExportFilters {
  clientName: string | null;
  businessName: string | null;
  campaignName: string | null;
}

function buildFiltersLine(f: BiWeeklyExportFilters): string | null {
  const parts: string[] = [];
  if (f.clientName) parts.push(`Client = ${f.clientName}`);
  if (f.businessName) parts.push(`Business = ${f.businessName}`);
  if (f.campaignName) parts.push(`Campaign = ${f.campaignName}`);
  return parts.length > 0 ? `Filters: ${parts.join(" · ")}` : null;
}

const trendLabel: Record<OldComboRow["trend"], string> = {
  improved: "Improved",
  declined: "Declined",
  no_change: "No change",
  not_ranked: "Not ranked",
  single_run: "Single run",
};

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  if (
    s.includes(",") ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r")
  ) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportBiWeeklyCSV(
  report: BiWeeklyReport,
  filters: BiWeeklyExportFilters,
) {
  const rows = report.details?.oldCombos ?? [];
  const headers = [
    "client",
    "business",
    "keyword",
    "platform",
    "first_audit",
    "first_rank",
    "latest_audit",
    "latest_rank",
    "rank_change",
    "total_runs",
    "error_count",
    "last_status",
    "next_due",
    "status",
    "days_overdue",
    "trend",
  ];
  const body = rows
    .map((r) =>
      [
        r.client,
        r.business,
        r.keyword,
        r.platform,
        r.first_audit,
        r.first_rank,
        r.latest_audit,
        r.latest_rank,
        r.rank_change,
        r.total_runs,
        r.error_count,
        r.last_status,
        r.next_due,
        r.status_class,
        r.days_overdue,
        trendLabel[r.trend],
      ]
        .map(csvField)
        .join(","),
    )
    .join("\n");
  const csv = `${headers.join(",")}\n${body}\n`;
  const stamp = new Date().toISOString().slice(0, 10);
  const filterPart = filters.clientName
    ? `-${filters.clientName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`
    : "";
  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `bi-weekly-combos${filterPart}-${stamp}.csv`,
  );
}

export function exportBiWeeklyPDF(
  report: BiWeeklyReport,
  filters: BiWeeklyExportFilters,
) {
  const rows = report.details?.oldCombos ?? [];
  const filtersLine = buildFiltersLine(filters);
  const headerBandHeight = filtersLine ? 30 : 24;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Header band
  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, headerBandHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Signal AEO — Bi-Weekly Report", 10, 11);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  const sub = report.currentBatch
    ? `Latest batch: ${fmtDayET(report.currentBatch.batchDate)} · Next due: ${fmtDayET(report.currentBatch.nextDueDate)}`
    : "No audit data";
  doc.text(sub, 10, 18);
  doc.text(`Generated: ${fmtDateTimeET(new Date())} ET`, pageW - 10, 18, {
    align: "right",
  });
  if (filtersLine) {
    doc.setTextColor(200, 215, 240);
    doc.text(filtersLine, 10, 25);
  }

  let startY = headerBandHeight + 6;

  // Summary stats block (Sections A/B/C/D)
  if (report.currentBatch || report.oldFile || report.rankingTrend) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 30, 50);
    doc.text("Summary", 10, startY);
    startY += 4;

    const stats: string[] = [];
    if (report.currentBatch) {
      stats.push(
        `Current batch: ${report.currentBatch.totalSessions} sessions · ${report.currentBatch.uniqueCombos} combos · ${report.currentBatch.uniqueClients} clients · ${report.currentBatch.newCombos} new`,
      );
    }
    if (report.oldFile) {
      stats.push(
        `Old file: ${report.oldFile.totalOldCombos} combos · ${report.oldFile.onSchedule} on schedule · ${report.oldFile.stillBehindTotal} behind · ${report.oldFile.withErrors} with errors`,
      );
    }
    if (report.rankingTrend) {
      stats.push(
        `Trend (2+ runs, n=${report.rankingTrend.eligibleCombos}): ${report.rankingTrend.improved} improved · ${report.rankingTrend.declined} declined · ${report.rankingTrend.noChange} no change · ${report.rankingTrend.notRanked} not ranked`,
      );
    }
    if (report.initialRanking) {
      const b = report.initialRanking.buckets;
      stats.push(
        `Initial ranking (${report.initialRanking.totalNewCombos} new): top1-3=${b.top3.count} · top4-10=${b.top4to10.count} · top11-30=${b.top11to30.count} · beyond30=${b.beyond30.count} · not-ranked=${b.notRanked.count}`,
      );
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(60, 70, 90);
    for (const line of stats) {
      doc.text(line, 10, startY);
      startY += 4;
    }
    startY += 3;
  }

  // Combos table — main content
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 30, 50);
  doc.text(`Combos (${rows.length.toLocaleString()})`, 10, startY);
  startY += 4;

  const body = rows.map((r) => [
    r.client ?? "—",
    r.business ?? "—",
    r.keyword,
    r.platform,
    r.first_audit,
    r.first_rank == null ? "—" : `#${r.first_rank}`,
    r.latest_audit,
    r.latest_rank == null ? "—" : `#${r.latest_rank}`,
    r.rank_change == null
      ? "—"
      : r.rank_change > 0
        ? `+${r.rank_change}`
        : String(r.rank_change),
    String(r.total_runs),
    String(r.error_count),
    r.next_due,
    r.status_class === "overdue" ? `Overdue ${r.days_overdue}d` : "On schedule",
    trendLabel[r.trend],
  ]);

  autoTable(doc, {
    startY,
    head: [
      [
        "Client",
        "Business",
        "Keyword",
        "Platform",
        "1st audit",
        "1st rank",
        "Latest audit",
        "Latest rank",
        "Δ",
        "Runs",
        "Errors",
        "Next due",
        "Status",
        "Trend",
      ],
    ],
    body,
    styles: { fontSize: 6.5, cellPadding: 1.2, overflow: "linebreak" },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: 255,
      fontSize: 6.5,
      cellPadding: 1.4,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 8, right: 8, bottom: 12 },
    didDrawPage: (data) => {
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
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filterPart = filters.clientName
    ? `-${filters.clientName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`
    : "";
  doc.save(`bi-weekly-report${filterPart}-${stamp}.pdf`);
}
