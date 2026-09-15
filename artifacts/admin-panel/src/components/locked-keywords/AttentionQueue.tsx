import { useMemo } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ExternalLink, Eye, Unlock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { dueDateLabel } from "./DueDateCell";
import type { LockedKeywordRecord } from "./types";

function suggestedReasonFor(status: LockedKeywordRecord["status"]): string | undefined {
  if (status === "unlock_now") return "absent_two_consecutive";
  if (status === "unlock_recommended") return "retention_below_50";
  return undefined;
}

const PRIORITY_STATUSES = new Set(["unlock_now", "unlock_recommended"]);

export function needsAttention(r: LockedKeywordRecord): boolean {
  if (PRIORITY_STATUSES.has(r.status)) return true;
  // Monitor rows only surface here when there's a concrete reason (overdue /
  // incomplete coverage), not just a soft 50-69% retention dip.
  if (r.status === "monitor") {
    const { overdue } = dueDateLabel(r.nextCheckDueAt, r.nextCheckDueNow);
    const incompleteCoverage = r.platformChecks.some((p) => !p.checkedInCycle);
    return overdue || r.nextCheckDueNow || incompleteCoverage;
  }
  return false;
}

function reasonFor(r: LockedKeywordRecord): string {
  if (r.status === "unlock_now") return `Absent in ${r.consecutiveAbsentChecks} consecutive valid checks`;
  if (r.status === "unlock_recommended") return `Retention at ${Math.round((r.retentionRate ?? 0) * 10) / 10}%`;
  const incompleteCoverage = r.platformChecks.some((p) => !p.checkedInCycle);
  if (incompleteCoverage) {
    const missing = r.platformChecks.filter((p) => !p.checkedInCycle).map((p) => p.platform).join(", ");
    return `No check yet this cycle on ${missing}`;
  }
  return "Monitoring check overdue";
}

export function AttentionQueue({
  records,
  onReview,
  onUnlockClick,
}: {
  records: LockedKeywordRecord[];
  onReview: (record: LockedKeywordRecord) => void;
  onUnlockClick: (record: LockedKeywordRecord, suggestedReason?: string) => void;
}) {
  const [, navigate] = useLocation();

  const queue = useMemo(() => {
    const order: Record<string, number> = { unlock_now: 0, unlock_recommended: 1, monitor: 2 };
    return records
      .filter(needsAttention)
      .sort((a, b) => order[a.status] - order[b.status])
      .slice(0, 8);
  }, [records]);

  if (queue.length === 0) return null;

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          Needs Attention
        </CardTitle>
        <CardDescription>{queue.length} locked keyword{queue.length !== 1 ? "s" : ""} need a decision</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {queue.map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-6 py-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-medium truncate">{r.keywordText}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {r.clientName ?? "—"}
                  {r.businessName ? ` · ${r.businessName}` : ""}
                </p>
              </div>
              <div className="min-w-[200px] flex-1 text-xs text-muted-foreground">{reasonFor(r)}</div>
              <StatusBadge status={r.status} />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onReview(r)}>
                  <Eye className="w-3.5 h-3.5" /> Review
                </Button>
                {PRIORITY_STATUSES.has(r.status) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs gap-1"
                    onClick={() => onUnlockClick(r, suggestedReasonFor(r.status))}
                  >
                    <Unlock className="w-3.5 h-3.5" /> Unlock
                  </Button>
                )}
                {r.businessId != null && r.aeoPlanId != null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1"
                    onClick={() => navigate(`/clients/${r.clientId}/businesses/${r.businessId}/campaigns/${r.aeoPlanId}`)}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open Campaign
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
