/** Biggest movers: each keyword's first vs current position, stated in plain
 *  English. A move toward 1st (smaller number) is an improvement. Matches the
 *  movers list on the detail pages so the whole product reads the same. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { SummaryMover } from "@/lib/summary-report";
import { moverSentence, movementText, placeText } from "@/lib/plain-language";

function delta(m: SummaryMover): number | null {
  if (m.first == null || m.current == null) return null;
  // Positive = moved toward 1st (improved).
  return m.first - m.current;
}

export function MoversList({
  movers,
  narrative,
  narrativeLoading,
}: {
  movers: SummaryMover[];
  narrative?: string;
  narrativeLoading?: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          What moved the most
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {movers.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nothing moved this time.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {movers.map((m) => {
              const d = delta(m);
              const up = (d ?? 0) > 0;
              return (
                <li
                  key={m.keyword}
                  className="flex items-start justify-between gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      &ldquo;{m.keyword}&rdquo;
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {d != null && d !== 0
                        ? moverSentence(m.first, m.current, d)
                        : `Now ${placeText(m.current)}`}
                    </p>
                  </div>
                  {d != null && d !== 0 && (
                    <Badge
                      className={`shrink-0 gap-0.5 text-[10px] ${
                        up
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "border-yellow-500/30 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
                      }`}
                    >
                      {up ? (
                        <TrendingUp className="h-2.5 w-2.5" />
                      ) : (
                        <TrendingDown className="h-2.5 w-2.5" />
                      )}
                      {movementText(d)}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {narrative?.trim() ? (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {narrative.trim()}
          </p>
        ) : narrativeLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Writing…</p>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Your fastest-rising phrases since the last check. A jump from{" "}
            <strong className="font-semibold text-foreground">
              12th place to 4th place
            </strong>{" "}
            means you went from barely mentioned to one of the{" "}
            <strong className="font-semibold text-foreground">
              first names
            </strong>{" "}
            the AI gives.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
