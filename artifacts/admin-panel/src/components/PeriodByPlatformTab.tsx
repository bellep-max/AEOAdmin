import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  usePeriodComparison,
  countStatuses,
  fmtPos,
  periodLabel,
  PLATFORM_ORDER,
  type Period,
  type PeriodRow,
} from "@/lib/period-comparison";
import { StatusBadge, PlatformPill, ChangeCell } from "@/components/period-badges";

interface Props {
  period: Period;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

export function PeriodByPlatformTab({ period, clientId, businessId, aeoPlanId }: Props) {
  const { data, isLoading } = usePeriodComparison({ period, clientId, businessId, aeoPlanId });
  const label = periodLabel(period);

  const byPlatform = useMemo(() => {
    const groups: Record<string, PeriodRow[]> = {};
    for (const r of data?.rows ?? []) {
      if (!groups[r.platform]) groups[r.platform] = [];
      groups[r.platform].push(r);
    }
    return groups;
  }, [data]);

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!data || data.rows.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No ranking data for {label.long.toLowerCase()} yet.
        </CardContent>
      </Card>
    );
  }

  const platforms = [
    ...PLATFORM_ORDER.filter((p) => byPlatform[p]),
    ...Object.keys(byPlatform).filter((p) => !PLATFORM_ORDER.includes(p as typeof PLATFORM_ORDER[number])),
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {platforms.map((platform) => {
          const rows = byPlatform[platform];
          const counts = countStatuses(rows);
          const currentPositions = rows.map((r) => r.currentPosition).filter((n): n is number => n != null);
          const avg = currentPositions.length > 0
            ? Math.round(currentPositions.reduce((s, n) => s + n, 0) / currentPositions.length)
            : null;
          const topTen = currentPositions.filter((n) => n <= 10).length;
          return (
            <Card key={platform} className="border-border/50">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  <PlatformPill platform={platform} />
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">{rows.length} result{rows.length !== 1 ? "s" : ""}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Avg rank</p>
                    <p className="text-lg font-bold">{avg != null ? `#${avg}` : "—"}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Top 10</p>
                    <p className="text-lg font-bold">{topTen}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {counts.improved > 0 && <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">↑ {counts.improved}</Badge>}
                  {counts.declined > 0 && <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30 text-[10px]">↓ {counts.declined}</Badge>}
                  {counts.steady > 0 && <Badge variant="outline" className="text-[10px]">= {counts.steady}</Badge>}
                  {counts.newCount > 0 && <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30 text-[10px]">+ {counts.newCount}</Badge>}
                  {counts.missing > 0 && <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px]">? {counts.missing}</Badge>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {platforms.map((platform) => {
        const rows = [...byPlatform[platform]].sort((a, b) => {
          const ac = a.currentPosition ?? 999;
          const bc = b.currentPosition ?? 999;
          return ac - bc;
        });
        return (
          <Card key={`list-${platform}`} className="border-border/50">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <PlatformPill platform={platform} /> keywords
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-4 pb-2">
                <div className="col-span-4">Keyword</div>
                <div className="col-span-2">Client · Business</div>
                <div className="col-span-2">{label.previousLabel}</div>
                <div className="col-span-2">{label.currentLabel}</div>
                <div className="col-span-1">Change</div>
                <div className="col-span-1">Status</div>
              </div>
              <div className="divide-y divide-border/50">
                {rows.map((r) => (
                  <div key={`${r.keywordId}-${r.platform}`} className="grid grid-cols-12 gap-2 items-center text-sm px-4 py-2 hover:bg-muted/20">
                    <div className="col-span-4 truncate font-medium">{r.keywordText}</div>
                    <div className="col-span-2 text-xs text-muted-foreground truncate">
                      {r.clientName ?? "—"}
                      {r.businessName ? ` · ${r.businessName}` : ""}
                    </div>
                    <div className="col-span-2 text-muted-foreground">{fmtPos(r.previousPosition)}</div>
                    <div className="col-span-2 font-semibold">{fmtPos(r.currentPosition)}</div>
                    <div className="col-span-1"><ChangeCell change={r.change} /></div>
                    <div className="col-span-1"><StatusBadge status={r.status} /></div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
