import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const CREATED_BY_OPTIONS = ["Admin", "Sales Representative", "Developer", "Other"] as const;

interface Props {
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  error?: string | null;
  className?: string;
  labelClassName?: string;
}

/**
 * Reusable Created By picker:
 * - Dropdown of preset roles + "Other"
 * - When "Other" is picked, swaps to a free-text input with a "← Back" affordance
 * - Surfaces validation errors inline (so the user can see WHY save failed)
 *
 * `value` is the canonical string written to the DB. When the user picks a preset
 * we just store the preset string. When they pick "Other" + type, we store the
 * typed string verbatim — the "Other" choice itself is never persisted.
 */
export function CreatedByField({ value, onChange, required, error, className, labelClassName }: Props) {
  const presets = CREATED_BY_OPTIONS.slice(0, -1) as readonly string[];
  // "Other" mode is true when value is non-empty and not one of the presets,
  // OR when the user has explicitly clicked Other (tracked locally).
  const [otherMode, setOtherMode] = useState<boolean>(!!value && !presets.includes(value));

  useEffect(() => {
    // External value changes (e.g. dialog reset) should re-sync mode.
    setOtherMode(!!value && !presets.includes(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label className={labelClassName ?? "text-xs font-semibold uppercase tracking-wide text-muted-foreground"}>
        Created By {required ? <span className="text-red-500">*</span> : null}
      </Label>
      {!otherMode ? (
        <Select
          value={value}
          onValueChange={(v) => {
            if (v === "Other") {
              setOtherMode(true);
              onChange("");
            } else {
              onChange(v);
            }
          }}
        >
          <SelectTrigger className={`h-10 bg-muted/30 ${error ? "border-red-500" : ""}`}>
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            {CREATED_BY_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex gap-2">
          <Input
            className={`h-10 bg-muted/30 ${error ? "border-red-500" : ""}`}
            placeholder="Enter name"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs px-2 text-muted-foreground"
            onClick={() => { setOtherMode(false); onChange(""); }}
          >
            ← Back
          </Button>
        </div>
      )}
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
