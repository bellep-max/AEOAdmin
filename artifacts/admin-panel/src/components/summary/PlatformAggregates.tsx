/** Platform aggregates strip: per-platform tracked count, in-top-3 count, and
 *  average current position. Lower position is better. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy } from "lucide-react";
import { PLATFORM_COLORS } from "@/lib/period-comparison";
import type { SummaryPlatform } from "@/lib/summary-report";

export function PlatformAggregates({
  platforms,
}: {
  platforms: SummaryPlatform[];
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Trophy className="h-4 w-4 text-primary" />
          Ranking by platform
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {platforms.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No platform data yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {platforms.map((p) => {
              const cls =
                PLATFORM_COLORS[p.platform] ??
                "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
              return (
                <div
                  key={p.platform}
                  className="rounded-lg border border-border/50 bg-muted/20 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${cls}`}
                    >
                      {p.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {p.tracked} keyword{p.tracked !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">
                    {p.avgCurrent != null ? `#${p.avgCurrent}` : "—"}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    <strong className="text-foreground">{p.top3}</strong> in top
                    3
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
