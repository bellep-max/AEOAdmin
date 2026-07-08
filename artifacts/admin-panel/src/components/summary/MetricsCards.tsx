/** Metrics summary strip: tracked, in top 3, improved, slipped, steady, and
 *  average position now vs. at first measure. Lower position is better. */
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import type { SummaryMetrics } from "@/lib/summary-report";

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "emerald" | "blue" | "amber" | "red";
}) {
  const valueCls =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "blue"
        ? "text-blue-600 dark:text-blue-400"
        : tone === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : tone === "red"
            ? "text-red-600 dark:text-red-400"
            : "text-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueCls}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

const fmtPos = (n: number | null): string => (n != null ? `#${n}` : "—");

export function MetricsCards({ metrics }: { metrics: SummaryMetrics }) {
  return (
    <Card className="border-border/50">
      <CardContent className="py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Tracked"
            value={String(metrics.tracked)}
            sub={`${metrics.withRank} with a rank`}
          />
          <Stat label="In top 3" value={String(metrics.top3)} tone="emerald" />
          <Stat
            label="Improved"
            value={String(metrics.improved)}
            tone="emerald"
          />
          <Stat label="Slipped" value={String(metrics.declined)} tone="red" />
          <Stat label="Steady" value={String(metrics.steady)} tone="amber" />
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Avg position
            </p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-semibold text-muted-foreground tabular-nums">
                {fmtPos(metrics.avgFirst)}
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-2xl font-bold text-blue-600 tabular-nums dark:text-blue-400">
                {fmtPos(metrics.avgCurrent)}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              first → now (lower is better)
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
