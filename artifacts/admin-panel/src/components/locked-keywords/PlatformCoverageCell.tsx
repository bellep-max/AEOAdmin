import { format } from "date-fns";
import { PLATFORM_LABELS, type PlatformCheckSummary } from "./types";

function platformLine(p: PlatformCheckSummary): { result: string; cls: string } {
  if (!p.checkedInCycle) return { result: "Not checked", cls: "text-muted-foreground" };
  if (p.latestPosition == null) return { result: "Absent", cls: "text-destructive font-medium" };
  if (p.latestPosition <= 3) return { result: `Top ${p.latestPosition}`, cls: "text-emerald-600 dark:text-emerald-400 font-medium" };
  return { result: `Rank ${p.latestPosition}`, cls: "text-amber-600 dark:text-amber-400" };
}

export function PlatformCoverageCell({ platformChecks }: { platformChecks: PlatformCheckSummary[] }) {
  return (
    <div className="space-y-0.5 min-w-[150px]">
      {platformChecks.map((p) => {
        const { result, cls } = platformLine(p);
        return (
          <div key={p.platform} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground w-16 shrink-0">{PLATFORM_LABELS[p.platform]}</span>
            <span className={`${cls} flex-1 text-left`}>{result}</span>
            <span className="text-muted-foreground shrink-0">
              {p.latestValidCheckAt ? format(new Date(p.latestValidCheckAt), "MMM d") : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
