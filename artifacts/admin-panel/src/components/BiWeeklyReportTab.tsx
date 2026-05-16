import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

interface BiWeeklyReport {
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
}

interface Props {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
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

export function BiWeeklyReportTab({ clientId, businessId, aeoPlanId }: Props) {
  const params = new URLSearchParams();
  if (clientId !== null) params.set("clientId", String(clientId));
  if (businessId !== null) params.set("businessId", String(businessId));
  if (aeoPlanId !== null) params.set("aeoPlanId", String(aeoPlanId));
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
