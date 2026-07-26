import { differenceInCalendarDays, format } from "date-fns";

export function dueDateLabel(nextCheckDueAt: string | null, nextCheckDueNow: boolean): { text: string; overdue: boolean } {
  if (nextCheckDueNow) return { text: "Due now", overdue: false };
  if (!nextCheckDueAt) return { text: "Not scheduled", overdue: false };
  const days = differenceInCalendarDays(new Date(nextCheckDueAt), new Date());
  if (days < 0) return { text: `Overdue by ${Math.abs(days)}d`, overdue: true };
  if (days === 0) return { text: "Due today", overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  return { text: `Due in ${days}d`, overdue: false };
}

export function DueDateCell({
  nextCheckDueAt,
  nextCheckDueNow,
}: {
  nextCheckDueAt: string | null;
  nextCheckDueNow: boolean;
}) {
  const { text, overdue } = dueDateLabel(nextCheckDueAt, nextCheckDueNow);
  return (
    <div className="text-xs">
      <span className={overdue || nextCheckDueNow ? "font-semibold text-destructive" : "text-foreground"}>{text}</span>
      {nextCheckDueAt && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{format(new Date(nextCheckDueAt), "MMM d, yyyy")}</p>
      )}
    </div>
  );
}
