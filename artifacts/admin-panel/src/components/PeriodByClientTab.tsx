import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Building2, Search } from "lucide-react";
import {
  usePeriodComparison,
  countStatuses,
  fmtPos,
  fmtShortET,
  periodLabel,
  PLATFORM_ORDER,
  PLATFORM_COLORS,
  type Period,
  type PeriodRow,
} from "@/lib/period-comparison";
import { StatusBadge, ChangeCell } from "@/components/period-badges";
import { RankingScreenshotDialog } from "@/components/RankingScreenshotDialog";

interface Props {
  period: Period;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  /* When true, drop keywords where no platform has a prior rank (Loose
     "has comparison" rule). State is owned by the parent so CSV/PDF
     exports respect the same toggle. */
  comparisonOnly?: boolean;
  /* "all" or a YYYY-MM-DD string (ET-anchored). When set, only keywords
     whose Current audit landed on that ET calendar day are shown. */
  auditDate?: string;
}

interface CampaignGroup {
  aeoPlanId: number;
  campaignName: string;
  clientId: number | null;
  clientName: string | null;
  businessId: number | null;
  businessName: string | null;
  keywords: { keyword: PeriodRow; platforms: PeriodRow[] }[];
}

const UNASSIGNED_PLAN = 0;

function PlatformChip({ row }: { row: PeriodRow }) {
  const cls =
    PLATFORM_COLORS[row.platform] ??
    "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
  const arrow =
    row.change == null
      ? ""
      : row.change > 0
        ? " ↑"
        : row.change < 0
          ? " ↓"
          : " =";
  const pos = fmtPos(row.currentPosition);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls}`}
    >
      <span className="capitalize">{row.platform}</span>
      <span className="font-bold">
        {pos}
        {arrow}
      </span>
    </span>
  );
}

export function PeriodByClientTab({
  period,
  clientId,
  businessId,
  aeoPlanId,
  comparisonOnly = false,
  auditDate = "all",
}: Props) {
  const [search, setSearch] = useState("");
  /* When set, opens the screenshot dialog for that ranking_reports row. */
  const [shotCell, setShotCell] = useState<{
    id: number;
    label: string;
    rank: number | null;
    date: string | null;
  } | null>(null);

  const { data, isLoading } = usePeriodComparison({
    period,
    clientId,
    businessId,
    aeoPlanId,
  });
  const label = periodLabel(period);

  const filterCounts = useMemo(() => {
    let comparable = 0;
    let newOnly = 0;
    for (const r of data?.rows ?? []) {
      if (search && !r.keywordText.toLowerCase().includes(search.toLowerCase()))
        continue;
      if (
        auditDate !== "all" &&
        (r.currentDate ?? "").slice(0, 10) !== auditDate
      )
        continue;
      if (r.previousPosition == null) newOnly++;
      else comparable++;
    }
    return { comparable, newOnly, total: comparable + newOnly };
  }, [data, search, auditDate]);

  /* Loose rule: a keyword is "comparable" if AT LEAST ONE platform has a
     prior rank. Build the set once per data change so the per-row filter
     in the campaigns loop is O(1). */
  const keywordsWithPrev = useMemo(() => {
    const s = new Set<number>();
    for (const r of data?.rows ?? []) {
      if (r.previousPosition != null) s.add(r.keywordId);
    }
    return s;
  }, [data]);

  const campaigns = useMemo<CampaignGroup[]>(() => {
    const map = new Map<number, CampaignGroup>();
    for (const r of data?.rows ?? []) {
      if (search && !r.keywordText.toLowerCase().includes(search.toLowerCase()))
        continue;
      if (
        auditDate !== "all" &&
        (r.currentDate ?? "").slice(0, 10) !== auditDate
      )
        continue;
      if (comparisonOnly && !keywordsWithPrev.has(r.keywordId)) continue;
      const pid = r.aeoPlanId ?? UNASSIGNED_PLAN;
      let group = map.get(pid);
      if (!group) {
        group = {
          aeoPlanId: pid,
          campaignName: r.campaignName ?? "Unassigned",
          clientId: r.clientId,
          clientName: r.clientName,
          businessId: r.businessId,
          businessName: r.businessName,
          keywords: [],
        };
        map.set(pid, group);
      }
      // Group by keyword within campaign
      const existing = group.keywords.find(
        (k) => k.keyword.keywordId === r.keywordId,
      );
      if (existing) {
        existing.platforms.push(r);
      } else {
        group.keywords.push({ keyword: r, platforms: [r] });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.campaignName.toLowerCase().localeCompare(b.campaignName.toLowerCase()),
    );
  }, [data, search, auditDate, comparisonOnly, keywordsWithPrev]);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
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
      <div className="flex items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search keywords…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {comparisonOnly && filterCounts.total > 0 && (
          <span className="text-xs text-muted-foreground">
            Showing {filterCounts.comparable} of {filterCounts.total}
            {filterCounts.newOnly > 0
              ? ` · ${filterCounts.newOnly} new hidden`
              : ""}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {campaigns.map((campaign) => {
          const allRows = campaign.keywords.flatMap((k) => k.platforms);
          const counts = countStatuses(allRows);
          const keywordCount = campaign.keywords.length;

          return (
            <Card
              key={campaign.aeoPlanId}
              className="border-border/50 overflow-hidden"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {campaign.aeoPlanId !== UNASSIGNED_PLAN &&
                    campaign.clientId != null &&
                    campaign.businessId != null ? (
                      <Link
                        href={`/clients/${campaign.clientId}/businesses/${campaign.businessId}/campaigns/${campaign.aeoPlanId}`}
                        className="text-base font-bold truncate hover:text-primary hover:underline inline-block"
                      >
                        {campaign.campaignName}
                      </Link>
                    ) : (
                      <CardTitle className="text-base font-bold truncate">
                        {campaign.campaignName}
                      </CardTitle>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {campaign.clientName && (
                        <span>
                          {campaign.clientName}
                          {campaign.businessName
                            ? ` · ${campaign.businessName}`
                            : ""}
                        </span>
                      )}
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
                    {counts.steady > 0 && (
                      <Badge variant="outline" className="text-[11px]">
                        = {counts.steady}
                      </Badge>
                    )}
                    {counts.newCount > 0 && (
                      <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30 text-[11px]">
                        + {counts.newCount} new
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {keywordCount} keyword{keywordCount !== 1 ? "s" : ""} ·{" "}
                  {allRows.length} tracked across platforms
                </p>
              </CardHeader>

              <CardContent className="pt-0 pb-4 space-y-2">
                {campaign.keywords
                  .sort((a, b) =>
                    a.keyword.keywordText.localeCompare(b.keyword.keywordText),
                  )
                  .map(({ keyword, platforms }) => {
                    const sortedPlatforms = [...platforms].sort((a, b) => {
                      const ai = PLATFORM_ORDER.indexOf(
                        a.platform as (typeof PLATFORM_ORDER)[number],
                      );
                      const bi = PLATFORM_ORDER.indexOf(
                        b.platform as (typeof PLATFORM_ORDER)[number],
                      );
                      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                    });

                    return (
                      <div
                        key={keyword.keywordId}
                        className="rounded-lg border border-border/40 bg-muted/10 overflow-hidden"
                      >
                        <div className="px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              {keyword.businessId != null &&
                              keyword.aeoPlanId != null ? (
                                <Link
                                  href={`/clients/${keyword.clientId}/businesses/${keyword.businessId}/campaigns/${keyword.aeoPlanId}`}
                                  className="text-sm font-semibold text-foreground truncate hover:text-primary hover:underline inline-block"
                                >
                                  {keyword.keywordText}
                                </Link>
                              ) : (
                                <p className="text-sm font-semibold text-foreground truncate">
                                  {keyword.keywordText}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                              {sortedPlatforms.map((p) => (
                                <PlatformChip
                                  key={`chip-${p.keywordId}-${p.platform}`}
                                  row={p}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="bg-background/70 border-t border-border/40 px-3 py-2 space-y-1">
                          <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                            <div className="col-span-2">Platform</div>
                            <div className="col-span-2">First</div>
                            <div className="col-span-2">
                              {label.previousLabel}
                            </div>
                            <div className="col-span-2">
                              {label.currentLabel}
                            </div>
                            <div className="col-span-2">Change</div>
                            <div className="col-span-2">Status</div>
                          </div>
                          {sortedPlatforms.map((p) => (
                            <div
                              key={`${p.keywordId}-${p.platform}-detail`}
                              className="px-1 py-1"
                            >
                              <div className="grid grid-cols-12 gap-2 items-center text-sm">
                                <div className="col-span-2">
                                  <PlatformChip row={p} />
                                </div>
                                <div className="col-span-2 text-muted-foreground">
                                  <RankCellButton
                                    reportId={p.firstReportId}
                                    rank={p.firstPosition}
                                    date={p.firstDate}
                                    label={`${p.platform} · ${p.keywordText}`}
                                    onPick={setShotCell}
                                  />
                                </div>
                                <div className="col-span-2 text-muted-foreground">
                                  <RankCellButton
                                    reportId={p.previousReportId}
                                    rank={p.previousPosition}
                                    date={p.previousDate}
                                    label={`${p.platform} · ${p.keywordText}`}
                                    onPick={setShotCell}
                                  />
                                </div>
                                <div className="col-span-2 font-semibold">
                                  <RankCellButton
                                    reportId={p.currentReportId}
                                    rank={p.currentPosition}
                                    date={p.currentDate}
                                    label={`${p.platform} · ${p.keywordText}`}
                                    onPick={setShotCell}
                                  />
                                </div>
                                <div className="col-span-2">
                                  <ChangeCell change={p.change} />
                                </div>
                                <div className="col-span-2">
                                  <StatusBadge status={p.status} />
                                </div>
                              </div>
                              <div className="grid grid-cols-12 gap-2 text-[9px] text-muted-foreground/60 mt-0.5">
                                <div className="col-span-2" />
                                <div className="col-span-2">
                                  {fmtShortET(p.firstDate)}
                                </div>
                                <div className="col-span-2">
                                  {fmtShortET(p.previousDate)}
                                </div>
                                <div className="col-span-2">
                                  {fmtShortET(p.currentDate)}
                                </div>
                                <div className="col-span-4" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <RankingScreenshotDialog
        recordId={shotCell?.id ?? null}
        endpoint="/api/ranking-reports/{id}/screenshot-url"
        onClose={() => setShotCell(null)}
        title="Audit screenshot"
        subtitle={shotCell?.label}
        rank={shotCell?.rank ?? null}
        date={shotCell?.date ?? null}
      />
    </div>
  );
}

interface RankCellButtonProps {
  reportId: number | null;
  rank: number | null;
  date: string | null;
  label: string;
  onPick: (cell: {
    id: number;
    label: string;
    rank: number | null;
    date: string | null;
  }) => void;
}

/* Click-to-view-screenshot wrapper around the rank text in each cell.
   Renders as plain text (no underline) when there's no report row to link to. */
function RankCellButton({
  reportId,
  rank,
  date,
  label,
  onPick,
}: RankCellButtonProps) {
  const text = fmtPos(rank);
  if (reportId == null) {
    return <span>{text}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onPick({ id: reportId, label, rank, date })}
      className="underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 hover:decoration-primary hover:text-primary transition-colors"
      title="View screenshot"
    >
      {text}
    </button>
  );
}
