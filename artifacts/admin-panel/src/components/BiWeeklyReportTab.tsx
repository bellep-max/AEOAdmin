import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rawFetch, fmtDayET } from "@/lib/period-comparison";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Minus,
  Trophy,
} from "lucide-react";

export interface BiWeeklyReport {
  currentBatch: {
    batchDate: string;
    nextDueDate: string;
    totalSessions: number;
    uniqueCombos: number;
    uniqueBusinesses: number;
    uniqueClients: number;
    newCombos: number;
    auditType: "First-Ever Audit" | "Recurring Audit";
  } | null;
  oldFile: {
    earliestDate: string;
    latestOldDate: string;
    totalOldCombos: number;
    onSchedule: number;
    stillBehindTotal: number;
    withErrors: number;
    stillBehindByBatch: Array<{ expectedBatchDate: string; combos: number }>;
  } | null;
  rankingTrend: {
    eligibleCombos: number;
    improved: number;
    declined: number;
    noChange: number;
    notRanked: number;
  } | null;
  initialRanking: {
    totalNewCombos: number;
    buckets: {
      top3: { count: number; pct: number };
      top4to10: { count: number; pct: number };
      top11to30: { count: number; pct: number };
      beyond30: { count: number; pct: number };
      notRanked: { count: number; pct: number };
    };
  } | null;
  allBatches: Array<{ date: string; combos: number }>;
  clientMatrix?: ClientMatrixRow[];
  details?: {
    oldCombos: OldComboRow[];
    newCombos: NewComboRow[];
    rankingTrendRows: TrendRow[];
    errors: ErrorRow[];
    platformOld: PlatformOldRow[];
    platformNew: PlatformNewRow[];
    platformTrend: PlatformTrendRow[];
  };
}

interface ClientMatrixRow {
  client_id: number;
  client: string | null;
  last_batch: string;
  next_due: string;
  status_class: "on_schedule" | "overdue";
  days_overdue: number;
  batches: Array<{
    date: string;
    total: number;
    success: number;
    errors: number;
    in_top3: number;
  }>;
}

export interface OldComboRow {
  client: string | null;
  business: string | null;
  keyword_id: number;
  keyword: string;
  platform: string;
  first_audit: string;
  latest_audit: string;
  total_runs: number;
  first_rank: number | null;
  latest_rank: number | null;
  error_count: number;
  last_status: string | null;
  next_due: string;
  status_class: "on_schedule" | "overdue";
  days_overdue: number;
  rank_change: number | null;
  trend: "improved" | "declined" | "no_change" | "not_ranked" | "single_run";
}

interface NewComboRow {
  client: string | null;
  business: string | null;
  keyword: string | null;
  platform: string;
  audit_date: string;
  initial_rank: number | null;
  out_of_total: string | null;
  status: string | null;
  next_due: string;
  has_prior: boolean;
}

interface TrendRow {
  client: string | null;
  keyword: string;
  platform: string;
  first_audit: string;
  first_rank: number | null;
  latest_audit: string;
  latest_rank: number | null;
  rank_change: number | null;
  trend: "improved" | "declined" | "no_change" | "not_ranked";
}

interface ErrorRow {
  client: string | null;
  keyword: string | null;
  platform: string;
  error_date: string;
  duration: number | null;
  has_response: boolean;
  recovered: boolean;
  error_message: string | null;
}

interface PlatformOldRow {
  platform: string;
  total_combos: number;
  in_top3: number;
  in_top5: number;
  avg_rank: number | null;
  not_ranked: number;
}

interface PlatformNewRow {
  platform: string;
  total_combos: number;
  in_top3: number;
  in_top5: number;
  avg_rank: number | null;
  rank_26_plus: number;
}

interface PlatformTrendRow {
  platform: string;
  total: number;
  improved: number;
  declined: number;
  no_change: number;
  not_ranked: number;
}

interface Props {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  planType?: string | null;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromYmd);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(toYmd);
  if (!m1 || !m2) return 0;
  const a = new Date(+m1[1], +m1[2] - 1, +m1[3]);
  const b = new Date(+m2[1], +m2[2] - 1, +m2[3]);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function todayYmd(): string {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/New_York",
  });
}

export function BiWeeklyReportTab({
  clientId,
  businessId,
  aeoPlanId,
  planType = null,
}: Props) {
  const params = new URLSearchParams();
  if (clientId !== null) params.set("clientId", String(clientId));
  if (businessId !== null) params.set("businessId", String(businessId));
  if (aeoPlanId !== null) params.set("aeoPlanId", String(aeoPlanId));
  if (planType) params.set("planType", planType);
  const qs = params.toString();

  const { data, isLoading } = useQuery<BiWeeklyReport>({
    queryKey: ["/api/ranking-reports/bi-weekly-report", qs],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/ranking-reports/bi-weekly-report${qs ? `?${qs}` : ""}`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Loading bi-weekly report…
      </div>
    );
  }
  if (!data || !data.currentBatch) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No audit data available for this scope.
      </div>
    );
  }

  const { currentBatch, oldFile, rankingTrend, initialRanking, allBatches } =
    data;

  const today = todayYmd();
  const daysUntilNext = daysBetween(today, currentBatch.nextDueDate);
  const overdue = daysUntilNext < 0;

  return (
    <div className="space-y-4">
      {/* Banner — next-batch identifier */}
      <Card
        className={`border-l-4 ${
          overdue
            ? "border-l-red-500 bg-red-50/50"
            : daysUntilNext <= 3
              ? "border-l-amber-500 bg-amber-50/50"
              : "border-l-emerald-500 bg-emerald-50/50"
        }`}
      >
        <CardContent className="py-3 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarClock
              className={`w-5 h-5 ${
                overdue
                  ? "text-red-600"
                  : daysUntilNext <= 3
                    ? "text-amber-600"
                    : "text-emerald-600"
              }`}
            />
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Next bi-weekly batch due
              </div>
              <div className="text-base font-semibold">
                {fmtDayET(currentBatch.nextDueDate)}
              </div>
            </div>
          </div>
          <Badge
            variant={overdue ? "destructive" : "secondary"}
            className="text-xs"
          >
            {overdue
              ? `${Math.abs(daysUntilNext)} day${Math.abs(daysUntilNext) !== 1 ? "s" : ""} overdue`
              : daysUntilNext === 0
                ? "Due today"
                : `in ${daysUntilNext} day${daysUntilNext !== 1 ? "s" : ""}`}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Section A */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="w-1.5 h-5 bg-emerald-500 rounded-sm" />A ·
              Current Batch ({fmtDayET(currentBatch.batchDate)})
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Stat label="Total sessions" value={currentBatch.totalSessions} />
            <Stat
              label="Unique combos (biz + keyword + platform)"
              value={currentBatch.uniqueCombos}
            />
            <Stat
              label="Unique businesses"
              value={currentBatch.uniqueBusinesses}
            />
            <Stat label="Unique clients" value={currentBatch.uniqueClients} />
            <Stat
              label="Audit type"
              value={
                <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">
                  {currentBatch.auditType}
                </span>
              }
            />
            <Stat
              label="First-ever combos in this batch"
              value={currentBatch.newCombos}
            />
          </CardContent>
        </Card>

        {/* Section B */}
        {oldFile ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="w-1.5 h-5 bg-orange-500 rounded-sm" />B · Old
                File Status ({fmtDayET(oldFile.earliestDate)} –{" "}
                {fmtDayET(oldFile.latestOldDate)})
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <Stat label="Total old combos" value={oldFile.totalOldCombos} />
              <Stat
                label="On schedule"
                icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                value={oldFile.onSchedule}
              />
              <Stat
                label="Still behind (total)"
                icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                value={oldFile.stillBehindTotal}
              />
              <Stat
                label="Total with errors"
                icon={<AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
                value={oldFile.withErrors}
              />
              {oldFile.stillBehindByBatch.length > 0 ? (
                <div className="pt-2 border-t mt-3">
                  <div className="text-xs text-muted-foreground mb-1.5">
                    Behind by expected re-run date
                  </div>
                  <ul className="space-y-1">
                    {oldFile.stillBehindByBatch.map((b) => (
                      <li
                        key={b.expectedBatchDate}
                        className="flex justify-between text-xs"
                      >
                        <span className="text-muted-foreground">
                          {fmtDayET(b.expectedBatchDate)} batch
                        </span>
                        <span className="font-semibold">
                          {b.combos.toLocaleString()} combos
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Section C */}
        {rankingTrend ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="w-1.5 h-5 bg-purple-500 rounded-sm" />C ·
                Ranking Trend (Old File, 2+ runs)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground mb-3">
                {rankingTrend.eligibleCombos.toLocaleString()} combos with at
                least 2 prior runs
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TrendCell
                  label="Improved"
                  count={rankingTrend.improved}
                  total={rankingTrend.eligibleCombos}
                  icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-600" />}
                  tone="emerald"
                />
                <TrendCell
                  label="Declined"
                  count={rankingTrend.declined}
                  total={rankingTrend.eligibleCombos}
                  icon={<TrendingDown className="w-3.5 h-3.5 text-red-600" />}
                  tone="red"
                />
                <TrendCell
                  label="No change"
                  count={rankingTrend.noChange}
                  total={rankingTrend.eligibleCombos}
                  icon={<Minus className="w-3.5 h-3.5 text-slate-500" />}
                  tone="slate"
                />
                <TrendCell
                  label="Not ranked"
                  count={rankingTrend.notRanked}
                  total={rankingTrend.eligibleCombos}
                  icon={
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  }
                  tone="amber"
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Section D */}
        {initialRanking && initialRanking.totalNewCombos > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="w-1.5 h-5 bg-blue-500 rounded-sm" />D · Initial
                Ranking (new combos this batch)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground mb-3">
                {initialRanking.totalNewCombos.toLocaleString()} brand-new
                combos in the current batch
              </div>
              <div className="space-y-1.5">
                <RankBar
                  label="Top #1–3"
                  bucket={initialRanking.buckets.top3}
                  tone="emerald"
                  icon={<Trophy className="w-3.5 h-3.5 text-emerald-600" />}
                />
                <RankBar
                  label="#4–10"
                  bucket={initialRanking.buckets.top4to10}
                  tone="blue"
                />
                <RankBar
                  label="#11–30"
                  bucket={initialRanking.buckets.top11to30}
                  tone="slate"
                />
                <RankBar
                  label="Beyond #30"
                  bucket={initialRanking.buckets.beyond30}
                  tone="amber"
                />
                <RankBar
                  label="Not ranked"
                  bucket={initialRanking.buckets.notRanked}
                  tone="red"
                />
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Client Health Matrix — clients × batches grid */}
      {data.clientMatrix && data.clientMatrix.length > 0 ? (
        <ClientHealthMatrix rows={data.clientMatrix} batches={allBatches} />
      ) : null}

      {/* Detail tables — only render when payload includes details */}
      {data.details ? (
        <>
          <PlatformStandingTables details={data.details} />
          <NewCombosTable
            rows={data.details.newCombos}
            batchDate={currentBatch.batchDate}
          />
          <UnifiedCombosTable rows={data.details.oldCombos} />
          <ErrorsTable rows={data.details.errors} />
        </>
      ) : null}

      {/* Batch history */}
      {allBatches.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              All audit batches (newest first)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {allBatches.map((b, idx) => (
                <Badge
                  key={b.date}
                  variant={idx === 0 ? "default" : "outline"}
                  className="text-xs"
                >
                  {fmtDayET(b.date)} · {b.combos.toLocaleString()}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-muted-foreground text-xs flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="font-semibold">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function TrendCell({
  label,
  count,
  total,
  icon,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  icon: React.ReactNode;
  tone: "emerald" | "red" | "slate" | "amber";
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const toneClass = {
    emerald: "bg-emerald-50 border-emerald-200",
    red: "bg-red-50 border-red-200",
    slate: "bg-slate-50 border-slate-200",
    amber: "bg-amber-50 border-amber-200",
  }[tone];
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground">{pct}%</span>
      </div>
      <div className="text-lg font-semibold mt-1">{count.toLocaleString()}</div>
    </div>
  );
}

function RankBar({
  label,
  bucket,
  tone,
  icon,
}: {
  label: string;
  bucket: { count: number; pct: number };
  tone: "emerald" | "blue" | "slate" | "amber" | "red";
  icon?: React.ReactNode;
}) {
  const toneClass = {
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    slate: "bg-slate-400",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[tone];
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span className="font-semibold">
          {bucket.count.toLocaleString()}
          <span className="text-muted-foreground font-normal ml-1.5">
            ({bucket.pct}%)
          </span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full ${toneClass} transition-all`}
          style={{ width: `${Math.max(bucket.pct, 1)}%` }}
        />
      </div>
    </div>
  );
}

/* ─────────────── Detail tables ─────────────── */

function rankBandClass(rank: number | null | undefined): string {
  if (rank === null || rank === undefined || rank === 0)
    return "bg-slate-100 text-slate-700";
  if (rank <= 3) return "bg-emerald-100 text-emerald-800";
  if (rank <= 5) return "bg-blue-100 text-blue-800";
  if (rank <= 10) return "bg-amber-100 text-amber-800";
  if (rank <= 25) return "bg-orange-100 text-orange-800";
  return "bg-red-100 text-red-800";
}

function RankBadge({ rank }: { rank: number | null | undefined }) {
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 rounded text-xs font-semibold ${rankBandClass(
        rank,
      )}`}
    >
      {rank === null || rank === undefined || rank === 0 ? "—" : `#${rank}`}
    </span>
  );
}

function PlatformPill({ platform }: { platform: string }) {
  const tone =
    platform === "chatgpt"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : platform === "gemini"
        ? "bg-blue-50 text-blue-700 border-blue-200"
        : "bg-purple-50 text-purple-700 border-purple-200";
  return (
    <span
      className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${tone}`}
    >
      {platform}
    </span>
  );
}

function NewCombosTable({
  rows,
  batchDate,
}: {
  rows: NewComboRow[];
  batchDate: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3 bg-emerald-50/50">
        <CardTitle className="text-sm font-semibold">
          {fmtDayET(batchDate)} · Current Batch · {rows.length.toLocaleString()}{" "}
          rows
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left">
                <Th>Client</Th>
                <Th>Business</Th>
                <Th>Keyword</Th>
                <Th>Platform</Th>
                <Th className="text-right">Initial Rank</Th>
                <Th className="text-right">Out of</Th>
                <Th>Status</Th>
                <Th>Next due</Th>
                <Th>New?</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t hover:bg-slate-50/50">
                  <Td>{r.client ?? "—"}</Td>
                  <Td>{r.business ?? "—"}</Td>
                  <Td className="font-medium">{r.keyword ?? "—"}</Td>
                  <Td>
                    <PlatformPill platform={r.platform} />
                  </Td>
                  <Td className="text-right">
                    <RankBadge rank={r.initial_rank} />
                  </Td>
                  <Td className="text-right text-muted-foreground">
                    {r.out_of_total ?? "—"}
                  </Td>
                  <Td>
                    <Badge
                      variant={
                        r.status === "success" ? "secondary" : "destructive"
                      }
                      className="text-[10px]"
                    >
                      {r.status ?? "—"}
                    </Badge>
                  </Td>
                  <Td className="text-muted-foreground">
                    {fmtDayET(r.next_due)}
                  </Td>
                  <Td>
                    {r.has_prior ? (
                      <span className="text-[10px] text-muted-foreground">
                        recurring
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-700 font-medium">
                        first
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

type ComboFilter =
  | "all"
  | "overdue"
  | "declined"
  | "improved"
  | "no_change"
  | "not_ranked"
  | "single_run"
  | "errors";

function UnifiedCombosTable({ rows }: { rows: OldComboRow[] }) {
  const [filter, setFilter] = useState<ComboFilter>("all");
  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "overdue")
      return rows.filter((r) => r.status_class === "overdue");
    if (filter === "errors") return rows.filter((r) => r.error_count > 0);
    return rows.filter((r) => r.trend === filter);
  }, [rows, filter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      overdue: rows.filter((r) => r.status_class === "overdue").length,
      declined: rows.filter((r) => r.trend === "declined").length,
      improved: rows.filter((r) => r.trend === "improved").length,
      no_change: rows.filter((r) => r.trend === "no_change").length,
      not_ranked: rows.filter((r) => r.trend === "not_ranked").length,
      single_run: rows.filter((r) => r.trend === "single_run").length,
      errors: rows.filter((r) => r.error_count > 0).length,
    }),
    [rows],
  );

  if (rows.length === 0) return null;

  const chips: Array<{ k: ComboFilter; label: string }> = [
    { k: "all", label: "All" },
    { k: "overdue", label: "Overdue" },
    { k: "declined", label: "Declined" },
    { k: "improved", label: "Improved" },
    { k: "no_change", label: "No change" },
    { k: "not_ranked", label: "Not ranked" },
    { k: "single_run", label: "Single run" },
    { k: "errors", label: "Errors" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3 bg-slate-50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold">
            Combos · sorted by next-run date ·{" "}
            {filtered.length.toLocaleString()} of {rows.length.toLocaleString()}
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => {
              const n = counts[c.k];
              const active = filter === c.k;
              return (
                <Button
                  key={c.k}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setFilter(c.k)}
                  className="h-7 text-[11px] px-2.5 gap-1.5"
                >
                  {c.label}
                  <span
                    className={
                      active
                        ? "text-[10px] opacity-90"
                        : "text-[10px] text-muted-foreground"
                    }
                  >
                    {n.toLocaleString()}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left">
                <Th>Client</Th>
                <Th>Keyword</Th>
                <Th>Platform</Th>
                <Th>Latest audit</Th>
                <Th className="text-right">First</Th>
                <Th className="text-right">Latest</Th>
                <Th className="text-right">Δ</Th>
                <Th className="text-right">Runs</Th>
                <Th className="text-right">Errors</Th>
                <Th>Next run</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const rowKey = `${r.keyword_id}-${r.platform}`;
                const rowBg =
                  r.status_class === "overdue"
                    ? "bg-red-50/40"
                    : r.trend === "declined"
                      ? "bg-amber-50/30"
                      : r.trend === "improved"
                        ? "bg-emerald-50/30"
                        : "";
                return (
                  <tr
                    key={rowKey}
                    className={`border-t hover:bg-slate-100/60 ${rowBg}`}
                  >
                    <Td>{r.client ?? "—"}</Td>
                    <Td className="font-medium">{r.keyword}</Td>
                    <Td>
                      <PlatformPill platform={r.platform} />
                    </Td>
                    <Td className="text-muted-foreground">
                      {fmtDayET(r.latest_audit)}
                    </Td>
                    <Td className="text-right">
                      <RankBadge rank={r.first_rank} />
                    </Td>
                    <Td className="text-right">
                      <RankBadge rank={r.latest_rank} />
                    </Td>
                    <Td className="text-right">
                      <DeltaCell delta={r.rank_change} />
                    </Td>
                    <Td className="text-right">{r.total_runs}</Td>
                    <Td className="text-right">
                      {r.error_count > 0 ? (
                        <span className="text-red-600 font-semibold">
                          {r.error_count}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </Td>
                    <Td>
                      <NextRunCell
                        nextDue={r.next_due}
                        statusClass={r.status_class}
                        daysOverdue={r.days_overdue}
                      />
                    </Td>
                    <Td>
                      <TrendBadge trend={r.trend} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function DeltaCell({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-muted-foreground">—</span>;
  if (delta > 0)
    return <span className="text-emerald-700 font-semibold">+{delta}</span>;
  if (delta < 0)
    return <span className="text-red-700 font-semibold">{delta}</span>;
  return <span className="text-muted-foreground">0</span>;
}

function NextRunCell({
  nextDue,
  statusClass,
  daysOverdue,
}: {
  nextDue: string;
  statusClass: "on_schedule" | "overdue";
  daysOverdue: number;
}) {
  if (statusClass === "overdue") {
    return (
      <div className="flex flex-col">
        <span className="text-red-700 font-semibold">{fmtDayET(nextDue)}</span>
        <span className="text-[10px] text-red-600">{daysOverdue}d overdue</span>
      </div>
    );
  }
  return <span className="text-muted-foreground">{fmtDayET(nextDue)}</span>;
}

function TrendBadge({ trend }: { trend: OldComboRow["trend"] }) {
  const map: Record<OldComboRow["trend"], { label: string; cls: string }> = {
    improved: { label: "Improved", cls: "bg-emerald-100 text-emerald-800" },
    declined: { label: "Declined", cls: "bg-red-100 text-red-800" },
    no_change: { label: "No change", cls: "bg-slate-100 text-slate-700" },
    not_ranked: { label: "Not ranked", cls: "bg-amber-100 text-amber-800" },
    single_run: { label: "Single run", cls: "bg-blue-100 text-blue-800" },
  };
  const b = map[trend];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${b.cls}`}>
      {b.label}
    </span>
  );
}

function ClientHealthMatrix({
  rows,
  batches,
}: {
  rows: ClientMatrixRow[];
  batches: Array<{ date: string; combos: number }>;
}) {
  const today = todayYmd();
  const batchDates = batches.map((b) => b.date);

  return (
    <Card>
      <CardHeader className="pb-3 bg-slate-50">
        <CardTitle className="text-sm font-semibold">
          Client Health Matrix · {rows.length.toLocaleString()} clients ×{" "}
          {batches.length} batches
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (sorted: most-overdue first · cells show combos audited per batch)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left">
                <Th className="min-w-[180px] sticky left-0 bg-slate-50 z-20">
                  Client
                </Th>
                <Th>Last batch</Th>
                <Th>Next run</Th>
                <Th>Status</Th>
                {batchDates.map((d) => (
                  <Th key={d} className="text-center min-w-[64px]">
                    {fmtShortDate(d)}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cells = new Map(r.batches.map((b) => [b.date, b]));
                return (
                  <tr
                    key={r.client_id}
                    className={`border-t hover:bg-slate-100/60 ${
                      r.status_class === "overdue" ? "bg-red-50/40" : ""
                    }`}
                  >
                    <Td className="font-medium sticky left-0 bg-white z-10">
                      {r.client ?? "—"}
                    </Td>
                    <Td className="text-muted-foreground">
                      {fmtDayET(r.last_batch)}
                    </Td>
                    <Td
                      className={
                        r.status_class === "overdue"
                          ? "text-red-700 font-semibold"
                          : "text-muted-foreground"
                      }
                    >
                      {fmtDayET(r.next_due)}
                      {r.status_class === "overdue" ? (
                        <span className="ml-1 text-[10px]">
                          ({r.days_overdue}d late)
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      {r.status_class === "overdue" ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Overdue
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          On schedule
                        </Badge>
                      )}
                    </Td>
                    {batchDates.map((d) => {
                      const cell = cells.get(d);
                      return (
                        <Td key={d} className="text-center">
                          <MatrixCell
                            cell={cell ?? null}
                            isLastBatch={d === r.last_batch}
                          />
                        </Td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[10px] text-muted-foreground border-t flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            all success
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            partial errors
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            all error / not run
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-200" />
            not in batch
          </span>
          <span className="ml-auto">Today: {fmtDayET(today)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function MatrixCell({
  cell,
  isLastBatch,
}: {
  cell: {
    total: number;
    success: number;
    errors: number;
    in_top3: number;
  } | null;
  isLastBatch: boolean;
}) {
  if (!cell) {
    return <span className="inline-block w-7 h-6 rounded bg-slate-100" />;
  }
  const tone =
    cell.errors === 0
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : cell.success === 0
        ? "bg-red-100 text-red-800 border-red-200"
        : "bg-amber-100 text-amber-800 border-amber-200";
  const ring = isLastBatch ? "ring-1 ring-slate-700/40" : "";
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[34px] h-6 px-1.5 rounded border text-[10px] font-semibold ${tone} ${ring}`}
      title={`${cell.total} combos · ${cell.success} success · ${cell.errors} errors · ${cell.in_top3} in top 3`}
    >
      {cell.total}
    </span>
  );
}

function fmtShortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function ErrorsTable({ rows }: { rows: ErrorRow[] }) {
  if (rows.length === 0) return null;
  const recovered = rows.filter((r) => r.recovered).length;
  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3 bg-amber-50">
        <CardTitle className="text-sm font-semibold text-amber-900">
          Errors — {rows.length.toLocaleString()} total ·{" "}
          <span className="text-emerald-700">{recovered} recovered</span> ·{" "}
          <span className="text-red-700">
            {rows.length - recovered} unrecovered
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left">
                <Th>Client</Th>
                <Th>Keyword</Th>
                <Th>Platform</Th>
                <Th>Date</Th>
                <Th className="text-right">Duration</Th>
                <Th>Response?</Th>
                <Th>Recovered?</Th>
                <Th>Comment</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t hover:bg-slate-50/50">
                  <Td>{r.client ?? "—"}</Td>
                  <Td className="font-medium">{r.keyword ?? "—"}</Td>
                  <Td>
                    <PlatformPill platform={r.platform} />
                  </Td>
                  <Td className="text-muted-foreground">
                    {fmtDayET(r.error_date)}
                  </Td>
                  <Td className="text-right text-muted-foreground">
                    {r.duration !== null ? `${r.duration.toFixed(0)}s` : "—"}
                  </Td>
                  <Td>
                    <span
                      className={
                        r.has_response
                          ? "text-emerald-700"
                          : "text-muted-foreground"
                      }
                    >
                      {r.has_response ? "Yes" : "No"}
                    </span>
                  </Td>
                  <Td>
                    {r.recovered ? (
                      <span className="text-emerald-700 font-medium">
                        Yes ✓
                      </span>
                    ) : (
                      <span className="text-red-700 font-medium">No</span>
                    )}
                  </Td>
                  <Td className="text-muted-foreground text-[11px] truncate max-w-[300px]">
                    {r.error_message ?? "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PlatformStandingTables({
  details,
}: {
  details: NonNullable<BiWeeklyReport["details"]>;
}) {
  const { platformOld, platformNew, platformTrend } = details;
  if (
    platformOld.length === 0 &&
    platformNew.length === 0 &&
    platformTrend.length === 0
  )
    return null;
  return (
    <Card>
      <CardHeader className="pb-3 bg-violet-50/50">
        <CardTitle className="text-sm font-semibold">
          Platform Standing — current rankings per AI platform
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {platformOld.length > 0 ? (
          <div>
            <div className="text-[11px] font-semibold mb-1 text-slate-700">
              Old File — latest rank per combo
            </div>
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr className="text-left">
                  <Th>Platform</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">In Top 3</Th>
                  <Th className="text-right">In Top 5</Th>
                  <Th className="text-right">Avg rank (1–25)</Th>
                  <Th className="text-right">Not ranked</Th>
                </tr>
              </thead>
              <tbody>
                {platformOld.map((p) => (
                  <tr key={p.platform} className="border-t">
                    <Td>
                      <PlatformPill platform={p.platform} />
                    </Td>
                    <Td className="text-right">{p.total_combos}</Td>
                    <Td className="text-right">
                      {p.in_top3} ({pct(p.in_top3, p.total_combos)}%)
                    </Td>
                    <Td className="text-right">
                      {p.in_top5} ({pct(p.in_top5, p.total_combos)}%)
                    </Td>
                    <Td className="text-right font-semibold">
                      {p.avg_rank ?? "—"}
                    </Td>
                    <Td className="text-right">{p.not_ranked}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {platformNew.length > 0 ? (
          <div>
            <div className="text-[11px] font-semibold mb-1 text-slate-700">
              New File (current batch) — initial rankings
            </div>
            <table className="w-full">
              <thead className="bg-emerald-50">
                <tr className="text-left">
                  <Th>Platform</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">In Top 3</Th>
                  <Th className="text-right">In Top 5</Th>
                  <Th className="text-right">Avg rank (1–25)</Th>
                  <Th className="text-right">Rank 26+</Th>
                </tr>
              </thead>
              <tbody>
                {platformNew.map((p) => (
                  <tr key={p.platform} className="border-t">
                    <Td>
                      <PlatformPill platform={p.platform} />
                    </Td>
                    <Td className="text-right">{p.total_combos}</Td>
                    <Td className="text-right">
                      {p.in_top3} ({pct(p.in_top3, p.total_combos)}%)
                    </Td>
                    <Td className="text-right">
                      {p.in_top5} ({pct(p.in_top5, p.total_combos)}%)
                    </Td>
                    <Td className="text-right font-semibold">
                      {p.avg_rank ?? "—"}
                    </Td>
                    <Td className="text-right">{p.rank_26_plus}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {platformTrend.length > 0 ? (
          <div>
            <div className="text-[11px] font-semibold mb-1 text-slate-700">
              Old File — ranking trend by platform (first vs latest)
            </div>
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr className="text-left">
                  <Th>Platform</Th>
                  <Th className="text-right">2+ runs</Th>
                  <Th className="text-right text-emerald-700">Improved</Th>
                  <Th className="text-right text-red-700">Declined</Th>
                  <Th className="text-right text-slate-700">No change</Th>
                  <Th className="text-right text-amber-700">Not ranked</Th>
                  <Th className="text-right">Improvement %</Th>
                </tr>
              </thead>
              <tbody>
                {platformTrend.map((p) => (
                  <tr key={p.platform} className="border-t">
                    <Td>
                      <PlatformPill platform={p.platform} />
                    </Td>
                    <Td className="text-right">{p.total}</Td>
                    <Td className="text-right text-emerald-700 font-medium">
                      {p.improved}
                    </Td>
                    <Td className="text-right text-red-700 font-medium">
                      {p.declined}
                    </Td>
                    <Td className="text-right">{p.no_change}</Td>
                    <Td className="text-right text-amber-700">
                      {p.not_ranked}
                    </Td>
                    <Td className="text-right font-semibold">
                      {pct(p.improved, p.total)}%
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function pct(num: number, denom: number): string {
  if (!denom) return "0";
  return ((num / denom) * 100).toFixed(1);
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-2 py-1.5 font-semibold text-slate-700 ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-2 py-1 ${className}`}>{children}</td>;
}
