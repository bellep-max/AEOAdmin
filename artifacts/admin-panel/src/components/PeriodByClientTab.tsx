import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Users, Search } from "lucide-react";
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
  period: Period;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

interface ClientGroup {
  clientId: number;
  clientName: string;
  keywords: Map<number, { keyword: PeriodRow; platforms: PeriodRow[] }>;
}

const UNASSIGNED = 0;

function PlatformChip({ row }: { row: PeriodRow }) {
  const cls = PLATFORM_COLORS[row.platform] ?? "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
  const arrow =
    row.change == null ? "" : row.change > 0 ? " ↑" : row.change < 0 ? " ↓" : " =";
  const pos = fmtPos(row.currentPosition);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls}`}>
      <span className="capitalize">{row.platform}</span>
      <span className="font-bold">{pos}{arrow}</span>
    </span>
  );
}

export function PeriodByClientTab({ period, clientId, businessId, aeoPlanId }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [expandedKeyword, setExpandedKeyword] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  const { data, isLoading } = usePeriodComparison({ period, clientId, businessId, aeoPlanId });
  const label = periodLabel(period);

  const groups = useMemo<ClientGroup[]>(() => {
    const map = new Map<number, ClientGroup>();
    for (const r of data?.rows ?? []) {
      if (search && !r.keywordText.toLowerCase().includes(search.toLowerCase())) continue;
      const cid = r.clientId ?? UNASSIGNED;
      let group = map.get(cid);
      if (!group) {
        group = {
          clientId: cid,
          clientName: r.clientName ?? "Unassigned",
          keywords: new Map(),
        };
        map.set(cid, group);
      }
      const kw = group.keywords.get(r.keywordId);
      if (kw) kw.platforms.push(r);
      else group.keywords.set(r.keywordId, { keyword: r, platforms: [r] });
    }
    return [...map.values()].sort((a, b) => a.clientName.toLowerCase().localeCompare(b.clientName.toLowerCase()));
  }, [data, search]);

  // Auto-expand when a single client is filtered
  const autoExpandedClientId =
    clientId != null && groups.length === 1 ? groups[0].clientId : null;

  function isClientOpen(cid: number): boolean {
    if (autoExpandedClientId === cid) return true;
    return expanded.has(cid);
  }

  function toggleClient(cid: number): void {
    if (autoExpandedClientId === cid) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  }

  function toggleKeyword(kid: number): void {
    setExpandedKeyword((prev) => {
      const next = new Set(prev);
      if (next.has(kid)) next.delete(kid);
      else next.add(kid);
      return next;
    });
  }

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!data || data.rows.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No ranking data for {label.long.toLowerCase()} yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search keywords…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="space-y-3">
        {groups.map((g) => {
          const isOpen = isClientOpen(g.clientId);
          const allRows: PeriodRow[] = [];
          for (const kw of g.keywords.values()) allRows.push(...kw.platforms);
          const counts = countStatuses(allRows);
          const keywordCount = g.keywords.size;

          return (
            <Card key={g.clientId} className="border-border/50 overflow-hidden">
              <button type="button" onClick={() => toggleClient(g.clientId)} className="w-full text-left">
                <CardHeader className="pb-3 flex flex-row items-center gap-3">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {g.clientId !== UNASSIGNED ? (
                      <Link
                        href={`/clients/${g.clientId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-base font-bold truncate hover:text-primary hover:underline inline-block"
                      >
                        {g.clientName}
                      </Link>
                    ) : (
                      <CardTitle className="text-base font-bold truncate">{g.clientName}</CardTitle>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {keywordCount} keyword{keywordCount !== 1 ? "s" : ""} · {allRows.length} tracked across platforms
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {counts.improved > 0 && (
                      <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[11px]">
                        ↑ {counts.improved}
                      </Badge>
                    )}
                    {counts.declined > 0 && (
                      <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30 text-[11px]">
                        ↓ {counts.declined}
                      </Badge>
                    )}
                    {counts.steady > 0 && <Badge variant="outline" className="text-[11px]">= {counts.steady}</Badge>}
                    {counts.newCount > 0 && (
                      <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30 text-[11px]">
                        + {counts.newCount} new
                      </Badge>
                    )}
                  </div>
                </CardHeader>
              </button>

              {isOpen && (
                <CardContent className="pt-0 pb-4 space-y-1">
                  {[...g.keywords.values()]
                    .sort((a, b) => a.keyword.keywordText.localeCompare(b.keyword.keywordText))
                    .map(({ keyword, platforms }) => {
                      const isKwOpen = expandedKeyword.has(keyword.keywordId);
                      const sortedPlatforms = [...platforms].sort((a, b) => {
                        const ai = PLATFORM_ORDER.indexOf(a.platform as typeof PLATFORM_ORDER[number]);
                        const bi = PLATFORM_ORDER.indexOf(b.platform as typeof PLATFORM_ORDER[number]);
                        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                      });

                      return (
                        <div key={keyword.keywordId} className="rounded-lg border border-border/40 bg-muted/10 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleKeyword(keyword.keywordId)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
                          >
                            {isKwOpen ? (
                              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              {keyword.businessId != null && keyword.aeoPlanId != null ? (
                                <Link
                                  href={`/clients/${keyword.clientId}/businesses/${keyword.businessId}/campaigns/${keyword.aeoPlanId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm font-semibold text-foreground truncate hover:text-primary hover:underline inline-block"
                                >
                                  {keyword.keywordText}
                                </Link>
                              ) : (
                                <p className="text-sm font-semibold text-foreground truncate">{keyword.keywordText}</p>
                              )}
                              {keyword.businessName && keyword.businessId != null && (
                                <div className="flex items-center gap-1 text-[11px] truncate">
                                  <Link
                                    href={`/clients/${keyword.clientId}/businesses/${keyword.businessId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-primary hover:underline font-medium"
                                  >
                                    {keyword.businessName}
                                  </Link>
                                  {keyword.campaignName && keyword.aeoPlanId != null && (
                                    <>
                                      <span className="text-muted-foreground/60">·</span>
                                      <Link
                                        href={`/clients/${keyword.clientId}/businesses/${keyword.businessId}/campaigns/${keyword.aeoPlanId}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-primary hover:underline font-medium truncate"
                                      >
                                        {keyword.campaignName}
                                      </Link>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                              {sortedPlatforms.map((p) => (
                                <PlatformChip key={`chip-${p.keywordId}-${p.platform}`} row={p} />
                              ))}
                            </div>
                          </button>

                          {isKwOpen && (
                            <div className="bg-background/70 border-t border-border/40 px-3 py-2 space-y-1">
                              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                                <div className="col-span-2">Platform</div>
                                <div className="col-span-3">{label.previousLabel}</div>
                                <div className="col-span-3">{label.currentLabel}</div>
                                <div className="col-span-2">Change</div>
                                <div className="col-span-2">Status</div>
                              </div>
                              {sortedPlatforms.map((p) => (
                                <div key={`${p.keywordId}-${p.platform}-detail`} className="grid grid-cols-12 gap-2 items-center text-sm px-1 py-1">
                                  <div className="col-span-2"><PlatformChip row={p} /></div>
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
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
