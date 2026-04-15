import { useQueries } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  buildPeriodUrl,
  rawFetch,
  countStatuses,
  periodLabel,
  type Period,
  type PeriodResponse,
} from "@/lib/period-comparison";

interface Props {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  activePeriod: Period;
  onSelect: (p: Period) => void;
}

const PERIODS: Exclude<Period, "lifetime">[] = ["weekly", "monthly", "quarterly"];

export function PeriodOverview({ clientId, businessId, aeoPlanId, activePeriod, onSelect }: Props) {
  const queries = useQueries({
    queries: PERIODS.map((p) => ({
      queryKey: ["/api/ranking-reports/period-comparison", p, clientId, businessId, aeoPlanId],
      queryFn: async () => {
        const res = await rawFetch(buildPeriodUrl({ period: p, clientId, businessId, aeoPlanId }));
        if (!res.ok) throw new Error("Failed");
        return res.json() as Promise<PeriodResponse>;
      },
    })),
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {PERIODS.map((p, idx) => {
        const q = queries[idx];
        const rows = q.data?.rows ?? [];
        const counts = countStatuses(rows);
        const label = periodLabel(p);
        const isActive = activePeriod === p;
        const net = counts.improved - counts.declined;

        return (
          <button
            key={p}
            type="button"
            onClick={() => onSelect(p)}
            className="text-left"
          >
            <Card
              className={`border transition-all ${
                isActive
                  ? "border-primary/50 bg-primary/5 shadow-sm"
                  : "border-border/50 hover:border-primary/30 hover:bg-muted/30"
              }`}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label.short}</p>
                  {net > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                      <TrendingUp className="w-3 h-3" /> +{net}
                    </span>
                  )}
                  {net < 0 && (
                    <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 text-xs font-semibold">
                      <TrendingDown className="w-3 h-3" /> {net}
                    </span>
                  )}
                  {net === 0 && (
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground text-xs font-semibold">
                      <Minus className="w-3 h-3" /> 0
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">{label.long}</p>
                {q.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{counts.improved} ↑</span>
                    <span className="text-red-600 dark:text-red-400 font-semibold">{counts.declined} ↓</span>
                    <span className="text-muted-foreground font-semibold">{counts.steady} =</span>
                    {counts.newCount > 0 && <span className="text-blue-600 dark:text-blue-400 font-semibold">{counts.newCount} new</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
