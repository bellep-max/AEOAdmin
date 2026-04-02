import { useGetStressTestStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, Gauge, ServerCrash, Clock, CheckCircle2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

export default function StressTest() {
  const { data: stats, isLoading } = useGetStressTestStats();

  const platformColors = {
    "gemini": "hsl(221, 83%, 53%)",
    "chatgpt": "hsl(152, 69%, 51%)",
    "perplexity": "hsl(38, 92%, 50%)"
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-white">System Capacity & Stress Test</h1>
        <p className="text-muted-foreground">Maximum throughput analysis for the device farm network.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-primary">Max Daily Capacity</CardTitle>
            <Zap className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <>
                <div className="text-3xl font-bold text-white">{stats?.maxSessionsPerDay.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">sessions per day</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Hourly Throughput</CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <>
                <div className="text-3xl font-bold">{stats?.estimatedCapacityPerHour.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">sessions per hour</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <>
                <div className="text-3xl font-bold">{stats?.avgSessionDurationSeconds}s</div>
                <p className="text-xs text-muted-foreground mt-1">per search session</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <>
                <div className="text-3xl font-bold text-emerald-500">{stats?.successRate}%</div>
                <p className="text-xs text-muted-foreground mt-1">across all platforms</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Platform Distribution Load</CardTitle>
            <CardDescription>Current testing distribution across AI models</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center">
            {isLoading ? <Skeleton className="h-full w-full rounded-full" /> : 
              stats?.platformDistribution && stats.platformDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.platformDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="percentage"
                      nameKey="platform"
                      label={({ platform, percentage }) => `${platform} ${percentage}%`}
                    >
                      {stats.platformDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={platformColors[entry.platform.toLowerCase() as keyof typeof platformColors] || "hsl(var(--muted))"} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-muted-foreground">No distribution data</div>
              )
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Failure Analysis</CardTitle>
            <CardDescription>Rate of dropped or timed out sessions</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="flex flex-col h-[260px] justify-center items-center text-center p-6 border rounded-xl bg-muted/20">
                <ServerCrash className="h-12 w-12 text-destructive mb-4" />
                <div className="text-5xl font-black text-destructive mb-2">{stats?.failureRate}%</div>
                <h3 className="text-xl font-bold text-foreground">Error Rate</h3>
                <p className="text-muted-foreground mt-2 max-w-sm">
                  The system maintains a low error rate under maximum capacity. Failures typically occur due to proxy rotation delays or model-side rate limiting.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Capacity Calculator Formula</CardTitle>
        </CardHeader>
        <CardContent className="font-mono text-sm text-muted-foreground space-y-2 p-6 bg-muted/30 rounded-b-xl border-t">
          <p>{`Total Daily Capacity = (Available Devices × 24 hours × 3600 seconds) / Avg Session Duration`}</p>
          <p>{`Current: (${stats?.devicesAvailable || 0} × 86400) / ${stats?.avgSessionDurationSeconds || 60} = ${stats?.maxSessionsPerDay || 0}`}</p>
          <p className="text-amber-500 mt-4">Note: Actual throughput is typically ~80% of theoretical maximum due to proxy rotation, network latency, and app restart cycles.</p>
        </CardContent>
      </Card>
    </div>
  );
}
