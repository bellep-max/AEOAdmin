import type { ReactElement } from "react";
import { TrendingUp, TrendingDown, Minus, Sparkles, AlertCircle } from "lucide-react";
import type { Status, Freshness } from "@/lib/period-comparison";
import { PLATFORM_COLORS } from "@/lib/period-comparison";

export function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { bg: string; text: string; label: string; icon: ReactElement }> = {
    improved:  { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-600 dark:text-emerald-400", label: "Improved",  icon: <TrendingUp className="w-3 h-3" /> },
    declined:  { bg: "bg-red-500/10 border-red-500/30",         text: "text-red-600 dark:text-red-400",         label: "Declined",  icon: <TrendingDown className="w-3 h-3" /> },
    steady:    { bg: "bg-slate-500/10 border-slate-500/30",     text: "text-slate-600 dark:text-slate-400",     label: "Steady",    icon: <Minus className="w-3 h-3" /> },
    new:       { bg: "bg-blue-500/10 border-blue-500/30",       text: "text-blue-600 dark:text-blue-400",       label: "New",       icon: <Sparkles className="w-3 h-3" /> },
    missing:   { bg: "bg-amber-500/10 border-amber-500/30",     text: "text-amber-600 dark:text-amber-400",     label: "Missing",   icon: <AlertCircle className="w-3 h-3" /> },
    pending:   { bg: "bg-slate-500/10 border-slate-500/30",     text: "text-muted-foreground",                  label: "Pending",   icon: <Minus className="w-3 h-3" /> },
  };
  const p = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${p.bg} ${p.text}`}>
      {p.icon}{p.label}
    </span>
  );
}

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  if (freshness === "fresh") return null;
  const map: Record<Exclude<Freshness, "fresh">, { bg: string; text: string; label: string }> = {
    stale: { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-600 dark:text-amber-400", label: "Stale" },
    cold:  { bg: "bg-red-500/10 border-red-500/30",     text: "text-red-600 dark:text-red-400",     label: "Cold" },
    never: { bg: "bg-slate-500/10 border-slate-500/30", text: "text-muted-foreground",              label: "No data" },
  };
  const p = map[freshness];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${p.bg} ${p.text}`}>
      {p.label}
    </span>
  );
}

export function PlatformPill({ platform }: { platform: string }) {
  const cls = PLATFORM_COLORS[platform] ?? "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${cls}`}>
      {platform}
    </span>
  );
}

export function ChangeCell({ change }: { change: number | null }) {
  if (change == null) return <span className="text-muted-foreground">—</span>;
  if (change > 0) return <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+{change}</span>;
  if (change < 0) return <span className="text-red-600 dark:text-red-400 font-semibold">{change}</span>;
  return <span className="text-muted-foreground">0</span>;
}
