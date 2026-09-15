export function RetentionCell({
  retentionRate,
  topThreeChecks,
  validChecks,
}: {
  retentionRate: number | null;
  topThreeChecks: number;
  validChecks: number;
}) {
  if (retentionRate === null) {
    return <span className="text-xs text-muted-foreground">— no valid checks yet</span>;
  }
  const pct = Math.round(retentionRate * 10) / 10;
  const barColor = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="min-w-[110px]">
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums">{pct}%</span>
        <span className="text-[11px] text-muted-foreground">
          {topThreeChecks} of {validChecks} valid checks
        </span>
      </div>
      <div className="mt-1 h-1 w-24 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
