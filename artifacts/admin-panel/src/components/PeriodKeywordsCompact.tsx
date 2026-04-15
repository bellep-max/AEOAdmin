import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  usePeriodComparison,
  countStatuses,
  fmtPos,
  periodLabel,
  PLATFORM_ORDER,
  PLATFORM_COLORS,
  type Period,
  type PeriodRow,
} from "@/lib/period-comparison";
import { StatusBadge, ChangeCell } from "@/components/period-badges";

interface Props {
  period: Period;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

function PlatformChip({ row }: { row: PeriodRow }) {
  const cls = PLATFORM_COLORS[row.platform] ?? "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
  const arrow = row.change == null ? "" : row.change > 0 ? " ↑" : row.change < 0 ? " ↓" : " =";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls}`}>
      <span className="capitalize">{row.platform}</span>
      <span className="font-bold">{fmtPos(row.currentPosition)}{arrow}</span>
    </span>
  );
}

export function PeriodKeywordsCompact({ period, clientId, businessId, aeoPlanId }: Props) {
  const { data, isLoading } = usePeriodComparison({ period, clientId, businessId, aeoPlanId });
  const label = periodLabel(period);

  const grouped = useMemo(() => {
    const byKeyword = new Map<number, { keyword: PeriodRow; platforms: PeriodRow[] }>();
    for (const r of data?.rows ?? []) {
      const existing = byKeyword.get(r.keywordId);
      if (existing) existing.platforms.push(r);
      else byKeyword.set(r.keywordId, { keyword: r, platforms: [r] });
    }
    return [...byKeyword.values()].sort((a, b) =>
      a.keyword.keywordText.localeCompare(b.keyword.keywordText)
    );
  }, [data]);

  const counts = useMemo(() => countStatuses(data?.rows ?? []), [data]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>;
  }
  if (!data || data.rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No ranking data for {label.long.toLowerCase()} yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline">{grouped.length} keyword{grouped.length !== 1 ? "s" : ""}</Badge>
        {counts.improved > 0 && <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">↑ {counts.improved}</Badge>}
        {counts.declined > 0 && <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30">↓ {counts.declined}</Badge>}
        {counts.steady > 0 && <Badge variant="outline">= {counts.steady}</Badge>}
        {counts.newCount > 0 && <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30">+ {counts.newCount} new</Badge>}
      </div>

      <Card className="border-border/50">
        <CardContent className="p-0">
          <div className="divide-y divide-border/50">
            {grouped.map(({ keyword, platforms }) => {
              const sorted = [...platforms].sort((a, b) => {
                const ai = PLATFORM_ORDER.indexOf(a.platform as typeof PLATFORM_ORDER[number]);
                const bi = PLATFORM_ORDER.indexOf(b.platform as typeof PLATFORM_ORDER[number]);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
              });
              return (
                <div key={keyword.keywordId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-foreground flex-1">{keyword.keywordText}</p>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      {sorted.map((p) => (
                        <PlatformChip key={`chip-${p.keywordId}-${p.platform}`} row={p} />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pl-1 pb-1">
                    <div className="col-span-2">Platform</div>
                    <div className="col-span-3">{label.previousLabel}</div>
                    <div className="col-span-3">{label.currentLabel}</div>
                    <div className="col-span-2">Change</div>
                    <div className="col-span-2">Status</div>
                  </div>
                  <div className="space-y-1">
                    {sorted.map((p) => (
                      <div key={`${p.keywordId}-${p.platform}-row`} className="grid grid-cols-12 gap-2 items-center text-xs pl-1 py-1">
                        <div className="col-span-2 capitalize font-semibold">{p.platform}</div>
                        <div className="col-span-3 text-muted-foreground">{fmtPos(p.previousPosition)}</div>
                        <div className="col-span-3 font-semibold">{fmtPos(p.currentPosition)}</div>
                        <div className="col-span-2"><ChangeCell change={p.change} /></div>
                        <div className="col-span-2"><StatusBadge status={p.status} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
