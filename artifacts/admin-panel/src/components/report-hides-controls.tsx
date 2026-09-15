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

interface HiddenKeywordPlatformRow {
  id: number;
  keywordId: number;
  platform: string;
  keywordText: string;
}

interface HidesResponse {
  dates: HiddenDateRow[];
  hiddenKeywords: HiddenKeywordRow[];
  hiddenKeywordPlatforms: HiddenKeywordPlatformRow[];
}

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

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
  realDatesFor,
}: {
  scope: HideScope;
  /** YYYY-MM-DD keys currently plotted, ascending. */
  visibleDates: string[];
  /** Real audit dates behind a plotted key. Charts remapped onto the July-1
   *  display cadence plot slots, not real days, and hides must be written
   *  against the real days or they match nothing. Defaults to identity. */
  realDatesFor?: (plottedDate: string) => string[];
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
      const targets = realDatesFor ? realDatesFor(date) : [date];
      for (const target of targets) {
        const res = await rawFetch("/api/report-hides/dates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...scope, date: target }),
        });
        if (!res.ok) throw new Error("Hide failed");
      }
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

/** Per-keyword-row menu: hide/unhide the whole keyword OR a single platform's
 *  data inside it. Works on any keyword — not just decliners. */
export function KeywordHideMenu({
  scope,
  keywordId,
  keywordText,
}: {
  scope: HideScope;
  keywordId: number;
  keywordText: string;
}) {
  const isAdmin = useIsAdminTier();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useHides(scope, isAdmin);
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;

  const kwHidden = (data?.hiddenKeywords ?? []).some((k) => k.id === keywordId);
  const hiddenPlatforms = new Set(
    (data?.hiddenKeywordPlatforms ?? [])
      .filter((p) => p.keywordId === keywordId)
      .map((p) => p.platform),
  );

  const setKeywordHidden = async (hidden: boolean) => {
    setBusy(true);
    try {
      const res = await rawFetch(`/api/report-hides/keywords/${keywordId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      if (!res.ok) throw new Error("failed");
      toast({
        title: hidden
          ? `Hid “${keywordText}” from graphs & reports`
          : `Unhid “${keywordText}”`,
      });
      queryClient.invalidateQueries();
    } catch {
      toast({ title: "Could not update keyword", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const setPlatformHidden = async (platform: string, hidden: boolean) => {
    setBusy(true);
    try {
      const res = await rawFetch("/api/report-hides/keyword-platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordId, platform, hidden }),
      });
      if (!res.ok) throw new Error("failed");
      toast({
        title: `${hidden ? "Hid" : "Unhid"} ${PLATFORM_LABELS[platform]} for “${keywordText}”`,
      });
      queryClient.invalidateQueries();
    } catch {
      toast({ title: "Could not update platform", variant: "destructive" });
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
          className={`h-8 w-8 p-0 shrink-0 ${
            kwHidden || hiddenPlatforms.size > 0
              ? "text-amber-500 hover:text-amber-600"
              : "text-muted-foreground hover:text-primary"
          }`}
          title="Hide from graphs & reports"
          onClick={(e) => e.stopPropagation()}
        >
          {kwHidden || hiddenPlatforms.size > 0 ? (
            <Eye className="w-4 h-4" />
          ) : (
            <EyeOff className="w-4 h-4" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-3 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold truncate">“{keywordText}”</p>
        <p className="text-[11px] text-muted-foreground">
          Hides from every graph and report, including the client portal. Data
          keeps tracking; unhide any time.
        </p>
        <Button
          variant={kwHidden ? "secondary" : "outline"}
          size="sm"
          disabled={busy}
          className="w-full h-7 text-xs justify-start"
          onClick={() => setKeywordHidden(!kwHidden)}
        >
          {kwHidden ? (
            <>
              <Undo2 className="w-3 h-3 mr-1.5" /> Unhide entire keyword
            </>
          ) : (
            <>
              <EyeOff className="w-3 h-3 mr-1.5" /> Hide entire keyword
            </>
          )}
        </Button>
        <div className="border-t pt-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Per platform
          </p>
          {Object.entries(PLATFORM_LABELS).map(([key, label]) => {
            const isHidden = hiddenPlatforms.has(key);
            return (
              <div
                key={key}
                className="flex items-center justify-between text-xs"
              >
                <span className={isHidden ? "text-muted-foreground" : ""}>
                  {label}
                  {isHidden ? " · hidden" : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || kwHidden}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setPlatformHidden(key, !isHidden)}
                >
                  {isHidden ? (
                    <>
                      <Undo2 className="w-3 h-3 mr-1" /> Unhide
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-3 h-3 mr-1" /> Hide
                    </>
                  )}
                </Button>
              </div>
            );
          })}
          {kwHidden && (
            <p className="text-[10px] text-muted-foreground">
              Whole keyword is hidden — per-platform toggles apply after
              unhiding it.
            </p>
          )}
        </div>
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
  const hiddenPlatforms = data?.hiddenKeywordPlatforms ?? [];
  if (hidden.length === 0 && hiddenPlatforms.length === 0) return null;

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

  const unhidePlatform = async (p: HiddenKeywordPlatformRow) => {
    setBusy(true);
    try {
      const res = await rawFetch("/api/report-hides/keyword-platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywordId: p.keywordId,
          platform: p.platform,
          hidden: false,
        }),
      });
      if (!res.ok) throw new Error("failed");
      toast({
        title: `Unhid ${PLATFORM_LABELS[p.platform] ?? p.platform} for “${p.keywordText}”`,
      });
      queryClient.invalidateQueries();
    } catch {
      toast({ title: "Could not unhide platform", variant: "destructive" });
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
          {hidden.length + hiddenPlatforms.length} hidden
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-2">
        {hidden.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-1">Hidden keywords</p>
            <div className="max-h-40 overflow-auto space-y-1">
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
          </div>
        )}
        {hiddenPlatforms.length > 0 && (
          <div className={hidden.length > 0 ? "border-t pt-2" : ""}>
            <p className="text-xs font-semibold mb-1">Hidden platforms</p>
            <div className="max-h-40 overflow-auto space-y-1">
              {hiddenPlatforms.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="truncate">
                    “{p.keywordText}” ·{" "}
                    {PLATFORM_LABELS[p.platform] ?? p.platform}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="h-6 px-2 text-[11px] shrink-0"
                    onClick={() => unhidePlatform(p)}
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
