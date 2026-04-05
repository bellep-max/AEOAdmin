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
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  Activity, Users, HeartPulse, ArrowUpRight, ArrowRight, Clock,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

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

  const topClients = clients
    ?.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5) || [];

  const now     = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

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
          <span>{timeStr} · {dateStr}</span>
        </div>
      </div>

      {/* Stat cards — 3 columns (Device card removed) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Clients"
          value={summary?.totalClients}
          loading={isSummaryLoading}
          subtext={`${summary?.activeClients ?? 0} active`}
          icon={Users}
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
                      <p className="text-xs text-muted-foreground">{client.city}, {client.state}</p>
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
