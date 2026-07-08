/** Biggest movers: keyword with its first and current position. A move toward
 *  #1 (smaller number) is an improvement. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, ArrowRight } from "lucide-react";
import type { SummaryMover } from "@/lib/summary-report";

const fmtPos = (n: number | null): string => (n != null ? `#${n}` : "—");

function delta(m: SummaryMover): number | null {
  if (m.first == null || m.current == null) return null;
  // Positive = moved toward #1 (improved).
  return m.first - m.current;
}

export function MoversList({ movers }: { movers: SummaryMover[] }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          Biggest movers
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {movers.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No movers to show.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {movers.map((m) => {
              const d = delta(m);
              return (
                <li
                  key={m.keyword}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="truncate text-sm">{m.keyword}</span>
                  <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                    <span className="text-muted-foreground">
                      {fmtPos(m.first)}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-semibold">{fmtPos(m.current)}</span>
                    {d != null && d !== 0 && (
                      <span
                        className={`font-semibold ${
                          d > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {d > 0 ? `+${d}` : d}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
