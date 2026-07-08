/** Locked keywords — those held out of rotation. Each row shows a per-platform
 *  reason chip with the position it locked at. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock } from "lucide-react";
import type { LockedKeyword } from "@/lib/summary-report";

export function LockedList({ locked }: { locked: LockedKeyword[] }) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4 text-primary" />
          Locked keywords
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {locked.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No locked keywords.
          </p>
        ) : (
          <ul className="space-y-3">
            {locked.map((k) => (
              <li
                key={k.keyword}
                className="rounded-lg border border-border/50 bg-muted/20 p-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium">{k.keyword}</span>
                  {(k.businessName || k.campaignName) && (
                    <span className="text-[10px] text-muted-foreground">
                      {[k.businessName, k.campaignName]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {k.platforms.map((p) => (
                    <span
                      key={p.platform}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px]"
                      title={p.reason}
                    >
                      <span className="font-semibold capitalize">
                        {p.label}
                      </span>
                      {p.position != null && (
                        <span className="tabular-nums text-muted-foreground">
                          #{p.position}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        · {p.reason}
                      </span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
