import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  useGetDashboardSummary, 
  useGetSessionActivity, 
  useGetPlatformBreakdown, 
  useGetNetworkHealth,
  useGetClients
} from "@workspace/api-client-react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";
import { Activity, Users, Smartphone, HeartPulse } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: activity, isLoading: isActivityLoading } = useGetSessionActivity();
  const { data: platformBreakdown, isLoading: isPlatformLoading } = useGetPlatformBreakdown();
  const { data: health, isLoading: isHealthLoading } = useGetNetworkHealth();
  const { data: clients, isLoading: isClientsLoading } = useGetClients();

  const topClients = clients?.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5) || [];

  const platformColors = {
    "gemini": "hsl(221, 83%, 53%)",
    "chatgpt": "hsl(152, 69%, 51%)",
    "perplexity": "hsl(38, 92%, 50%)"
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">Network Overview</h1>
        <p className="text-muted-foreground">Monitor AEO campaign performance and infrastructure health.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Total Clients" 
          value={summary?.totalClients} 
          icon={<Users className="h-4 w-4 text-muted-foreground" />} 
          loading={isSummaryLoading}
          subtext={`${summary?.activeClients || 0} active`}
        />
        <StatCard 
          title="Sessions Today" 
          value={summary?.totalSessionsToday} 
          icon={<Activity className="h-4 w-4 text-muted-foreground" />} 
          loading={isSummaryLoading}
          subtext={`${summary?.completedToday || 0} completed`}
        />
        <StatCard 
          title="Available Devices" 
          value={summary?.availableDevices} 
          icon={<Smartphone className="h-4 w-4 text-emerald-500" />} 
          loading={isSummaryLoading}
          subtext={`out of ${summary?.totalDevices || 0} total`}
        />
        <StatCard 
          title="Network Health" 
          value={health?.score ? `${health.score}%` : undefined} 
          icon={<HeartPulse className={`h-4 w-4 ${health?.score && health.score > 90 ? 'text-emerald-500' : 'text-amber-500'}`} />} 
          loading={isHealthLoading}
          subtext={`${health?.devicesOnline || 0} devices online`}
        />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card className="col-span-1 md:col-span-2">
          <CardHeader>
            <CardTitle>Session Activity (14 Days)</CardTitle>
          </CardHeader>
          <CardContent className="h-[350px]">
            {isActivityLoading ? (
              <Skeleton className="w-full h-full" />
            ) : activity && activity.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activity} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="gemini" stroke={platformColors.gemini} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="chatgpt" stroke={platformColors.chatgpt} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="perplexity" stroke={platformColors.perplexity} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>AI Platforms</CardTitle>
          </CardHeader>
          <CardContent className="h-[350px] flex flex-col items-center justify-center">
            {isPlatformLoading ? (
              <Skeleton className="w-full h-full rounded-full" />
            ) : platformBreakdown && platformBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={platformBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="count"
                    nameKey="platform"
                  >
                    {platformBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={platformColors[entry.platform.toLowerCase() as keyof typeof platformColors] || "hsl(var(--muted))"} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Clients</CardTitle>
          </CardHeader>
          <CardContent>
            {isClientsLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="w-full h-12" />
                ))}
              </div>
            ) : topClients.length > 0 ? (
              <div className="space-y-4">
                {topClients.map(client => (
                  <Link key={client.id} href={`/clients/${client.id}`} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-sm text-foreground">{client.businessName}</p>
                      <p className="text-xs text-muted-foreground">{client.city}, {client.state}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${client.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
                        {client.status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No clients found.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Device Farm Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isHealthLoading ? (
              <div className="space-y-4">
                <Skeleton className="w-full h-8" />
                <Skeleton className="w-full h-8" />
                <Skeleton className="w-full h-8" />
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Available</span>
                    <span className="text-sm text-emerald-500">{health?.devicesOnline || 0}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${((health?.devicesOnline || 0) / ((health?.devicesOnline || 0) + (health?.devicesInUse || 0) + (health?.devicesOffline || 0)) || 1) * 100}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">In Use</span>
                    <span className="text-sm text-primary">{health?.devicesInUse || 0}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full" style={{ width: `${((health?.devicesInUse || 0) / ((health?.devicesOnline || 0) + (health?.devicesInUse || 0) + (health?.devicesOffline || 0)) || 1) * 100}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Offline</span>
                    <span className="text-sm text-destructive">{health?.devicesOffline || 0}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-destructive h-2 rounded-full" style={{ width: `${((health?.devicesOffline || 0) / ((health?.devicesOnline || 0) + (health?.devicesInUse || 0) + (health?.devicesOffline || 0)) || 1) * 100}%` }}></div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, loading, subtext }: { title: string, value?: number | string, icon: React.ReactNode, loading: boolean, subtext?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : (
          <>
            <div className="text-3xl font-bold text-foreground">{value ?? 0}</div>
            {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
