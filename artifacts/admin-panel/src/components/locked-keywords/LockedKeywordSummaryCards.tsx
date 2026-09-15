import { Lock, CheckCircle2, Eye, ArrowUpRight, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { LockedKeywordSummary } from "./types";

function Cell({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>{icon}</div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold leading-tight tabular-nums">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function LockedKeywordSummaryCards({ summary }: { summary: LockedKeywordSummary }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Cell icon={<Lock className="w-5 h-5 text-muted-foreground" />} label="Total Locked" value={summary.totalLocked} color="bg-muted" />
      <Cell
        icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
        label="Healthy"
        value={summary.healthy}
        color="bg-emerald-50 dark:bg-emerald-900/30"
      />
      <Cell icon={<Eye className="w-5 h-5 text-amber-600" />} label="Needs Monitoring" value={summary.monitor} color="bg-amber-50 dark:bg-amber-900/30" />
      <Cell
        icon={<ArrowUpRight className="w-5 h-5 text-orange-600" />}
        label="Unlock Recommended"
        value={summary.unlockRecommended}
        color="bg-orange-50 dark:bg-orange-900/30"
      />
      <Cell
        icon={<AlertTriangle className="w-5 h-5 text-destructive" />}
        label="Unlock Now"
        value={summary.unlockNow}
        color="bg-red-50 dark:bg-red-900/30"
      />
    </div>
  );
}
