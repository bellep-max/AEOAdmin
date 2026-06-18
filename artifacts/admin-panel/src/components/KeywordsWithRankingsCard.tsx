import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Key,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Lock,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import {
  usePeriodComparison,
  countStatuses,
  fmtPos,
  periodLabel,
  rawFetch,
  PLATFORM_COLORS,
  TOP_RANK_THRESHOLD,
  sortPlatformsWithUnavailable,
  type Period,
  type PeriodRow,
} from "@/lib/period-comparison";
import { StatusBadge, ChangeCell } from "@/components/period-badges";
import { useToast } from "@/hooks/use-toast";
import { RankingScreenshotDialog } from "@/components/RankingScreenshotDialog";

/** A keyword "wins" (locks) when BOTH its previous and current bi-weekly runs are
 *  Top-3 on the SAME platform — a sustained win across two consecutive cycles.
 *  Mirrors the server rule in services/keyword-rotation.ts (SUSTAINED_RUNS = 2);
 *  a single Top-3 run no longer shows a "Locks" badge. */
function lockTrigger(
  platforms: PeriodRow[],
): { platform: string; position: number } | null {
  let best: { platform: string; position: number } | null = null;
  for (const p of platforms) {
    const cur = p.currentPosition;
    const prev = p.previousPosition;
    const sustained =
      cur != null &&
      cur >= 1 &&
      cur <= TOP_RANK_THRESHOLD &&
      prev != null &&
      prev >= 1 &&
      prev <= TOP_RANK_THRESHOLD;
    if (sustained && (best == null || cur < best.position)) {
      best = { platform: p.platform, position: cur };
    }
  }
  return best;
}

/** Best (lowest) current rank across all platforms for this keyword. Returns
 *  Infinity when the keyword has no ranking data yet, so unranked keywords
 *  naturally fall to the bottom of an ascending sort. */
function bestCurrentRank(platforms: PeriodRow[]): number {
  let best = Infinity;
  for (const p of platforms) {
    const pos = p.currentPosition;
    if (pos != null && pos >= 1 && pos < best) best = pos;
  }
  return best;
}

/** Open the screenshot dialog with the (rankingReportId, keyword, platform,
 *  position, date) context for the rank chip the user clicked. */
interface ScreenshotTarget {
  reportId: number;
  keywordText: string;
  platform: string;
  position: number | null;
  date: string | null;
}

interface RotationLock {
  keywordId: number;
  keywordText: string;
  triggerPlatform: string;
  triggerPosition: number;
  replacement: string;
  newKeywordId: number | null;
}

interface Props {
  title?: ReactNode;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  addButton?: ReactNode;
  onEditKeyword?: (keywordId: number) => void;
  onDeleteKeyword?: (keywordId: number) => void;
  /** Keywords that exist but have no ranking data yet — still shown so the list is complete. */
  extraKeywords?: { id: number; keywordText: string }[];
  /** Show the auto-rotation controls (lock badges + "Run rotation" button) for this scope. */
  showRotation?: boolean;
  /** Called after a real rotation runs, so the parent can refetch its keyword list. */
  onRotated?: () => void;
  /** When provided, restrict the displayed keywords to exactly these ids — used
   *  to render a single bucket (e.g. only the locked/won keywords) while still
   *  pulling ranking history from the same period-comparison query. */
  restrictToKeywordIds?: number[];
  /** Render a card-level collapse toggle (chevron on the title). */
  collapsible?: boolean;
  /** When collapsible, start the card collapsed. */
  defaultCollapsed?: boolean;
  /** Locked/Won view: these keywords already graduated to Top-3, so the status
   *  column never shows a red "Declined" — while still Top-3 it reads "Won",
   *  and if it has slipped out it reads a neutral "Watch" (never negative). */
  lockedView?: boolean;
}

function PlatformChip({
  row,
  onClick,
}: {
  row: PeriodRow;
  /** When provided AND the row has a currentReportId, the chip becomes a
   *  button that opens the screenshot dialog. */
  onClick?: (target: ScreenshotTarget) => void;
}) {
  const unavailable = row.status === "unavailable";
  const cls = unavailable
    ? "bg-slate-500/10 border-slate-400/30 text-muted-foreground"
    : (PLATFORM_COLORS[row.platform] ??
      "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400");
  const arrow =
    row.change == null
      ? ""
      : row.change > 0
        ? " ↑"
        : row.change < 0
          ? " ↓"
          : " =";
  const clickable =
    !unavailable && onClick != null && row.currentReportId != null;
  const interactive = clickable
    ? "cursor-pointer hover:ring-2 hover:ring-primary/40 transition-shadow"
    : "";
  return (
    <span
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onClick!({
                reportId: row.currentReportId!,
                keywordText: row.keywordText,
                platform: row.platform,
                position: row.currentPosition,
                date: row.currentDate,
              });
            }
          : undefined
      }
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClick!({
                  reportId: row.currentReportId!,
                  keywordText: row.keywordText,
                  platform: row.platform,
                  position: row.currentPosition,
                  date: row.currentDate,
                });
              }
            }
          : undefined
      }
      title={clickable ? "Click to view screenshot" : undefined}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls} ${interactive}`}
    >
      <span className="capitalize">{row.platform}</span>
      {unavailable ? (
        <span className="font-medium opacity-80">Unavailable</span>
      ) : (
        <span className="font-bold">
          {fmtPos(row.currentPosition)}
          {arrow}
        </span>
      )}
    </span>
  );
}

export function KeywordsWithRankingsCard({
  title = "Keywords",
  clientId,
  businessId,
  aeoPlanId,
  addButton,
  onEditKeyword,
  onDeleteKeyword,
  extraKeywords,
  showRotation = false,
  onRotated,
  restrictToKeywordIds,
  collapsible = false,
  defaultCollapsed = false,
  lockedView = false,
}: Props) {
  const [period, setPeriod] = useState<Period>("weekly");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Card-level collapse (whole section), distinct from per-keyword `collapsed`.
  const [sectionCollapsed, setSectionCollapsed] = useState(defaultCollapsed);
  // Screenshot dialog target. Null when the dialog is closed.
  const [screenshotTarget, setScreenshotTarget] =
    useState<ScreenshotTarget | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = usePeriodComparison({
    period,
    clientId,
    businessId,
    aeoPlanId,
  });
  const label = periodLabel(period);

  // ── Auto-rotation (lock-on-win) ───────────────────────────────────────────
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateBusy, setRotateBusy] = useState<false | "preview" | "run">(
    false,
  );
  const [preview, setPreview] = useState<RotationLock[] | null>(null);

  async function postRotate(
    dryRun: boolean,
  ): Promise<{ scanned: number; locked: RotationLock[] }> {
    const res = await rawFetch("/api/keywords/rotate-winners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, businessId, aeoPlanId, dryRun }),
    });
    if (!res.ok) throw new Error(`rotate-winners ${res.status}`);
    return res.json();
  }

  async function runPreview(): Promise<void> {
    setRotateBusy("preview");
    try {
      const d = await postRotate(true);
      setPreview(d.locked ?? []);
      setRotateOpen(true);
    } catch (e) {
      toast({
        title: "Couldn't preview rotation",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setRotateBusy(false);
    }
  }

  async function confirmRotate(): Promise<void> {
    setRotateBusy("run");
    try {
      const d = await postRotate(false);
      const n = d.locked?.length ?? 0;
      toast({
        title: n
          ? `Locked & rotated ${n} keyword${n === 1 ? "" : "s"}`
          : "Nothing to rotate",
        description: n
          ? d.locked
              .map((l) => l.keywordText)
              .slice(0, 3)
              .join(", ") + (n > 3 ? "…" : "")
          : undefined,
      });
      setRotateOpen(false);
      setPreview(null);
      qc.invalidateQueries({
        queryKey: ["/api/ranking-reports/period-comparison"],
      });
      onRotated?.();
    } catch (e) {
      toast({
        title: "Rotation failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setRotateBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const byKeyword = new Map<
      number,
      { keywordId: number; keywordText: string; platforms: PeriodRow[] }
    >();
    for (const r of data?.rows ?? []) {
      const existing = byKeyword.get(r.keywordId);
      if (existing) existing.platforms.push(r);
      else
        byKeyword.set(r.keywordId, {
          keywordId: r.keywordId,
          keywordText: r.keywordText,
          platforms: [r],
        });
    }
    // Merge in keywords that have no ranking data yet, so the card is the canonical "keywords for this scope" list.
    for (const k of extraKeywords ?? []) {
      if (!byKeyword.has(k.id)) {
        byKeyword.set(k.id, {
          keywordId: k.id,
          keywordText: k.keywordText,
          platforms: [],
        });
      }
    }
    const list = [...byKeyword.values()];
    // Restrict the displayed set:
    //  • restrictToKeywordIds — explicit bucket (e.g. only the locked/won set),
    //  • else rotation mode — drop locked/archived keywords (they're absent from
    //    extraKeywords, the active set, even though their rank history still
    //    comes back in `data.rows`).
    const restrictSet =
      restrictToKeywordIds != null
        ? new Set(restrictToKeywordIds)
        : showRotation && extraKeywords
          ? new Set(extraKeywords.map((k) => k.id))
          : null;
    const filtered = restrictSet
      ? list.filter((g) => restrictSet.has(g.keywordId))
      : list;
    // Sort by best (lowest) current rank across all platforms, ascending.
    // Unranked / "New" keywords land at the bottom; among unranked, keep
    // alphabetical order so the bottom is stable across renders.
    return filtered.sort((a, b) => {
      const ra = bestCurrentRank(a.platforms);
      const rb = bestCurrentRank(b.platforms);
      if (ra !== rb) return ra - rb;
      return a.keywordText.localeCompare(b.keywordText);
    });
  }, [data, extraKeywords, showRotation, restrictToKeywordIds]);

  const counts = useMemo(() => countStatuses(data?.rows ?? []), [data]);

  function toggle(kid: number): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(kid)) next.delete(kid);
      else next.add(kid);
      return next;
    });
  }

  const showBody = !(collapsible && sectionCollapsed);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {collapsible ? (
              <button
                type="button"
                onClick={() => setSectionCollapsed((v) => !v)}
                className="flex items-center gap-2 text-left"
                aria-label={sectionCollapsed ? "Expand" : "Collapse"}
              >
                {sectionCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <Key className="w-4 h-4 text-primary" />
                {title}
                <span className="text-muted-foreground font-normal">
                  ({grouped.length})
                </span>
              </button>
            ) : (
              <>
                <Key className="w-4 h-4 text-primary" />
                {title}
                <span className="text-muted-foreground font-normal">
                  ({grouped.length})
                </span>
              </>
            )}
          </CardTitle>
          {showBody && (
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={period}
                onValueChange={(v) => setPeriod(v as Period)}
              >
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Biweekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="lifetime">Since start</SelectItem>
                </SelectContent>
              </Select>
              {showRotation && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  onClick={runPreview}
                  disabled={rotateBusy !== false}
                  title="Lock keywords that are Top-3 on any platform and rotate in AI replacements"
                >
                  {rotateBusy === "preview" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Run rotation
                </Button>
              )}
              {addButton}
            </div>
          )}
        </div>
        {showBody && !isLoading && (data?.rows.length ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-2">
            {counts.improved > 0 && (
              <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">
                ↑ {counts.improved}
              </Badge>
            )}
            {!lockedView && counts.declined > 0 && (
              <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30 text-[10px]">
                ↓ {counts.declined}
              </Badge>
            )}
            {counts.steady > 0 && (
              <Badge variant="outline" className="text-[10px]">
                = {counts.steady}
              </Badge>
            )}
            {counts.newCount > 0 && (
              <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30 text-[10px]">
                + {counts.newCount} new
              </Badge>
            )}
          </div>
        )}
      </CardHeader>
      {showBody && (
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Loading…
            </p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No keywords yet.{" "}
              {addButton ? "Click Add Keyword to create one." : ""}
            </p>
          ) : (
            <div className="space-y-2">
              {grouped.map(({ keywordId, keywordText, platforms }) => {
                const isOpen = !collapsed.has(keywordId);
                // Adds an "Unavailable" placeholder for any outage platform
                // (e.g. Gemini) missing from a keyword that otherwise has data.
                const sorted = sortPlatformsWithUnavailable(platforms);
                const hasData = platforms.length > 0;
                const lock = showRotation ? lockTrigger(platforms) : null;
                return (
                  <div
                    key={keywordId}
                    className="rounded-lg border border-border/40 bg-muted/10 overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => hasData && toggle(keywordId)}
                        className={`shrink-0 ${hasData ? "cursor-pointer text-muted-foreground hover:text-primary" : "cursor-default text-muted-foreground"}`}
                        disabled={!hasData}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                      >
                        {hasData ? (
                          isOpen ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )
                        ) : (
                          <Key className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Link
                          href={`/keywords?keywordId=${keywordId}`}
                          className="text-sm font-semibold text-primary hover:underline truncate"
                        >
                          {keywordText}
                        </Link>
                        {lock && (
                          <Badge
                            className="gap-1 text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 shrink-0"
                            title={`Top-3 on ${lock.platform} (#${lock.position}) — will lock & rotate`}
                          >
                            <Lock className="w-2.5 h-2.5" /> Locks ·{" "}
                            {lock.platform} #{lock.position}
                          </Badge>
                        )}
                        {!hasData && (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-muted-foreground"
                          >
                            No data yet
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                        {sorted.map((p) => (
                          <PlatformChip
                            key={`chip-${p.keywordId}-${p.platform}`}
                            row={p}
                            onClick={setScreenshotTarget}
                          />
                        ))}
                      </div>
                      {onEditKeyword && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-primary shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditKeyword(keywordId);
                          }}
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {onDeleteKeyword && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteKeyword(keywordId);
                          }}
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    {isOpen && hasData && (
                      <div className="bg-background/70 border-t border-border/40 px-3 py-2 space-y-1">
                        <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                          <div className="col-span-2">Platform</div>
                          <div className="col-span-2">First</div>
                          <div className="col-span-2">
                            {label.previousLabel}
                          </div>
                          <div className="col-span-2">{label.currentLabel}</div>
                          <div className="col-span-2">Change</div>
                          <div className="col-span-2">Status</div>
                        </div>
                        {sorted.map((p) => (
                          <div
                            key={`${p.keywordId}-${p.platform}-detail`}
                            className="px-1 py-1"
                          >
                            <div className="grid grid-cols-12 gap-2 items-center text-sm">
                              <div className="col-span-2 capitalize font-semibold">
                                {p.platform}
                              </div>
                              <div className="col-span-2 text-muted-foreground">
                                {fmtPos(p.firstPosition)}
                              </div>
                              <div className="col-span-2 text-muted-foreground">
                                {fmtPos(p.previousPosition)}
                              </div>
                              <div className="col-span-2 font-semibold">
                                {p.currentReportId != null ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setScreenshotTarget({
                                        reportId: p.currentReportId!,
                                        keywordText: p.keywordText,
                                        platform: p.platform,
                                        position: p.currentPosition,
                                        date: p.currentDate,
                                      })
                                    }
                                    className="text-primary hover:underline cursor-pointer"
                                    title="Click to view screenshot"
                                  >
                                    {fmtPos(p.currentPosition)}
                                  </button>
                                ) : (
                                  <span>{fmtPos(p.currentPosition)}</span>
                                )}
                              </div>
                              <div className="col-span-2">
                                {lockedView ? (
                                  // Locked/Won card: no red. Show the delta in a
                                  // neutral tone (never the red decline styling).
                                  <span className="text-xs text-muted-foreground">
                                    {p.change == null
                                      ? "—"
                                      : p.change > 0
                                        ? `+${p.change}`
                                        : String(p.change)}
                                  </span>
                                ) : (
                                  <ChangeCell change={p.change} />
                                )}
                              </div>
                              <div className="col-span-2">
                                {p.status === "unavailable" ? (
                                  <StatusBadge status="unavailable" />
                                ) : lockedView ? (
                                  p.currentPosition != null &&
                                  p.currentPosition <= TOP_RANK_THRESHOLD ? (
                                    <Badge className="gap-1 text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                                      <Lock className="w-2.5 h-2.5" /> Won
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] text-amber-600 border-amber-500/40 dark:text-amber-400"
                                    >
                                      Watch
                                    </Badge>
                                  )
                                ) : (
                                  <StatusBadge status={p.status} />
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-12 gap-2 text-[9px] text-muted-foreground/60 mt-0.5">
                              <div className="col-span-2" />
                              <div className="col-span-2">
                                {p.firstDate
                                  ? format(new Date(p.firstDate), "MMM d")
                                  : ""}
                              </div>
                              <div className="col-span-2">
                                {p.previousDate
                                  ? format(new Date(p.previousDate), "MMM d")
                                  : ""}
                              </div>
                              <div className="col-span-2">
                                {p.currentDate
                                  ? format(new Date(p.currentDate), "MMM d")
                                  : ""}
                              </div>
                              <div className="col-span-4" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}

      <Dialog
        open={rotateOpen}
        onOpenChange={(o) => {
          if (!o) {
            setRotateOpen(false);
            setPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-emerald-600" /> Run rotation — this
              campaign
            </DialogTitle>
            <DialogDescription>
              {preview && preview.length > 0
                ? `${preview.length} keyword${preview.length === 1 ? "" : "s"} are Top-3 on a platform and will be locked (archived) and replaced with an AI-generated keyword.`
                : "No keywords in this campaign are currently Top-3 on any platform, so nothing will be locked."}
            </DialogDescription>
          </DialogHeader>
          {preview && preview.length > 0 && (
            <div className="max-h-72 overflow-y-auto space-y-1.5 py-1">
              {preview.map((l) => (
                <div
                  key={l.keywordId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-sm"
                >
                  <span className="font-medium truncate">{l.keywordText}</span>
                  <Badge className="shrink-0 text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                    {l.triggerPlatform} #{l.triggerPosition}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRotateOpen(false);
                setPreview(null);
              }}
              disabled={rotateBusy === "run"}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmRotate}
              disabled={
                rotateBusy === "run" || !preview || preview.length === 0
              }
            >
              {rotateBusy === "run" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              {preview && preview.length > 0
                ? `Lock & rotate ${preview.length}`
                : "Nothing to rotate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RankingScreenshotDialog
        recordId={screenshotTarget?.reportId ?? null}
        endpoint="/api/ranking-reports/{id}/screenshot-url"
        onClose={() => setScreenshotTarget(null)}
        title="Rank screenshot"
        subtitle={
          screenshotTarget
            ? `${screenshotTarget.keywordText} · ${screenshotTarget.platform}`
            : undefined
        }
        rank={screenshotTarget?.position ?? null}
        date={screenshotTarget?.date ?? null}
      />
    </Card>
  );
}
