/**
 * Date dropdown built from the available-dates endpoint. "All" is the all-time
 * view; a concrete date scopes the report to the period ending on that run
 * (prior-run comparison). The per-date session count is shown when present.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarDays } from "lucide-react";
import type { AvailableDate } from "@/lib/summary-report";

const ALL_VALUE = "__all__";

export function DateSelector({
  dates,
  value,
  onChange,
}: {
  dates: AvailableDate[];
  value: string | null;
  onChange: (date: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4 text-muted-foreground" />
      <Select
        value={value ?? ALL_VALUE}
        onValueChange={(v) => onChange(v === ALL_VALUE ? null : v)}
      >
        <SelectTrigger className="h-8 w-52 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All time</SelectItem>
          {dates.map((d) => (
            <SelectItem key={d.date} value={d.date}>
              {d.date}
              {d.count ? ` · ${d.count}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
