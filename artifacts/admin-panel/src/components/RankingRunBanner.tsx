import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Loader2, XCircle, ChevronDown, ChevronRight } from "lucide-react";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { headers });
}

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

interface LatestDetail {
  date: string;
  platforms: { platform: string; keywords: number; succeeded: number; failed: number }[];
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

  const { data: detail } = useQuery<LatestDetail>({
    queryKey: ["/api/ranking-runs/latest-detail"],
    queryFn: async () => {
      const res = await rawFetch("/api/ranking-runs/latest-detail");
      if (!res.ok) return null;
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

      {expanded && detail && (
        <div className="mt-2 rounded-xl border border-border/50 bg-card/60 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Latest run details — {detail.date}</p>
          <div className="grid grid-cols-3 gap-3">
            {detail.platforms.map((pl) => (
              <div key={pl.platform} className="rounded-lg border border-border/40 bg-muted/20 p-2">
                <p className="text-xs font-semibold capitalize mb-1">{pl.platform}</p>
                <p className="text-2xl font-bold">{pl.keywords}</p>
                <p className="text-[10px] text-muted-foreground">
                  {pl.succeeded} succeeded{pl.failed > 0 ? `, ${pl.failed} failed` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
