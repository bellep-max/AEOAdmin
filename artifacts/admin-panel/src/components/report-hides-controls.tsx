import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { rawFetch, fmtShortET } from "@/lib/period-comparison";
import { Eye, EyeOff, Undo2 } from "lucide-react";

/* Admin controls for hiding data from every graph/report (admin + client
   portal). Display-only: tracking and raw data continue untouched. */

interface HideScope {
  clientId?: number | null;
  businessId?: number | null;
  aeoPlanId?: number | null;
}

interface HiddenDateRow {
  id: number;
  clientId: number;
  businessId: number | null;
  aeoPlanId: number | null;
  date: string;
}

interface HiddenKeywordRow {
  id: number;
  keywordText: string;
}

interface HidesResponse {
  dates: HiddenDateRow[];
  hiddenKeywords: HiddenKeywordRow[];
}

function scopeParams(scope: HideScope): string {
  const p = new URLSearchParams();
  if (scope.clientId != null) p.set("clientId", String(scope.clientId));
  if (scope.businessId != null) p.set("businessId", String(scope.businessId));
  if (scope.aeoPlanId != null) p.set("aeoPlanId", String(scope.aeoPlanId));
  return p.toString();
}

function useHides(scope: HideScope, enabled: boolean) {
  const params = scopeParams(scope);
  return useQuery<HidesResponse>({
    enabled: enabled && params.length > 0,
    queryKey: ["/api/report-hides", params],
    queryFn: async () => {
      const res = await rawFetch(`/api/report-hides?${params}`);
      if (!res.ok) throw new Error("Failed to load hidden data");
      return res.json();
    },
  });
}

function useIsAdminTier(): boolean {
  const { isAdmin } = useAuth();
  return isAdmin;
}

function levelLabel(r: HiddenDateRow): string {
  if (r.aeoPlanId != null) return "campaign";
  if (r.businessId != null) return "business";
  return "client";
}

/** Eye button + popover on the "Ranking over time" card: hide any charted
 *  audit date at this page's level, and unhide previously hidden ones. */
export function HiddenDatesControl({
  scope,
  visibleDates,
}: {
  scope: HideScope;
  /** YYYY-MM-DD keys currently plotted, ascending. */
  visibleDates: string[];
}) {
  const isAdmin = useIsAdminTier();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useHides(scope, isAdmin && open);
  const [busy, setBusy] = useState(false);

  if (!isAdmin) return null;

  const refresh = () => queryClient.invalidateQueries();

  const hideDate = async (date: string) => {
    setBusy(true);
    try {
      const res = await rawFetch("/api/report-hides/dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, date }),
      });
      if (!res.ok) throw new Error("Hide failed");
      toast({ title: `Hid ${fmtShortET(date)} from graphs & reports` });
      refresh();
    } catch {
      toast({ title: "Could not hide date", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const unhideDate = async (row: HiddenDateRow) => {
    setBusy(true);
    try {
      const res = await rawFetch(`/api/report-hides/dates/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Unhide failed");
      toast({ title: `Unhid ${fmtShortET(row.date)}` });
      refresh();
    } catch {
      toast({ title: "Could not unhide date", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const hiddenCount = data?.dates.length ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground ml-auto"
          title="Hide/unhide audit dates in graphs & reports"
        >
          <EyeOff className="w-3.5 h-3.5 mr-1" />
          Hide dates
          {hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-3">
        <div>
          <p className="text-xs font-semibold mb-1">Hide a date</p>
          <p className="text-[11px] text-muted-foreground mb-2">
            Removes that audit day from every graph and report at this level —
            including the client portal. Data is kept; unhide any time.
          </p>
          <div className="max-h-40 overflow-auto space-y-1">
            {[...visibleDates]
              .sort((a, b) => b.localeCompare(a))
              .map((d) => (
                <div
                  key={d}
                  className="flex items-center justify-between text-xs"
                >
                  <span>{fmtShortET(d)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="h-6 px-2 text-[11px]"
                    onClick={() => hideDate(d)}
                  >
                    <EyeOff className="w-3 h-3 mr-1" /> Hide
                  </Button>
                </div>
              ))}
            {visibleDates.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No dates plotted.
              </p>
            )}
          </div>
        </div>
        {hiddenCount > 0 && (
          <div className="border-t pt-2">
            <p className="text-xs font-semibold mb-1">Hidden dates</p>
            <div className="max-h-32 overflow-auto space-y-1">
              {data!.dates.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    {fmtShortET(r.date)}
                    <Badge variant="secondary" className="text-[9px] px-1 py-0">
                      {levelLabel(r)}
                    </Badge>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="h-6 px-2 text-[11px]"
                    onClick={() => unhideDate(r)}
                  >
                    <Undo2 className="w-3 h-3 mr-1" /> Unhide
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Small per-row button: hide one keyword from all graphs/reports. */
export function HideKeywordButton({
  keywordId,
  keywordText,
}: {
  keywordId: number;
  keywordText: string;
}) {
  const isAdmin = useIsAdminTier();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;

  const hide = async () => {
    setBusy(true);
    try {
      const res = await rawFetch(`/api/report-hides/keywords/${keywordId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: true }),
      });
      if (!res.ok) throw new Error("failed");
      toast({ title: `Hid “${keywordText}” from graphs & reports` });
      queryClient.invalidateQueries();
    } catch {
      toast({ title: "Could not hide keyword", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      className="h-6 px-1.5 text-muted-foreground shrink-0"
      title="Hide this keyword from graphs & reports (all levels + portal)"
      onClick={hide}
    >
      <EyeOff className="w-3.5 h-3.5" />
    </Button>
  );
}

/** "N keywords hidden" chip with an unhide list, for card headers. */
export function HiddenKeywordsControl({ scope }: { scope: HideScope }) {
  const isAdmin = useIsAdminTier();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useHides(scope, isAdmin);
  const [busy, setBusy] = useState(false);

  if (!isAdmin) return null;
  const hidden = data?.hiddenKeywords ?? [];
  if (hidden.length === 0) return null;

  const unhide = async (k: HiddenKeywordRow) => {
    setBusy(true);
    try {
      const res = await rawFetch(`/api/report-hides/keywords/${k.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: false }),
      });
      if (!res.ok) throw new Error("failed");
      toast({ title: `Unhid “${k.keywordText}”` });
      queryClient.invalidateQueries();
    } catch {
      toast({ title: "Could not unhide keyword", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground ml-auto"
        >
          <Eye className="w-3.5 h-3.5 mr-1" />
          {hidden.length} hidden
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="text-xs font-semibold mb-2">Hidden keywords</p>
        <div className="max-h-48 overflow-auto space-y-1">
          {hidden.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate">“{k.keywordText}”</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                className="h-6 px-2 text-[11px] shrink-0"
                onClick={() => unhide(k)}
              >
                <Undo2 className="w-3 h-3 mr-1" /> Unhide
              </Button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
