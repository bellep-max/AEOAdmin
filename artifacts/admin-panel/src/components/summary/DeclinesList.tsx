/** Declines — keywords that slipped, with the from → to positions and a reason.
 *  A larger position number is worse. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, ArrowRight } from "lucide-react";
import type { DeclineKeyword } from "@/lib/summary-report";

const fmtPos = (n: number | null): string => (n != null ? `#${n}` : "—");

export function DeclinesList({ declines }: { declines: DeclineKeyword[] }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingDown className="h-4 w-4 text-primary" />
          Declines
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {declines.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No declines to show.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {declines.map((d) => (
              <li
                key={d.keyword}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm">{d.keyword}</span>
                  {d.reason && (
                    <span className="text-[10px] text-muted-foreground">
                      {d.reason}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                  <span className="text-muted-foreground">
                    {fmtPos(d.from)}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {fmtPos(d.to)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
