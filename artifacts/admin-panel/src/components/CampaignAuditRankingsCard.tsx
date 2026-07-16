import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Download,
  FileDown,
} from "lucide-react";
import { rawFetch, platformLabel } from "@/lib/period-comparison";
import { placeShort, checkStatusText } from "@/lib/plain-language";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface AuditLogRow {
  id: number;
  keywordId: number;
  keywordText: string | null;
  platform: string;
  status: string;
  rankPosition: number | null;
  timestamp: string;
  durationSeconds: number | null;
  bizName: string | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  chatgpt: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  gemini: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  perplexity: "bg-purple-500/10 text-purple-600 border-purple-500/30",
};

function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}

export function CampaignAuditRankingsCard({
  campaignId,
}: {
  campaignId: number;
}) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<AuditLogRow[]>({
    queryKey: ["/api/audit-logs", { campaignId }],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/audit-logs?campaignId=${campaignId}&limit=200`,
      );
      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      return (json.logs ?? []) as AuditLogRow[];
    },
    enabled: open,
  });

  function exportCSV() {
    if (!data) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const headers = [
      "When",
      "Phrase",
      "AI assistant",
      "Where it ranked",
      "Result",
      "How long",
    ];
    const rows = data.map((a) =>
      [
        esc(format(new Date(a.timestamp), "yyyy-MM-dd HH:mm")),
        esc(a.keywordText ?? ""),
        esc(platformLabel(a.platform)),
        a.rankPosition != null ? placeShort(a.rankPosition) : "not ranked",
        esc(checkStatusText(a.status)),
        fmtDuration(a.durationSeconds),
      ].join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-rankings-campaign-${campaignId}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    if (!data) return;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    const pageW = doc.internal.pageSize.getWidth();
    doc.setFillColor(17, 24, 39);
    doc.rect(0, 0, pageW, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("AI Check History", 10, 9);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Campaign #${campaignId}  ·  ${format(new Date(), "MMMM d, yyyy")}`,
      10,
      15,
    );

    const body = data.map((a) => [
      format(new Date(a.timestamp), "MMM d, h:mm a"),
      a.keywordText ?? "—",
      platformLabel(a.platform),
      a.rankPosition != null ? placeShort(a.rankPosition) : "not ranked",
      checkStatusText(a.status),
      fmtDuration(a.durationSeconds),
    ]);

    autoTable(doc, {
      startY: 22,
      head: [
        [
          "When",
          "Phrase",
          "AI assistant",
          "Where it ranked",
          "Result",
          "How long",
        ],
      ],
      body,
      theme: "striped",
      headStyles: {
        fillColor: [17, 24, 39],
        textColor: [180, 200, 230],
        fontSize: 7,
        fontStyle: "bold",
        cellPadding: 2,
      },
      bodyStyles: { fontSize: 7, cellPadding: 1.5, textColor: [30, 30, 50] },
      alternateRowStyles: { fillColor: [245, 247, 252] },
      margin: { left: 10, right: 10 },
    });

    doc.save(
      `audit-rankings-campaign-${campaignId}-${format(new Date(), "yyyy-MM-dd")}.pdf`,
    );
  }

  const hasData = data && data.length > 0;

  return (
    <Card className="border-border/50">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex-1 text-left"
        >
          <CardHeader className="pb-3 flex flex-row items-center gap-3">
            {open ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-500/10 flex items-center justify-center shrink-0">
              <Search className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm font-semibold">
                AI check history
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {data != null
                  ? `${data.length} check${data.length !== 1 ? "s" : ""} — every time we asked an AI where you rank`
                  : "Click to load"}
              </p>
            </div>
          </CardHeader>
        </button>
        {open && hasData && (
          <div className="flex items-center gap-1 pr-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-7"
              onClick={exportCSV}
            >
              <Download className="w-3 h-3" /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={exportPDF}
            >
              <FileDown className="w-3 h-3" /> PDF
            </Button>
          </div>
        )}
      </div>

      {open && (
        <CardContent className="pt-0 pb-4">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : !data || data.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No checks yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Phrase</TableHead>
                  <TableHead>AI assistant</TableHead>
                  <TableHead>Where it ranked</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>How long</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((a) => {
                  const pc =
                    PLATFORM_COLORS[a.platform] ??
                    "bg-slate-500/10 text-slate-600 border-slate-500/30";
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(a.timestamp), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell
                        className="text-sm font-medium max-w-[180px] truncate"
                        title={a.keywordText ?? ""}
                      >
                        {a.keywordId ? (
                          <Link
                            href={`/keywords?keywordId=${a.keywordId}`}
                            className="hover:text-primary hover:underline"
                          >
                            {a.keywordText ?? "—"}
                          </Link>
                        ) : (
                          (a.keywordText ?? "—")
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-[10px] border ${pc}`}
                          variant="outline"
                        >
                          {platformLabel(a.platform)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {a.rankPosition != null
                          ? placeShort(a.rankPosition)
                          : "not ranked"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {checkStatusText(a.status)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDuration(a.durationSeconds)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      )}
    </Card>
  );
}
