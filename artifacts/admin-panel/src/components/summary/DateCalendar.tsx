/**
 * Month-grid date picker for the Summary Report. Only days that have a report
 * for the current scope are selectable; every other day is disabled. Opens in a
 * popover from a compact trigger and navigates month-by-month. Dates are the
 * ET-anchored YYYY-MM-DD text strings returned by the available-dates endpoint,
 * parsed as local calendar days to avoid the timezone off-by-one shift.
 */
import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AvailableDate } from "@/lib/summary-report";

/** Parse a YYYY-MM-DD string as a local calendar day (no TZ shift). */
function parseLocalDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date back to the YYYY-MM-DD text the endpoints expect. */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DateCalendar({
  dates,
  value,
  onChange,
}: {
  dates: AvailableDate[];
  value: string | null;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const availableKeys = useMemo(
    () => new Set(dates.map((d) => d.date)),
    [dates],
  );

  const selectedDate = value ? parseLocalDate(value) : undefined;
  const countForSelected = value
    ? dates.find((d) => d.date === value)?.count
    : undefined;

  // Land the calendar on the picked month, else the latest available month.
  const defaultMonth = selectedDate
    ? selectedDate
    : dates.length > 0
      ? parseLocalDate(dates[0].date)
      : undefined;

  return (
    <div className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4 text-muted-foreground" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-8 w-52 justify-start text-xs font-normal"
            disabled={dates.length === 0}
          >
            {value ? (
              <>
                {value}
                {countForSelected ? ` · ${countForSelected}` : ""}
              </>
            ) : (
              <span className="text-muted-foreground">No reports</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={defaultMonth}
            disabled={(day) => !availableKeys.has(toDateKey(day))}
            onSelect={(day) => {
              if (!day) return;
              onChange(toDateKey(day));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
