/**
 * Interactive clarification surfaced when intent is ambiguous. Instead of
 * guessing, the assistant shows this: chips for metric/entity/platform choices,
 * or preset time-window chips for a timeframe question. Picking one re-runs the
 * turn with the resolved parameter.
 */
import type { Clarification } from "@/lib/chatbot/types";

const TIMEFRAME_PRESETS: { value: string; label: string }[] = [
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_14d", label: "Last 14 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "last_90d", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "all", label: "All time" },
];

export function ClarifyPanel({
  clarification,
  disabled,
  onSelect,
}: {
  clarification: Clarification;
  disabled?: boolean;
  onSelect: (value: string, label: string) => void;
}) {
  const options =
    clarification.options && clarification.options.length > 0
      ? clarification.options
      : clarification.kind === "timeframe"
        ? TIMEFRAME_PRESETS
        : [];

  return (
    <div
      className="mt-2 rounded-lg border border-amber-300/40 bg-amber-50/40 p-3 dark:bg-amber-950/20"
      data-testid="clarify-panel"
    >
      <p className="mb-2 text-sm font-medium">{clarification.question}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(o.value, o.label)}
            className="rounded-full border border-border bg-background px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
            data-testid="clarify-option"
          >
            {o.label}
          </button>
        ))}
        {options.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            Please rephrase with a specific keyword.
          </span>
        ) : null}
      </div>
    </div>
  );
}
