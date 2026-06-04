import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useGetDashboardSummary,
  useGetSessionActivity,
  useGetPlatformBreakdown,
  useGetNetworkHealth,
  useGetClients,
} from "@workspace/api-client-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, RadialBarChart, RadialBar,
} from "recharts";
import {
  Activity, HeartPulse, ArrowUpRight, ArrowRight, Clock,
  UserCheck, UserX, UserPlus, Key, AlertTriangle, Link2, CheckCircle2,
  Lock, Archive, ShieldAlert, Trophy, TrendingUp, RotateCcw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

// Derive from env (Vercel rewrites /api/* to the API server) — no hardcoded host.
const RANKING_API_BASE  = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const RANKING_API_TOKEN = import.meta.env.VITE_AEO_API_TOKEN ?? "";

type DashPlatform = "chatgpt" | "gemini" | "perplexity" | "all";
const DASH_PLATFORMS: { value: DashPlatform; label: string; dot: string }[] = [
  { value: "all",        label: "All",        dot: "bg-muted-foreground" },
  { value: "chatgpt",    label: "ChatGPT",    dot: "bg-emerald-500" },
  { value: "gemini",     label: "Gemini",     dot: "bg-blue-500"    },
  { value: "perplexity", label: "Perplexity", dot: "bg-amber-500"   },
];

function computeRankStats(reports: { keyword: string; rankingPosition: number | null; clientId: number }[]) {
  const bestRank = new Map<string, number>();
  reports.forEach((r) => {
    if (r.rankingPosition === null) return;
    const key = `${r.clientId}::${r.keyword}`;
    const prev = bestRank.get(key);
    if (prev === undefined || r.rankingPosition < prev) bestRank.set(key, r.rankingPosition);
  });
  const ranks  = Array.from(bestRank.values());
  const total  = ranks.length;
  const top1   = ranks.filter((v) => v === 1).length;
  const top3   = ranks.filter((v) => v <= 3).length;
  const top10  = ranks.filter((v) => v <= 10).length;
  const clientTop3 = new Map<number, number>();
  reports.forEach((r) => {
    if (r.rankingPosition !== null && r.rankingPosition <= 3)
      clientTop3.set(r.clientId, (clientTop3.get(r.clientId) ?? 0) + 1);
  });
  return { total, top1, top3, top10,
    pctTop1:  total ? Math.round(top1  / total * 100) : 0,
    pctTop3:  total ? Math.round(top3  / total * 100) : 0,
    pctTop10: total ? Math.round(top10 / total * 100) : 0,
    clientTop3,
  };
}

function useDashboardRankingStats(platform: DashPlatform) {
  const localBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

  const { data: clients = [] } = useQuery({
    queryKey: ["dash-clients"],
    queryFn: async () => {
      const r = await fetch(`${localBase}/api/clients?status=active&limit=200`);
      const b = await r.json(); return (b.data ?? b) as { id: number; businessName: string }[];
    },
  });

  const { data: kwData } = useQuery({
    queryKey: ["dash-keywords"],
    queryFn: async () => {
      const [active, archived] = await Promise.all([
        fetch(`${localBase}/api/keywords`).then(r => r.json()),
        fetch(`${localBase}/api/keywords?includeArchived=true`).then(r => r.json()),
      ]);
      const activeList   = (active.data   ?? active)   as { id: number }[];
      const archivedList = (archived.data ?? archived) as { id: number; archivedAt?: string }[];
      return { totalActive: activeList.length, totalArchived: archivedList.filter((k) => k.archivedAt).length };
    },
  });

  const today     = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

  const { data: rankData, isLoading: rankLoading } = useQuery({
    queryKey: ["dash-rankings", platform, thirtyAgo, today],
    queryFn: async () => {
      const platformList: string[] = platform === "all" ? ["chatgpt", "gemini", "perplexity"] : [platform];

      // Fetch all platforms in parallel when "all"
      const allReports = (await Promise.all(
        platformList.map(async (plt) => {
          const p = new URLSearchParams({ platform: plt, status: "success", dateFrom: thirtyAgo, dateTo: today, limit: "1000" });
          const r = await fetch(`${RANKING_API_BASE}/api/ranking-reports?${p}`, {
            headers: { Authorization: `Bearer ${RANKING_API_TOKEN}` },
          });
          if (!r.ok) return [];
          const b = await r.json();
          return (b.data ?? b) as { keyword: string; rankingPosition: number | null; clientId: number; platform: string }[];
        }),
      )).flat();

      if (!allReports.length) return null;

      // Per-platform breakdown for the summary chips
      const byPlatform: Record<string, ReturnType<typeof computeRankStats>> = {};
      for (const plt of platformList) {
        byPlatform[plt] = computeRankStats(allReports.filter((r) => r.platform === plt));
      }
      const combined = computeRankStats(allReports);

      return { ...combined, byPlatform };
    },
    enabled: !!RANKING_API_TOKEN,
  });

  return { clients, kwData, rankData, rankLoading };
}

const platformColors: Record<string, string> = {
  "gemini":     "hsl(217,91%,62%)",
  "chatgpt":    "hsl(142,71%,47%)",
  "perplexity": "hsl(43,96%,58%)",
};

function ChartTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-card/95 backdrop-blur-md px-3 py-2.5 shadow-xl text-sm">
      <p className="font-medium text-muted-foreground mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-foreground/70 capitalize">{p.name}</span>
          <span className="ml-auto font-bold tabular-nums text-foreground">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { data: summary,           isLoading: isSummaryLoading  } = useGetDashboardSummary();
  const { data: activity,          isLoading: isActivityLoading  } = useGetSessionActivity();
  const { data: platformBreakdown, isLoading: isPlatformLoading  } = useGetPlatformBreakdown();
  const { data: health,            isLoading: isHealthLoading    } = useGetNetworkHealth();
  const { data: clients,           isLoading: isClientsLoading   } = useGetClients();
  const [dashPlatform, setDashPlatform] = useState<DashPlatform>("all");
  const { kwData, rankData, rankLoading, clients: allClients } = useDashboardRankingStats(dashPlatform);

  const topClients = clients
    ?.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5) || [];

  const oneWeekAgo     = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const activeCount    = clients?.filter((c) => c.status === "active").length ?? 0;
  const inactiveCount  = clients?.filter((c) => c.status === "inactive").length ?? 0;
  const newThisWeek    = clients?.filter((c) => new Date(c.createdAt) >= oneWeekAgo).length ?? 0;

  const now     = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });

  return (
    <div className="space-y-6 pb-4">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Network Overview</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Monitor AEO campaigns and infrastructure health</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground bg-card border border-border/50 rounded-lg px-3 py-2">
          <Clock className="w-3.5 h-3.5" />
          <span>{timeStr} ET · {dateStr}</span>
        </div>
      </div>

      {/* Stat cards — 5 columns */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          title="Active Clients"
          value={activeCount}
          loading={isClientsLoading}
          subtext="Currently active"
          icon={UserCheck}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          barClass="gradient-bar-green"
          href="/clients"
        />
        <StatCard
          title="Inactive Clients"
          value={inactiveCount}
          loading={isClientsLoading}
          subtext="Currently inactive"
          icon={UserX}
          iconColor="text-slate-400"
          iconBg="bg-slate-500/10"
          barClass="gradient-bar-blue"
          href="/clients"
        />
        <StatCard
          title="New This Week"
          value={newThisWeek}
          loading={isClientsLoading}
          subtext="Added in last 7 days"
          icon={UserPlus}
          iconColor="text-primary"
          iconBg="bg-primary/10"
          barClass="gradient-bar-blue"
          href="/clients"
        />
        <StatCard
          title="Sessions Today"
          value={summary?.totalSessionsToday}
          loading={isSummaryLoading}
          subtext={`${summary?.completedToday ?? 0} completed`}
          icon={Activity}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          barClass="gradient-bar-green"
        />
        <StatCard
          title="Network Health"
          value={health?.score ? `${health.score}%` : undefined}
          loading={isHealthLoading}
          subtext={`${health?.activeProxies ?? 0} proxies active`}
          icon={HeartPulse}
          iconColor={health?.score && health.score > 90 ? "text-emerald-400" : "text-amber-400"}
          iconBg={health?.score && health.score > 90 ? "bg-emerald-500/10" : "bg-amber-500/10"}
          barClass={health?.score && health.score > 90 ? "gradient-bar-green" : "gradient-bar-amber"}
        />
      </div>

      {/* Keyword stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Keywords"
          value={summary?.totalKeywords}
          loading={isSummaryLoading}
          subtext={`${summary?.activeKeywords ?? 0} active`}
          icon={Key}
          iconColor="text-primary"
          iconBg="bg-primary/10"
          barClass="gradient-bar-blue"
          href="/keywords/all"
        />
        <StatCard
          title="Keywords w/ Backlinks"
          value={summary?.keywordsWithBacklinks}
          loading={isSummaryLoading}
          subtext={`${summary?.totalBacklinksFound ?? 0} total backlinks found`}
          icon={Link2}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          barClass="gradient-bar-green"
          href="/keywords/all"
        />
        <StatCard
          title="Errors Today"
          value={summary?.keywordsWithErrors}
          loading={isSummaryLoading}
          subtext="Keywords with errors"
          icon={AlertTriangle}
          iconColor="text-amber-400"
          iconBg="bg-amber-500/10"
          barClass="gradient-bar-amber"
          href="/sessions/daily"
        />
        <StatCard
          title="Keywords w/ Rank"
          value={summary?.activeKeywords}
          loading={isSummaryLoading}
          subtext="Active & tracking"
          icon={CheckCircle2}
          iconColor="text-blue-400"
          iconBg="bg-blue-500/10"
          barClass="gradient-bar-blue"
          href="/rankings"
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        {/* Activity chart — spans 2 cols */}
        <Card className="lg:col-span-2 border-border/50 card-hover">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Session Activity</CardTitle>
                <CardDescription className="text-xs mt-0.5">Last 14 days — by AI platform</CardDescription>
              </div>
              <div className="flex gap-3">
                {Object.entries(platformColors).map(([name, color]) => (
                  <div key={name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    <span className="capitalize">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-64 pt-2">
            {isActivityLoading ? (
              <Skeleton className="w-full h-full rounded-xl" />
            ) : activity && activity.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activity} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    {Object.entries(platformColors).map(([name, color]) => (
                      <linearGradient key={name} id={`grad-${name}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(222,47%,18%)" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(215,20%,35%)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(215,20%,35%)" fontSize={11} tickLine={false} axisLine={false} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  {Object.entries(platformColors).map(([name, color]) => (
                    <Area
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={color}
                      strokeWidth={2}
                      fill={`url(#grad-${name})`}
                      dot={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No session activity yet" />
            )}
          </CardContent>
        </Card>

        {/* AI Platform donut */}
        <Card className="border-border/50 card-hover">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">AI Platforms</CardTitle>
            <CardDescription className="text-sm mt-0.5">Session distribution</CardDescription>
          </CardHeader>
          <CardContent className="h-64 flex flex-col items-center justify-center gap-4 pt-2">
            {isPlatformLoading ? (
              <Skeleton className="w-40 h-40 rounded-full" />
            ) : platformBreakdown && platformBreakdown.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={platformBreakdown}
                      cx="50%" cy="50%"
                      innerRadius={48} outerRadius={72}
                      paddingAngle={4}
                      dataKey="count"
                      nameKey="platform"
                    >
                      {platformBreakdown.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={platformColors[entry.platform.toLowerCase()] ?? "hsl(215,20%,35%)"}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1.5 w-full">
                  {platformBreakdown.map((entry) => {
                    const total = platformBreakdown.reduce((s, e) => s + e.count, 0);
                    const pct   = total > 0 ? Math.round((entry.count / total) * 100) : 0;
                    const color = platformColors[entry.platform.toLowerCase()] ?? "hsl(215,20%,45%)";
                    return (
                      <div key={entry.platform} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span className="text-muted-foreground capitalize flex-1">{entry.platform}</span>
                        <span className="font-semibold text-foreground tabular-nums">{entry.count}</span>
                        <span className="text-muted-foreground/60 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <EmptyState message="No session data" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Keyword Performance Overview ── */}
      <div>
        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-foreground">Keyword Performance Overview</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Last 30 days · best rank per keyword</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Platform tabs */}
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              {DASH_PLATFORMS.map((p) => (
                <button key={p.value} onClick={() => setDashPlatform(p.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${dashPlatform === p.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.dot}`} />
                  {p.label}
                </button>
              ))}
            </div>
            <Link href="/keyword-rotation">
              <Badge variant="outline" className="text-xs text-primary border-primary/30 hover:bg-primary/10 cursor-pointer gap-1 transition-colors">
                Rotation dashboard <ArrowRight className="w-3 h-3" />
              </Badge>
            </Link>
          </div>
        </div>

        {/* Per-platform mini breakdown (only shown when "all") */}
        {!rankLoading && rankData && dashPlatform === "all" && rankData.byPlatform && (
          <div className="flex flex-wrap gap-2 mb-4">
            {(["chatgpt", "gemini", "perplexity"] as const).map((plt) => {
              const s = rankData.byPlatform[plt];
              const meta = DASH_PLATFORMS.find((p) => p.value === plt)!;
              return s ? (
                <div key={plt} className="flex items-center gap-2 bg-muted/60 border border-border/40 rounded-lg px-3 py-2 text-xs">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                  <span className="font-medium">{meta.label}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-emerald-500 font-bold">#{1}: {s.pctTop1}%</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-blue-500 font-bold">Top-3: {s.pctTop3}%</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{s.total} kw</span>
                </div>
              ) : null;
            })}
          </div>
        )}

        {/* Big stat row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
          {/* Top #1 */}
          <Card className="border-border/50 card-hover relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 gradient-bar-green" />
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <Trophy className="w-4 h-4 text-emerald-400" />
                </div>
                {rankLoading ? <Skeleton className="h-5 w-12" /> : (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs font-bold">
                    #{1}
                  </Badge>
                )}
              </div>
              {rankLoading ? <Skeleton className="h-8 w-16 mb-1" /> : (
                <p className="text-3xl font-bold text-foreground tabular-nums">{rankData?.pctTop1 ?? 0}%</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Keywords ranked #1</p>
              {!rankLoading && rankData && (
                <p className="text-xs font-medium text-emerald-400 mt-0.5">{rankData.top1} of {rankData.total} keywords</p>
              )}
            </CardContent>
          </Card>

          {/* Top 1-3 */}
          <Card className="border-border/50 card-hover relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 gradient-bar-blue" />
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                </div>
                {rankLoading ? <Skeleton className="h-5 w-12" /> : (
                  <Badge className="bg-blue-500/15 text-blue-400 border-0 text-xs font-bold">Top 3</Badge>
                )}
              </div>
              {rankLoading ? <Skeleton className="h-8 w-16 mb-1" /> : (
                <p className="text-3xl font-bold text-foreground tabular-nums">{rankData?.pctTop3 ?? 0}%</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Keywords in Top 3</p>
              {!rankLoading && rankData && (
                <p className="text-xs font-medium text-blue-400 mt-0.5">{rankData.top3} of {rankData.total} keywords</p>
              )}
            </CardContent>
          </Card>

          {/* Archived */}
          <Card className="border-border/50 card-hover relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 gradient-bar-amber" />
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Archive className="w-4 h-4 text-amber-400" />
                </div>
                <Link href="/keyword-rotation/archived">
                  <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30 hover:bg-amber-400/10 cursor-pointer transition-colors">View</Badge>
                </Link>
              </div>
              {!kwData ? <Skeleton className="h-8 w-16 mb-1" /> : (
                <p className="text-3xl font-bold text-foreground tabular-nums">{kwData.totalArchived}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Archived keywords</p>
              {kwData && (
                <p className="text-xs font-medium text-amber-400 mt-0.5">{kwData.totalActive} still active</p>
              )}
            </CardContent>
          </Card>

          {/* Top 10 */}
          <Card className="border-border/50 card-hover relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 gradient-bar-blue" />
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <RotateCcw className="w-4 h-4 text-primary" />
                </div>
                {rankLoading ? <Skeleton className="h-5 w-12" /> : (
                  <Badge className="bg-primary/15 text-primary border-0 text-xs font-bold">Top 10</Badge>
                )}
              </div>
              {rankLoading ? <Skeleton className="h-8 w-16 mb-1" /> : (
                <p className="text-3xl font-bold text-foreground tabular-nums">{rankData?.pctTop10 ?? 0}%</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Keywords in Top 10</p>
              {!rankLoading && rankData && (
                <p className="text-xs font-medium text-primary mt-0.5">{rankData.top10} of {rankData.total} keywords</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Rank distribution bar + per-client top3 */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
          {/* Rank distribution visual */}
          <Card className="lg:col-span-2 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Rank Distribution</CardTitle>
              <CardDescription className="text-xs">
                {dashPlatform === "all" ? "Combined across ChatGPT, Gemini & Perplexity" : `${DASH_PLATFORMS.find(p => p.value === dashPlatform)?.label} only`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rankLoading ? (
                <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}</div>
              ) : rankData ? (
                <div className="space-y-3">
                  {[
                    { label: "Rank #1",    count: rankData.top1,                     pct: rankData.pctTop1,  color: "bg-emerald-500" },
                    { label: "Rank #2–3",  count: rankData.top3 - rankData.top1,     pct: Math.round((rankData.top3 - rankData.top1) / Math.max(rankData.total, 1) * 100), color: "bg-blue-500" },
                    { label: "Rank #4–10", count: rankData.top10 - rankData.top3,    pct: Math.round((rankData.top10 - rankData.top3) / Math.max(rankData.total, 1) * 100), color: "bg-amber-500" },
                    { label: "Rank #11+",  count: rankData.total - rankData.top10,   pct: Math.round((rankData.total - rankData.top10) / Math.max(rankData.total, 1) * 100), color: "bg-muted-foreground/30" },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{row.label}</span>
                      <div className="flex-1 h-6 bg-muted rounded-md overflow-hidden">
                        <div className={`h-full ${row.color} rounded-md transition-all`} style={{ width: `${row.pct}%` }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums w-8 text-right">{row.pct}%</span>
                      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{row.count}</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                    <span>Total tracked: <span className="font-bold text-foreground">{rankData.total}</span> keywords</span>
                    <span className="text-emerald-400 font-medium">{rankData.pctTop3}% in Top 3 ✓</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground gap-2">
                  <ShieldAlert className="w-8 h-8 opacity-20" />
                  <p className="text-sm">No ranking data available</p>
                  <p className="text-xs opacity-60">Configure VITE_AEO_API_TOKEN to load rankings</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top clients by Top-3 keywords */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Top Clients by Top-3 Keywords</CardTitle>
              <CardDescription className="text-xs">Most keywords ranked in Top 3</CardDescription>
            </CardHeader>
            <CardContent>
              {rankLoading ? (
                <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full rounded" />)}</div>
              ) : rankData && rankData.clientTop3.size > 0 ? (
                <div className="space-y-2">
                  {Array.from(rankData.clientTop3.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([cId, count]) => {
                      const client = allClients.find((c) => c.id === cId);
                      const name   = client?.businessName ?? `Client ${cId}`;
                      const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <Link key={cId} href={`/keyword-rotation`}>
                          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer">
                            <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                              {initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{name}</p>
                            </div>
                            <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs font-bold flex-shrink-0">
                              {count} Top-3
                            </Badge>
                          </div>
                        </Link>
                      );
                    })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground gap-2">
                  <Lock className="w-6 h-6 opacity-20" />
                  <p className="text-xs">No Top-3 rankings yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Clients — full width */}
      <Card className="border-border/50 card-hover">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent Clients</CardTitle>
            <Link href="/clients">
              <Badge variant="outline" className="text-xs text-primary border-primary/30 hover:bg-primary/10 cursor-pointer gap-1 transition-colors">
                View all <ArrowRight className="w-3 h-3" />
              </Badge>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {isClientsLoading ? (
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)
            ) : topClients.length > 0 ? (
              topClients.map((client) => {
                const initials = client.businessName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <Link
                    key={client.id}
                    href={`/clients/${client.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/40 hover:border-border/80 hover:bg-muted/30 transition-all cursor-pointer group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">{client.businessName}</p>
                      {!!(client as unknown as Record<string,unknown>).searchAddress && <p className="text-xs text-muted-foreground truncate">Search: {(client as unknown as Record<string,unknown>).searchAddress as string}</p>}
                      {!!(client as unknown as Record<string,unknown>).publishedAddress && <p className="text-xs text-muted-foreground truncate">GMB: {(client as unknown as Record<string,unknown>).publishedAddress as string}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                        client.status === "active"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {client.status}
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="col-span-3">
                <EmptyState message="No clients yet" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function StatCard({
  title, value, loading, subtext, icon: Icon, iconColor, iconBg, barClass, href,
}: {
  title:      string;
  value?:     number | string;
  loading:    boolean;
  subtext?:   string;
  icon:       React.ElementType;
  iconColor:  string;
  iconBg:     string;
  barClass:   string;
  href?:      string;
}) {
  const inner = (
    <Card className="border-border/50 card-hover relative overflow-hidden cursor-default group">
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${barClass}`} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center`}>
            <Icon className={`w-4.5 h-4.5 ${iconColor}`} />
          </div>
          {href && (
            <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
          )}
        </div>
        <p className="text-xs text-muted-foreground font-medium mb-1">{title}</p>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : (
          <>
            <p className="text-3xl font-bold text-foreground tracking-tight">{value ?? 0}</p>
            {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground/50">
      <Activity className="w-8 h-8 mb-2 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
