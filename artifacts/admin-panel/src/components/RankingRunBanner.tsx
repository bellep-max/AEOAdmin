import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Loader2, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { rawFetch } from "@/lib/period-comparison";

interface RankingRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "partial" | "failed";
  keywordsAttempted: number;
  keywordsSucceeded: number;
  keywordsFailed: number;
  notes: string | null;
}

function fmtDate(s: string): string {
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface LatestRecord {
  keywordId: number;
  keywordText: string;
  platform: string;
  rankPosition: number | null;
  clientName: string | null;
  campaignName: string | null;
}

export function RankingRunBanner() {
  const [expanded, setExpanded] = useState(false);

  const { data: run } = useQuery<RankingRun | null>({
    queryKey: ["/api/ranking-runs/latest"],
    queryFn: async () => {
      const res = await rawFetch("/api/ranking-runs/latest");
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: records, isLoading } = useQuery<LatestRecord[]>({
    queryKey: ["/api/ranking-runs/latest-records"],
    queryFn: async () => {
      const res = await rawFetch("/api/ranking-runs/latest-records");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: expanded,
  });

  if (!run) return null;

  const { status } = run;
  const total = run.keywordsAttempted || 0;
  const ok = run.keywordsSucceeded || 0;
  const failed = run.keywordsFailed || 0;

  const palette: Record<RankingRun["status"], { icon: ReactElement; bg: string; border: string; text: string; label: string }> = {
    running: {
      icon: <Loader2 className="w-4 h-4 animate-spin" />,
      bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-600 dark:text-blue-400",
      label: "Run in progress",
    },
    success: {
      icon: <CheckCircle2 className="w-4 h-4" />,
      bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-600 dark:text-emerald-400",
      label: "Last run succeeded",
    },
    partial: {
      icon: <AlertTriangle className="w-4 h-4" />,
      bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-600 dark:text-amber-400",
      label: "Last run partial",
    },
    failed: {
      icon: <XCircle className="w-4 h-4" />,
      bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-600 dark:text-red-400",
      label: "Last run failed",
    },
  };

  const p = palette[status];
  const dateLabel = run.finishedAt ? fmtDate(run.finishedAt) : fmtDate(run.startedAt);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`w-full rounded-xl border ${p.border} ${p.bg} px-4 py-3 flex items-center gap-3 hover:opacity-90 transition-opacity text-left`}
      >
        <span className={p.text}>{p.icon}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${p.text}`}>
            {p.label} — {dateLabel}
          </p>
          <p className="text-xs text-muted-foreground">
            {ok}/{total} keywords succeeded{failed > 0 ? `, ${failed} failed` : ""}
            {run.notes ? ` · ${run.notes}` : ""}
          </p>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="mt-2 rounded-xl border border-border/50 bg-card/60 overflow-hidden">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : !records || records.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No records</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Rank</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r, i) => (
                  <TableRow key={`${r.keywordId}-${r.platform}-${i}`}>
                    <TableCell className="text-sm font-medium">{r.keywordText}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.clientName ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.campaignName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] capitalize">{r.platform}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-semibold">
                      {r.rankPosition != null ? `#${r.rankPosition}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
