import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, ScrollText, AlertTriangle, Sparkles, ArrowUpDown, Trash2, Loader2,
  TrendingDown, TrendingUp, Activity, MapPin, GitBranch,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip, Legend,
  BarChart, Bar, XAxis, YAxis,
} from "recharts";
import { rawFetch } from "@/lib/period-comparison";
import { Markdown } from "@/lib/markdown";
import { format } from "date-fns";

interface AuditRec {
  keyword_id: number;
  platform: string;
  movement: string;
  action: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  evidence: string;
}

interface CohortRow {
  movement: MovementKey;
  keyword_count: number;
  total_sessions: number;
  avg_backlink_inject_pct: string | null;
  avg_pass_pct: string | null;
  avg_hour_stddev: string | null;
}

interface RankChangeRow {
  keyword_id: number;
  keyword: string | null;
  business: string | null;
  platform: string | null;
  current_rank: number | null;
  prev_rank: number | null;
  delta_position: number | null;
  movement: MovementKey;
}

type MovementKey =
  | "improved" | "gained_ranking" | "flat" | "declined" | "lost_ranking" | "not_ranked";

interface InputSummaryShape {
  sessionCount?: number;
  declineCount?: number;
  improvementCount?: number;
  similarPairs?: number;
  gmbMismatches?: number;
  windowSessionCount?: number;
  lookbackDays?: number;
  cohort?: CohortRow[];
  topDeclines?: RankChangeRow[];
  topImprovements?: RankChangeRow[];
  recommendationsCount?: number;
}

interface AuditReportDetail {
  id: number;
  reportDate: string;
  scope: string;
  scopeId: number | null;
  modelUsed: string | null;
  inputSummary: InputSummaryShape | null;
  reportMarkdown: string | null;
  recommendations: AuditRec[] | null;
  generatedAt: string | null;
  durationMs: number | null;
  costUsd: string | null;
}

const PRIORITY_CLS: Record<AuditRec["priority"], string> = {
  high:   "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low:    "bg-slate-500/10 text-slate-500 border-slate-500/30",
};

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

const MOVEMENT_COLOR: Record<MovementKey, string> = {
  improved:       "#22c55e",
  gained_ranking: "#10b981",
  flat:           "#94a3b8",
  declined:       "#f97316",
  lost_ranking:   "#ef4444",
  not_ranked:     "#cbd5e1",
};

const MOVEMENT_LABEL: Record<MovementKey, string> = {
  improved:       "Improved",
  gained_ranking: "Gained rank",
  flat:           "Flat",
  declined:       "Declined",
  lost_ranking:   "Lost ranking",
  not_ranked:     "Not ranked",
};

const MOVEMENT_ORDER: MovementKey[] = [
  "improved", "gained_ranking", "flat", "declined", "lost_ranking", "not_ranked",
];

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function dateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function computeWindowStart(date: string | null, lookbackDays: number | null | undefined): string | null {
  if (!date || !lookbackDays) return null;
  const end = new Date(`${date}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end);
  start.setDate(start.getDate() - lookbackDays);
  const y = start.getFullYear();
  const m = `${start.getMonth() + 1}`.padStart(2, "0");
  const d = `${start.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Pull the first sentence under "## Summary" (R1's headline finding). */
function parseSummary(md: string | null | undefined): string | null {
  if (!md) return null;
  const m = md.match(/##\s*Summary\s*\n+([^\n#]+)/i);
  return m ? m[1].trim() : null;
}

function fmtNum(n: string | null | undefined, digits = 1): string {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function fmtRank(r: number | null): string {
  if (r == null) return "off";
  return String(r);
}

interface TileProps {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
  icon?: React.ReactNode;
}

function Tile({ label, value, hint, tone = "neutral", icon }: TileProps) {
  const toneCls =
    tone === "good" ? "text-emerald-600 dark:text-emerald-500" :
    tone === "bad"  ? "text-destructive" :
    tone === "warn" ? "text-amber-600 dark:text-amber-500" :
                      "text-foreground";
  return (
    <Card className="border-border/50">
      <CardContent className="p-3.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
        {hint ? <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

export default function ReportDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();

  const [sortKey, setSortKey] = useState<"priority" | "kid" | "movement">("priority");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete report #${id}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`${BASE}/api/llm/audit-reports/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
      }
      navigate("/reports");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  const { data, isLoading, error } = useQuery<AuditReportDetail>({
    queryKey: [`/api/llm/audit-reports/${id}`],
    queryFn: async () => {
      const res = await rawFetch(`/api/llm/audit-reports/${id}`);
      if (!res.ok) throw new Error(`Failed to load report (${res.status})`);
      return res.json();
    },
    enabled: Number.isFinite(id),
  });

  const sortedRecs = useMemo(() => {
    if (!data?.recommendations) return [];
    const list = [...data.recommendations];
    if (sortKey === "priority") list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    if (sortKey === "kid") list.sort((a, b) => a.keyword_id - b.keyword_id);
    if (sortKey === "movement") list.sort((a, b) => a.movement.localeCompare(b.movement));
    return list;
  }, [data?.recommendations, sortKey]);

  const summary = data?.inputSummary ?? null;
  const cohort = summary?.cohort ?? null;
  const topDeclines = summary?.topDeclines ?? null;
  const hasCharts = !!(cohort && cohort.length);

  const headlineSummary = parseSummary(data?.reportMarkdown);
  const windowStart = computeWindowStart(data?.reportDate ?? null, summary?.lookbackDays);

  const highPriorityRecs = useMemo(
    () => sortedRecs.filter((r) => r.priority === "high").length,
    [sortedRecs],
  );

  // Donut input: keyword count per movement bucket.
  const movementSlices = useMemo(() => {
    if (!cohort) return [];
    return MOVEMENT_ORDER
      .map((m) => {
        const row = cohort.find((c) => c.movement === m);
        return row ? { name: MOVEMENT_LABEL[m], value: row.keyword_count, key: m } : null;
      })
      .filter((s): s is { name: string; value: number; key: MovementKey } => s != null && s.value > 0);
  }, [cohort]);

  // Cohort metric chart input. Three small charts (one per metric) — same x-axis.
  const cohortByMetric = useMemo(() => {
    if (!cohort) return null;
    const buckets = MOVEMENT_ORDER.map((m) => {
      const row = cohort.find((c) => c.movement === m);
      return {
        movement: m,
        label: MOVEMENT_LABEL[m],
        backlink: row?.avg_backlink_inject_pct ? Number(row.avg_backlink_inject_pct) : 0,
        pass:     row?.avg_pass_pct            ? Number(row.avg_pass_pct)            : 0,
        stddev:   row?.avg_hour_stddev         ? Number(row.avg_hour_stddev)         : 0,
        n:        row?.keyword_count ?? 0,
      };
    }).filter((r) => r.n > 0);
    return buckets;
  }, [cohort]);

  if (!Number.isFinite(id)) {
    return <div className="p-6 text-sm text-destructive">Invalid report id.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/reports">
          <Button variant="ghost" size="icon" className="mt-0.5">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
          <ScrollText className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {dateOnly(data?.reportDate)} <span className="text-sm font-normal text-muted-foreground">·</span> <span className="text-sm font-normal text-muted-foreground">audit report</span>
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {data?.scope === "all" ? "All scope" : data?.scopeId != null ? `${data?.scope} #${data?.scopeId}` : (data?.scope ?? "—")}
            </Badge>
            {summary?.lookbackDays && windowStart ? (
              <Badge variant="outline" className="text-[10px] font-mono">
                {windowStart} → {dateOnly(data?.reportDate)} ({summary.lookbackDays}d)
              </Badge>
            ) : null}
            {data?.modelUsed ? <Badge variant="secondary" className="text-[10px]">{data.modelUsed}</Badge> : null}
            {data?.durationMs ? <Badge variant="outline" className="text-[10px]">{(data.durationMs / 1000).toFixed(1)}s</Badge> : null}
            {data?.costUsd ? <Badge variant="outline" className="text-[10px]">${Number(data.costUsd).toFixed(4)}</Badge> : null}
            {data?.generatedAt ? (
              <span className="text-xs text-muted-foreground">
                Generated {format(new Date(data.generatedAt), "MMM d, h:mm a")}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={deleting || !data}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {deleting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}
          Delete
        </Button>
      </div>

      {error ? (
        <Card className="border-destructive/30">
          <CardContent className="p-4 flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="w-4 h-4" />
            {(error as Error).message}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card className="border-border/50">
          <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : data ? (
        <>
          {/* Hero — parsed Summary line + window context */}
          {headlineSummary || hasCharts ? (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  {headlineSummary ? (
                    <p className="text-base text-foreground leading-snug">{headlineSummary}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No summary line parsed from R1 output.</p>
                  )}
                  {summary?.lookbackDays && windowStart ? (
                    <p className="text-xs text-muted-foreground mt-1.5 font-mono">
                      {windowStart} → {dateOnly(data.reportDate)} · {summary.lookbackDays} days · {summary.windowSessionCount ?? 0} sessions
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Tiles */}
          {summary ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Tile
                label="Declines"
                value={summary.declineCount ?? 0}
                tone={(summary.declineCount ?? 0) > 0 ? "bad" : "neutral"}
                icon={<TrendingDown className="w-3 h-3" />}
              />
              <Tile
                label="Improvements"
                value={summary.improvementCount ?? 0}
                tone={(summary.improvementCount ?? 0) > 0 ? "good" : "neutral"}
                icon={<TrendingUp className="w-3 h-3" />}
              />
              <Tile
                label="Lost ranking"
                value={cohort?.find((c) => c.movement === "lost_ranking")?.keyword_count ?? 0}
                tone="bad"
                hint="fell out of top 50"
              />
              <Tile
                label="Similarity"
                value={summary.similarPairs ?? 0}
                tone={(summary.similarPairs ?? 0) > 0 ? "warn" : "neutral"}
                icon={<GitBranch className="w-3 h-3" />}
                hint="cannibalization pairs"
              />
              <Tile
                label="GMB mismatch"
                value={summary.gmbMismatches ?? 0}
                tone={(summary.gmbMismatches ?? 0) > 0 ? "warn" : "neutral"}
                icon={<MapPin className="w-3 h-3" />}
              />
              <Tile
                label="High-priority recs"
                value={highPriorityRecs}
                tone={highPriorityRecs > 0 ? "bad" : "neutral"}
                icon={<Activity className="w-3 h-3" />}
                hint={`${sortedRecs.length} total`}
              />
            </div>
          ) : null}

          {/* Old-report banner if no chart data */}
          {!hasCharts ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-3.5 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                <span className="text-foreground">
                  This report was generated before visual mode. Charts and tiles are unavailable.
                  Re-run an audit report for the same window to see them.
                </span>
              </CardContent>
            </Card>
          ) : null}

          {/* Charts row */}
          {hasCharts ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Movement donut */}
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Movement distribution</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Keywords by movement bucket in this window.
                  </p>
                </CardHeader>
                <CardContent className="pt-0">
                  {movementSlices.length ? (
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={movementSlices}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="55%"
                            outerRadius="85%"
                            paddingAngle={2}
                          >
                            {movementSlices.map((s) => (
                              <Cell key={s.key} fill={MOVEMENT_COLOR[s.key]} />
                            ))}
                          </Pie>
                          <ReTooltip
                            contentStyle={{
                              background: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: 6,
                              fontSize: 12,
                            }}
                            labelStyle={{ color: "hsl(var(--foreground))" }}
                          />
                          <Legend
                            verticalAlign="bottom"
                            height={32}
                            iconType="circle"
                            wrapperStyle={{ fontSize: 11 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-6 text-center">No movement data.</p>
                  )}
                </CardContent>
              </Card>

              {/* Cohort metric comparison — 3 small bar charts */}
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Cohort metrics by movement</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    What differs between improvers and decliners on the metrics R1 analyzed.
                  </p>
                </CardHeader>
                <CardContent className="pt-0">
                  {cohortByMetric && cohortByMetric.length ? (
                    <div className="grid grid-cols-3 gap-2">
                      <CohortBar data={cohortByMetric} metricKey="backlink" title="Backlink %" unit="%" />
                      <CohortBar data={cohortByMetric} metricKey="pass" title="Pass %" unit="%" />
                      <CohortBar data={cohortByMetric} metricKey="stddev" title="Hour stddev" unit="h" />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-6 text-center">No cohort data.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* Top declines table */}
          {hasCharts && topDeclines && topDeclines.length ? (
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-destructive" />
                  Top declines ({topDeclines.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Keywords whose rank fell in this window. Click KID to investigate.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">KID</TableHead>
                      <TableHead>Keyword</TableHead>
                      <TableHead>Business</TableHead>
                      <TableHead className="w-24">Platform</TableHead>
                      <TableHead className="w-20 text-right">Prev</TableHead>
                      <TableHead className="w-20 text-right">Now</TableHead>
                      <TableHead className="w-16 text-right">Δ</TableHead>
                      <TableHead className="w-28">Movement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topDeclines.map((r, i) => (
                      <TableRow key={`${r.keyword_id}-${i}`}>
                        <TableCell>
                          <Link href={`/keywords/${r.keyword_id}`}>
                            <span className="text-xs font-mono text-primary hover:underline cursor-pointer">
                              {r.keyword_id}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm truncate max-w-[200px]">
                          {r.keyword ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]">
                          {r.business ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.platform ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right">{fmtRank(r.prev_rank)}</TableCell>
                        <TableCell className="text-xs font-mono text-right">{fmtRank(r.current_rank)}</TableCell>
                        <TableCell className="text-xs font-mono text-right text-destructive">
                          {r.delta_position != null ? `+${r.delta_position}` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            style={{
                              borderColor: MOVEMENT_COLOR[r.movement] + "60",
                              color: MOVEMENT_COLOR[r.movement],
                            }}
                          >
                            {MOVEMENT_LABEL[r.movement]}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {/* Recommendations */}
          <Card className="border-border/50">
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Recommendations
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {sortedRecs.length} action{sortedRecs.length === 1 ? "" : "s"} · sorted by {sortKey}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={sortKey === "priority" ? "default" : "outline"}
                  className="h-7 text-[11px] px-2"
                  onClick={() => setSortKey("priority")}
                >Priority</Button>
                <Button
                  size="sm"
                  variant={sortKey === "kid" ? "default" : "outline"}
                  className="h-7 text-[11px] px-2"
                  onClick={() => setSortKey("kid")}
                >KID</Button>
                <Button
                  size="sm"
                  variant={sortKey === "movement" ? "default" : "outline"}
                  className="h-7 text-[11px] px-2"
                  onClick={() => setSortKey("movement")}
                >
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!sortedRecs.length ? (
                <div className="p-4 text-sm text-muted-foreground">No structured recommendations parsed.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Pri</TableHead>
                      <TableHead className="w-12">KID</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="w-32">Movement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRecs.map((r, i) => (
                      <TableRow key={`${r.keyword_id}-${i}`} className="align-top">
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] border ${PRIORITY_CLS[r.priority]}`}>
                            {r.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link href={`/keywords/${r.keyword_id}`}>
                            <span className="text-xs font-mono text-primary hover:underline cursor-pointer">
                              {r.keyword_id}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-mono text-foreground">{r.action}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.rationale}</div>
                          {r.evidence ? (
                            <div className="text-[10px] text-muted-foreground/80 mt-1 italic leading-snug">{r.evidence}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="text-[10px] text-muted-foreground">{r.movement}</div>
                          <div className="text-[10px] text-muted-foreground/80">{r.platform}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Markdown narrative — always at the bottom, fully visible */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Analyst notes</CardTitle>
              <p className="text-xs text-muted-foreground">
                Full DeepSeek-R1 narrative — context behind the tiles and recommendations above.
              </p>
            </CardHeader>
            <CardContent>
              {data.reportMarkdown ? (
                <Markdown source={data.reportMarkdown} />
              ) : (
                <div className="text-sm text-muted-foreground">No markdown body.</div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

interface CohortBarProps {
  data: Array<{
    movement: MovementKey;
    label: string;
    backlink: number;
    pass: number;
    stddev: number;
    n: number;
  }>;
  metricKey: "backlink" | "pass" | "stddev";
  title: string;
  unit: string;
}

function CohortBar({ data, metricKey, title, unit }: CohortBarProps) {
  return (
    <div>
      <p className="text-xs font-medium text-foreground mb-1">{title}</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 16 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => `${v}${unit}`}
              width={36}
            />
            <ReTooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 11,
              }}
              formatter={(v: number) => [`${v.toFixed(1)}${unit}`, title]}
              labelFormatter={(label, payload) => {
                const p = payload?.[0]?.payload as { n?: number } | undefined;
                return p?.n != null ? `${label} (n=${p.n})` : String(label);
              }}
            />
            <Bar dataKey={metricKey} radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.movement} fill={MOVEMENT_COLOR[d.movement]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
