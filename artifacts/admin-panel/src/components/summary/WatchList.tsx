/** Watch list — keywords whose position has stalled and are worth keeping an
 *  eye on. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye } from "lucide-react";
import { ordinal } from "@/lib/plain-language";
import type { WatchKeyword } from "@/lib/summary-report";

export function WatchList({ watch }: { watch: WatchKeyword[] }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Eye className="h-4 w-4 text-primary" />
          Watch list
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {watch.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nothing on the watch list.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {watch.map((w) => (
              <li
                key={w.keyword}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="truncate text-sm">{w.keyword}</span>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <span className="font-semibold tabular-nums">
                    {w.latestPosition != null ? ordinal(w.latestPosition) : "—"}
                  </span>
                  {w.stallingSince && (
                    <span className="text-muted-foreground">
                      since {w.stallingSince}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Phrases sitting{" "}
          <strong className="font-semibold text-foreground">
            just outside the top 3
          </strong>
          . They're close, and we're actively working to push them into the top
          answers.
        </p>
      </CardContent>
    </Card>
  );
}
