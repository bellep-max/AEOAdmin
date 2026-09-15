/** Slipped keywords, stated in plain English with the reason. A larger position
 *  number is worse. Never red — a client reads red as "something is broken",
 *  and a phrase easing down a spot is normal. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingDown } from "lucide-react";
import type { DeclineKeyword } from "@/lib/summary-report";
import { moverSentence, movementText, placeText } from "@/lib/plain-language";

export function DeclinesList({
  declines,
  narrative,
  narrativeLoading,
}: {
  declines: DeclineKeyword[];
  narrative?: string;
  narrativeLoading?: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingDown className="h-4 w-4 text-primary" />
          What slipped
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {declines.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nothing slipped this time.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {declines.map((d) => {
              // from → to; a bigger "to" means it eased down. Negative = down.
              const change =
                d.from != null && d.to != null ? d.from - d.to : null;
              return (
                <li
                  key={d.keyword}
                  className="flex items-start justify-between gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      &ldquo;{d.keyword}&rdquo;
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {change != null && change !== 0
                        ? moverSentence(d.from, d.to, change)
                        : `Now ${placeText(d.to)}`}
                    </p>
                    {d.reason && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {d.reason}
                      </p>
                    )}
                  </div>
                  {change != null && change !== 0 && (
                    <Badge className="shrink-0 gap-0.5 border-yellow-500/30 bg-yellow-500/15 text-[10px] text-yellow-700 dark:text-yellow-300">
                      <TrendingDown className="h-2.5 w-2.5" />
                      {movementText(change)}
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
            A few phrases eased down since the last check —{" "}
            <strong className="font-semibold text-foreground">
              completely normal
            </strong>{" "}
            as the AI varies its answers day to day. They&rsquo;re already{" "}
            <strong className="font-semibold text-foreground">
              back in our active work queue
            </strong>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
