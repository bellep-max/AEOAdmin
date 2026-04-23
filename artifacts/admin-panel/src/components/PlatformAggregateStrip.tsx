import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Minus, Trophy } from "lucide-react";
import {
  usePeriodComparison,
  aggregatePlatforms,
  periodLabel,
  PLATFORM_COLORS,
  type Period,
} from "@/lib/period-comparison";

interface Props {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  title?: string;
  /** When true, renders its own period dropdown. When false, uses `period` prop and stays silent. */
  standalone?: boolean;
  period?: Period;
}

export function PlatformAggregateStrip({
  clientId,
  businessId,
  aeoPlanId,
  title = "Overall ranking by platform",
  standalone = true,
  period: externalPeriod,
}: Props) {
  const [internalPeriod, setInternalPeriod] = useState<Period>("weekly");
  const period = standalone ? internalPeriod : externalPeriod ?? "weekly";

  const { data, isLoading } = usePeriodComparison({ period, clientId, businessId, aeoPlanId });
  const label = periodLabel(period);
  const aggregates = useMemo(() => aggregatePlatforms(data?.rows ?? []), [data]);

  return (
    <Card className="border-border/50">
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">{title}</h3>
            <span className="text-xs text-muted-foreground">· {label.long}</span>
          </div>
          {standalone && (
            <Select value={internalPeriod} onValueChange={(v) => setInternalPeriod(v as Period)}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Biweekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="lifetime">Since start</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
        ) : aggregates.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No ranking data yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {aggregates.map((a) => {
              const cls = PLATFORM_COLORS[a.platform] ?? "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
              const change = a.change;
              return (
                <div key={a.platform} className="rounded-lg border border-border/50 bg-muted/20 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${cls}`}>
                      {a.platform}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{a.keywordCount} keyword{a.keywordCount !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold">
                      {a.avgCurrent != null ? `#${a.avgCurrent}` : "—"}
                    </p>
                    {change != null && change !== 0 && (
                      <span
                        className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                          change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {change > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {change > 0 ? `+${change}` : change}
                      </span>
                    )}
                    {change === 0 && (
                      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground">
                        <Minus className="w-3 h-3" /> 0
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {label.previousLabel}: {a.avgPrevious != null ? `#${a.avgPrevious}` : "—"}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-[10px]">
                    <span className="text-muted-foreground">
                      <strong className="text-foreground">{a.topRank}</strong> in top {a.topRankThreshold}
                    </span>
                    {a.improved > 0 && <span className="text-emerald-600 dark:text-emerald-400">↑ {a.improved}</span>}
                    {a.declined > 0 && <span className="text-red-600 dark:text-red-400">↓ {a.declined}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
