import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  ArrowRight,
  Gauge,
} from "lucide-react";
import {
  usePeriodComparison,
  fmtPos,
  summarizeProgress,
  sortMovers,
} from "@/lib/period-comparison";
import { AIExplain } from "@/components/AIExplain";

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "emerald" | "blue" | "amber";
}

function Stat({ label, value, sub, tone = "default" }: StatProps) {
  const valueCls =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "blue"
        ? "text-blue-600 dark:text-blue-400"
        : tone === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${valueCls}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

const MAX_MOVERS = 10;

interface Props {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  title?: string;
  /** Scope display name — enables the per-section AI "what this means" blurbs. */
  scopeName?: string | null;
}

/** "Since start" performance summary for a client / business / campaign scope.
 *  Rolls up every keyword's initial rank vs current rank into headline numbers
 *  plus a most-improved-first movers list — overall progress, not daily noise. */
export function PerformanceSummaryCard({
  clientId,
  businessId,
  aeoPlanId,
  title = "Overall Performance summary",
  scopeName,
}: Props) {
  const { data, isLoading } = usePeriodComparison({
    period: "lifetime",
    clientId,
    businessId,
    aeoPlanId,
  });

  const s = useMemo(() => summarizeProgress(data?.rows ?? []), [data]);

  const movers = useMemo(() => sortMovers(s.keywords), [s.keywords]);

  const trackedCount = s.keywords.length;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          {title}
          <span className="text-muted-foreground font-normal">
            · since start
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Loading…
          </p>
        ) : s.withRank === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No ranking data yet — the summary appears once keywords have been
            scanned.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat
                label="Keywords tracked"
                value={String(trackedCount)}
                sub={`${s.withRank} with a ranking`}
              />
              <Stat
                label="In top 3"
                value={String(s.inTop3)}
                sub={
                  s.withRank
                    ? `${Math.round((s.inTop3 / s.withRank) * 100)}% of ranked`
                    : undefined
                }
                tone="emerald"
              />
              <Stat
                label="Improved"
                value={String(s.improved)}
                sub={s.declined > 0 ? `${s.declined} declined` : "since start"}
                tone="blue"
              />
              <Stat
                label="Avg rank now"
                value={s.avgCurrent != null ? `#${s.avgCurrent}` : "—"}
                sub={
                  s.avgFirst != null ? `started at #${s.avgFirst}` : undefined
                }
              />
            </div>

            <AIExplain
              section="overall"
              name={scopeName}
              clientId={clientId}
              businessId={businessId}
              aeoPlanId={aeoPlanId}
            />

            {movers.length > 0 && (
              <div className="rounded-lg border border-border/40 bg-muted/10 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
                  <Trophy className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-xs font-semibold">Biggest movers</span>
                  <span className="text-[10px] text-muted-foreground">
                    most improved first
                  </span>
                </div>
                <div className="divide-y divide-border/40">
                  {movers.slice(0, MAX_MOVERS).map((k) => {
                    const up = (k.improvement as number) > 0;
                    return (
                      <div
                        key={k.keywordId}
                        className="flex items-center gap-3 px-3 py-2"
                      >
                        <span className="text-sm font-medium flex-1 min-w-0 truncate">
                          {k.keywordText}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 tabular-nums">
                          {fmtPos(k.firstBest)}
                          <ArrowRight className="w-3 h-3 opacity-60" />
                          <span className="font-semibold text-foreground">
                            {fmtPos(k.currentBest)}
                          </span>
                        </span>
                        <Badge
                          className={`gap-0.5 text-[10px] shrink-0 ${
                            up
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                              : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30"
                          }`}
                        >
                          {up ? (
                            <TrendingUp className="w-2.5 h-2.5" />
                          ) : (
                            <TrendingDown className="w-2.5 h-2.5" />
                          )}
                          {up ? `+${k.improvement}` : k.improvement}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
                {movers.length > MAX_MOVERS && (
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border/40 flex items-center gap-1">
                    <Minus className="w-2.5 h-2.5" />
                    {movers.length - MAX_MOVERS} more moved — see the keyword
                    list below
                  </div>
                )}
              </div>
            )}

            {movers.length > 0 && (
              <AIExplain
                section="movers"
                name={scopeName}
                clientId={clientId}
                businessId={businessId}
                aeoPlanId={aeoPlanId}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
