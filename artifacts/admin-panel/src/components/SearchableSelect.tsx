import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string; sublabel?: string };

/** A select that can also be searched (type-to-filter combobox). Pass `value`
 *  = null for the "all" / cleared state. Shared by the Keywords and Clients
 *  filter bars. */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  allLabel,
  disabled,
  width = "w-56",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: ComboOption[];
  placeholder: string;
  allLabel: string;
  disabled?: boolean;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? options.find((o) => o.value === value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`${width} h-11 inline-flex items-center justify-between gap-2 px-3 text-sm font-bold rounded-md bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className="truncate text-left">
            {selected ? (
              selected.label
            ) : (
              <span className="text-slate-500">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`__all__ ${allLabel}`}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value == null ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="font-bold">{allLabel}</span>
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.sublabel ?? ""}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="font-bold truncate">{o.label}</span>
                  {o.sublabel && (
                    <span className="text-slate-500 ml-1 truncate">
                      · {o.sublabel}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
