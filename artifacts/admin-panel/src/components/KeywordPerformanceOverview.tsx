import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, TrendingUp, RotateCcw, ShieldAlert, Lock, ArrowRight } from "lucide-react";

// Cross-origin API (App Runner). Read endpoints accept the admin session, so we
// send credentials; the read token is optional/additive if configured.
const RANKING_API_BASE  = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const RANKING_API_TOKEN = import.meta.env.VITE_AEO_API_TOKEN ?? "";
const authHeaders: Record<string, string> = RANKING_API_TOKEN ? { Authorization: `Bearer ${RANKING_API_TOKEN}` } : {};

type DashPlatform = "chatgpt" | "gemini" | "perplexity" | "all";
const DASH_PLATFORMS: { value: DashPlatform; label: string; dot: string }[] = [
  { value: "all",        label: "All",        dot: "bg-muted-foreground" },
  { value: "chatgpt",    label: "ChatGPT",    dot: "bg-emerald-500" },
  { value: "gemini",     label: "Gemini",     dot: "bg-blue-500"    },
  { value: "perplexity", label: "Perplexity", dot: "bg-amber-500"   },
];

type Rep = { keyword: string; rankingPosition: number | null; clientId: number; platform: string; date?: string | null; timestamp?: string | null; createdAt?: string | null };

function computeRankStats(reports: Rep[]) {
  // CURRENT rank: the position from each keyword's most-recent scan per platform
  // (not best-ever). Matches the rotation lock rule.
  const latest = new Map<string, { ts: number; pos: number | null }>(); // clientId::keyword::platform
  for (const r of reports) {
    const key = `${r.clientId}::${r.keyword}::${r.platform}`;
    const ts = new Date(r.date ?? r.timestamp ?? r.createdAt ?? 0).getTime();
    const cur = latest.get(key);
    if (!cur || ts >= cur.ts) latest.set(key, { ts, pos: r.rankingPosition });
  }
  // Per keyword, current rank = best (lowest) of its latest-per-platform positions
  // → "Top-3 on ANY platform", consistent with locking. Ignore null/failed scans.
  const currentByKw = new Map<string, number>(); // clientId::keyword
  for (const [key, v] of latest) {
    if (v.pos === null || v.pos < 1) continue;
    const kwKey = key.slice(0, key.lastIndexOf("::"));
    const prev = currentByKw.get(kwKey);
    if (prev === undefined || v.pos < prev) currentByKw.set(kwKey, v.pos);
  }
  const ranks  = Array.from(currentByKw.values());
  const total  = ranks.length;
  const top1   = ranks.filter((v) => v === 1).length;
  const top3   = ranks.filter((v) => v <= 3).length;
  const top10  = ranks.filter((v) => v <= 10).length;
  const clientTop3 = new Map<number, number>();
  for (const [kwKey, pos] of currentByKw) {
    if (pos <= 3) {
      const cid = Number(kwKey.split("::")[0]);
      clientTop3.set(cid, (clientTop3.get(cid) ?? 0) + 1);
    }
  }
  return { total, top1, top3, top10,
    pctTop1:  total ? Math.round(top1  / total * 100) : 0,
    pctTop3:  total ? Math.round(top3  / total * 100) : 0,
    pctTop10: total ? Math.round(top10 / total * 100) : 0,
    clientTop3,
  };
}

function useDashboardRankingStats(platform: DashPlatform) {
  const { data: clients = [] } = useQuery({
    queryKey: ["dash-clients"],
    queryFn: async () => {
      const r = await fetch(`${RANKING_API_BASE}/api/clients?status=active&limit=200`, { credentials: "include" });
      const b = await r.json(); return (b.data ?? b) as { id: number; businessName: string }[];
    },
  });

  const { data: kwData } = useQuery({
    queryKey: ["dash-keywords"],
    queryFn: async () => {
      const [active, archived, locked] = await Promise.all([
        fetch(`${RANKING_API_BASE}/api/keywords`, { credentials: "include" }).then(r => r.json()),
        fetch(`${RANKING_API_BASE}/api/keywords?includeArchived=true`, { credentials: "include" }).then(r => r.json()),
        fetch(`${RANKING_API_BASE}/api/keywords?status=locked&includeArchived=true`, { credentials: "include" }).then(r => r.json()),
      ]);
      const activeList   = (active.data   ?? active)   as { id: number }[];
      const archivedList = (archived.data ?? archived) as { id: number; archivedAt?: string; status?: string }[];
      const lockedList   = (locked.data   ?? locked)   as { id: number }[];
      // "Locked/won" = status='locked' via rotation — stays rankable and is NOT
      // archived, so it's fetched separately (the default list hides it).
      // "archived" = manual/stalled (has archivedAt and is not locked).
      const totalLocked   = lockedList.length;
      const totalArchived = archivedList.filter((k) => k.archivedAt && k.status !== "locked").length;
      return { totalActive: activeList.length, totalArchived, totalLocked };
    },
  });

  const today     = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

  const { data: rankData, isLoading: rankLoading } = useQuery({
    queryKey: ["dash-rankings", platform, thirtyAgo, today],
    queryFn: async () => {
      const platformList: string[] = platform === "all" ? ["chatgpt", "gemini", "perplexity"] : [platform];
      const allReports = (await Promise.all(
        platformList.map(async (plt) => {
          const p = new URLSearchParams({ platform: plt, status: "success", isActive: "true", dateFrom: thirtyAgo, dateTo: today, limit: "5000" });
          const r = await fetch(`${RANKING_API_BASE}/api/ranking-reports?${p}`, { credentials: "include", headers: authHeaders });
          if (!r.ok) return [];
          const b = await r.json();
          return (b.data ?? b) as Rep[];
        }),
      )).flat();

      if (!allReports.length) return null;

      const byPlatform: Record<string, ReturnType<typeof computeRankStats>> = {};
      for (const plt of platformList) {
        byPlatform[plt] = computeRankStats(allReports.filter((r) => r.platform === plt));
      }
      const combined = computeRankStats(allReports);
      return { ...combined, byPlatform };
    },
  });

  return { clients, kwData, rankData, rankLoading };
}

export function KeywordPerformanceOverview() {
  const [dashPlatform, setDashPlatform] = useState<DashPlatform>("all");
  const { kwData, rankData, rankLoading, clients } = useDashboardRankingStats(dashPlatform);

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground">Keyword Performance Overview</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Current rank of active keywords · scans from the last 30 days (excludes locked/won)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <Card className="border-border/50 card-hover relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 gradient-bar-green" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center"><Trophy className="w-4 h-4 text-emerald-400" /></div>
              {rankLoading ? <Skeleton className="h-5 w-12" /> : <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs font-bold">#{1}</Badge>}
            </div>
            {rankLoading ? <Skeleton className="h-8 w-16 mb-1" /> : <p className="text-3xl font-bold text-foreground tabular-nums">{rankData?.pctTop1 ?? 0}%</p>}
            <p className="text-xs text-muted-foreground mt-1">Keywords ranked #1</p>
            {!rankLoading && rankData && <p className="text-xs font-medium text-emerald-400 mt-0.5">{rankData.top1} of {rankData.total} keywords</p>}
          </CardContent>
        </Card>

        <Card className="border-border/50 card-hover relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 gradient-bar-blue" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-blue-400" /></div>
              {rankLoading ? <Skeleton className="h-5 w-12" /> : <Badge className="bg-blue-500/15 text-blue-400 border-0 text-xs font-bold">Top 3</Badge>}
            </div>
            {rankLoading ? <Skeleton className="h-8 w-16 mb-1" /> : <p className="text-3xl font-bold text-foreground tabular-nums">{rankData?.pctTop3 ?? 0}%</p>}
            <p className="text-xs text-muted-foreground mt-1">Keywords in Top 3</p>
            {!rankLoading && rankData && <p className="text-xs font-medium text-blue-400 mt-0.5">{rankData.top3} of {rankData.total} keywords</p>}
          </CardContent>
        </Card>

        <Card className="border-border/50 card-hover relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 gradient-bar-amber" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center"><Lock className="w-4 h-4 text-emerald-500" /></div>
              <Link href="/keyword-rotation/locked"><Badge variant="outline" className="text-xs text-emerald-500 border-emerald-400/30 hover:bg-emerald-400/10 cursor-pointer transition-colors">View</Badge></Link>
            </div>
            {!kwData ? <Skeleton className="h-8 w-16 mb-1" /> : <p className="text-3xl font-bold text-foreground tabular-nums">{kwData.totalLocked}</p>}
            <p className="text-xs text-muted-foreground mt-1">Locked (won) keywords</p>
            {kwData && <p className="text-xs font-medium text-emerald-500 mt-0.5">{kwData.totalActive} active · {kwData.totalArchived} archived</p>}
          </CardContent>
        </Card>

        <Card className="border-border/50 card-hover relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 gradient-bar-blue" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center"><RotateCcw className="w-4 h-4 text-primary" /></div>
              {rankLoading ? <Skeleton className="h-5 w-12" /> : <Badge className="bg-primary/15 text-primary border-0 text-xs font-bold">Top 10</Badge>}
            </div>
            {rankLoading ? <Skeleton className="h-8 w-16 mb-1" /> : <p className="text-3xl font-bold text-foreground tabular-nums">{rankData?.pctTop10 ?? 0}%</p>}
            <p className="text-xs text-muted-foreground mt-1">Keywords in Top 10</p>
            {!rankLoading && rankData && <p className="text-xs font-medium text-primary mt-0.5">{rankData.top10} of {rankData.total} keywords</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
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
                  <span>Active keywords with a current ranking: <span className="font-bold text-foreground">{rankData.total}</span></span>
                  <span className="text-emerald-400 font-medium">{rankData.pctTop3}% in Top 3 ✓</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground gap-2">
                <ShieldAlert className="w-8 h-8 opacity-20" />
                <p className="text-sm">No ranking data available</p>
                <p className="text-xs opacity-60">Run an audit to populate rankings for the last 30 days</p>
              </div>
            )}
          </CardContent>
        </Card>

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
                    const client = clients.find((c) => c.id === cId);
                    const name   = client?.businessName ?? `Client ${cId}`;
                    const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                    return (
                      <Link key={cId} href={`/keyword-rotation`}>
                        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer">
                          <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">{initials}</div>
                          <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{name}</p></div>
                          <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs font-bold flex-shrink-0">{count} Top-3</Badge>
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
  );
}
