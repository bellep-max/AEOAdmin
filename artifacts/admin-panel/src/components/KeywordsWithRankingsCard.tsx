import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Key, ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import {
  usePeriodComparison,
  countStatuses,
  fmtPos,
  periodLabel,
  PLATFORM_ORDER,
  PLATFORM_COLORS,
  type Period,
  type PeriodRow,
} from "@/lib/period-comparison";
import { StatusBadge, ChangeCell } from "@/components/period-badges";

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
}

function PlatformChip({ row }: { row: PeriodRow }) {
  const cls = PLATFORM_COLORS[row.platform] ?? "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
  const arrow = row.change == null ? "" : row.change > 0 ? " ↑" : row.change < 0 ? " ↓" : " =";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls}`}>
      <span className="capitalize">{row.platform}</span>
      <span className="font-bold">{fmtPos(row.currentPosition)}{arrow}</span>
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
}: Props) {
  const [period, setPeriod] = useState<Period>("weekly");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data, isLoading } = usePeriodComparison({ period, clientId, businessId, aeoPlanId });
  const label = periodLabel(period);

  const grouped = useMemo(() => {
    const byKeyword = new Map<number, { keywordId: number; keywordText: string; platforms: PeriodRow[] }>();
    for (const r of data?.rows ?? []) {
      const existing = byKeyword.get(r.keywordId);
      if (existing) existing.platforms.push(r);
      else byKeyword.set(r.keywordId, { keywordId: r.keywordId, keywordText: r.keywordText, platforms: [r] });
    }
    // Merge in keywords that have no ranking data yet, so the card is the canonical "keywords for this scope" list.
    for (const k of extraKeywords ?? []) {
      if (!byKeyword.has(k.id)) {
        byKeyword.set(k.id, { keywordId: k.id, keywordText: k.keywordText, platforms: [] });
      }
    }
    return [...byKeyword.values()].sort((a, b) => a.keywordText.localeCompare(b.keywordText));
  }, [data, extraKeywords]);

  const counts = useMemo(() => countStatuses(data?.rows ?? []), [data]);

  function toggle(kid: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(kid)) next.delete(kid);
      else next.add(kid);
      return next;
    });
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            {title}
            <span className="text-muted-foreground font-normal">({grouped.length})</span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="lifetime">Since start</SelectItem>
              </SelectContent>
            </Select>
            {addButton}
          </div>
        </div>
        {!isLoading && (data?.rows.length ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-2">
            {counts.improved > 0 && <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">↑ {counts.improved}</Badge>}
            {counts.declined > 0 && <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30 text-[10px]">↓ {counts.declined}</Badge>}
            {counts.steady > 0 && <Badge variant="outline" className="text-[10px]">= {counts.steady}</Badge>}
            {counts.newCount > 0 && <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30 text-[10px]">+ {counts.newCount} new</Badge>}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No keywords yet. {addButton ? "Click Add Keyword to create one." : ""}
          </p>
        ) : (
          <div className="space-y-2">
            {grouped.map(({ keywordId, keywordText, platforms }) => {
              const isOpen = expanded.has(keywordId);
              const sorted = [...platforms].sort((a, b) => {
                const ai = PLATFORM_ORDER.indexOf(a.platform as typeof PLATFORM_ORDER[number]);
                const bi = PLATFORM_ORDER.indexOf(b.platform as typeof PLATFORM_ORDER[number]);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
              });
              const hasData = platforms.length > 0;
              return (
                <div key={keywordId} className="rounded-lg border border-border/40 bg-muted/10 overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => hasData && toggle(keywordId)}
                      className={`shrink-0 ${hasData ? "cursor-pointer text-muted-foreground hover:text-primary" : "cursor-default text-muted-foreground"}`}
                      disabled={!hasData}
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      {hasData ? (
                        isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
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
                      {!hasData && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">No data yet</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      {sorted.map((p) => (
                        <PlatformChip key={`chip-${p.keywordId}-${p.platform}`} row={p} />
                      ))}
                    </div>
                    {onEditKeyword && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary shrink-0"
                        onClick={(e) => { e.stopPropagation(); onEditKeyword(keywordId); }}
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
                        onClick={(e) => { e.stopPropagation(); onDeleteKeyword(keywordId); }}
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
                        <div className="col-span-3">{label.previousLabel}</div>
                        <div className="col-span-3">{label.currentLabel}</div>
                        <div className="col-span-2">Change</div>
                        <div className="col-span-2">Status</div>
                      </div>
                      {sorted.map((p) => (
                        <div key={`${p.keywordId}-${p.platform}-detail`} className="grid grid-cols-12 gap-2 items-center text-sm px-1 py-1">
                          <div className="col-span-2 capitalize font-semibold">{p.platform}</div>
                          <div className="col-span-3 text-muted-foreground">{fmtPos(p.previousPosition)}</div>
                          <div className="col-span-3 font-semibold">{fmtPos(p.currentPosition)}</div>
                          <div className="col-span-2"><ChangeCell change={p.change} /></div>
                          <div className="col-span-2"><StatusBadge status={p.status} /></div>
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
    </Card>
  );
}
