import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Search,
  Link2,
  MapPin,
  Smartphone,
  FileSearch,
  Users,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface MetricsData {
  plans: { name: string; totalPerDay: number; totalPerMonth: number }[];
  initialReport: {
    label: string;
    description: string;
    subtotals: { current: number[]; future: number[] };
  };
  type1: {
    label: string;
    description: string;
    percentage: number;
    searchPercentage: number;
    subtotals: { current: number[]; future: number[] };
  };
  type2: {
    label: string;
    description: string;
    percentage: number;
    note: string;
    backlinkNote: string;
    subtotals: { current: number[]; future: number[] };
  };
  totalsPerDay: { current: number[]; future: number[] };
  totalsPerMonth: { current: number[]; future: number[] };
  discrepancyReports: { id: number; label: string; description: string }[];
  userDashboard: {
    label: string;
    description: string;
    sections: { label: string; perWord: boolean }[];
  };
  liveStats: {
    totalSessionsRun: number;
    followupRate: number;
    activeClients: number;
    aeoKeywordsActive: number;
    searchesPerDayPerDevice: number;
  };
}

function CellVal({ value, highlight }: { value: number; highlight?: boolean }) {
  return (
    <td
      className={`px-4 py-2.5 text-center text-sm font-mono font-semibold tabular-nums ${
        highlight ? "text-primary" : value > 0 ? "text-foreground" : "text-muted-foreground/50"
      }`}
    >
      {value}
    </td>
  );
}

function SectionHeader({ label, icon: Icon }: { label: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-primary" />
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </div>
  );
}

export default function Metrics() {
  const { data, isLoading } = useQuery<MetricsData>({
    queryKey: ["metrics-session-breakdown"],
    queryFn: () => fetch(`${BASE}/api/metrics/session-breakdown`, { credentials: "include" }).then((r) => r.json()),
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { plans, initialReport, type1, type2, totalsPerDay, totalsPerMonth, discrepancyReports, userDashboard, liveStats } = data;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Session Metrics</h1>
        <p className="text-muted-foreground mt-1">AEO search volume breakdown by plan tier and search type</p>
      </div>

      {/* Live Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Sessions Run", value: liveStats.totalSessionsRun, icon: Search, color: "text-primary" },
          { label: "Followup Rate", value: `${liveStats.followupRate.toFixed(0)}%`, icon: TrendingUp, color: "text-emerald-400" },
          { label: "Active Clients", value: liveStats.activeClients, icon: Users, color: "text-amber-400" },
          { label: "AEO Keywords", value: liveStats.aeoKeywordsActive, icon: FileSearch, color: "text-violet-400" },
          { label: "Searches/Device/Day", value: liveStats.searchesPerDayPerDevice, icon: Smartphone, color: "text-blue-400" },
        ].map((stat) => (
          <Card key={stat.label} className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
                <span className="text-xs text-muted-foreground">{stat.label}</span>
              </div>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Plan Totals */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Plan Volume Targets
          </CardTitle>
          <CardDescription>Total AEO searches per plan tier</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div key={plan.name} className="rounded-lg border border-border/50 bg-muted/30 p-4 text-center">
                <Badge variant="outline" className="mb-2 text-primary border-primary/40">{plan.name}</Badge>
                <p className="text-2xl font-bold text-foreground">{plan.totalPerMonth.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">searches / month</p>
                <p className="text-sm font-semibold text-primary mt-1">{plan.totalPerDay}/day</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Search Type Breakdown Table */}
      <Card className="border-border/50 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            Search Type Breakdown
          </CardTitle>
          <CardDescription>
            Current process vs. future process per plan tier — showing all search categories
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-64">Search Type</th>
                  <th colSpan={3} className="px-4 py-3 text-center font-semibold text-muted-foreground border-l border-border/30">
                    Current Process
                  </th>
                  <th colSpan={3} className="px-4 py-3 text-center font-semibold text-primary border-l border-primary/20 bg-primary/5">
                    Future Process
                  </th>
                </tr>
                <tr className="border-b border-border/50 bg-muted/10">
                  <th className="px-4 py-2 text-left text-xs text-muted-foreground/70"></th>
                  {plans.map((p) => (
                    <th key={p.name} className="px-4 py-2 text-center text-xs text-muted-foreground font-mono">{p.name}</th>
                  ))}
                  {plans.map((p) => (
                    <th key={p.name} className="px-4 py-2 text-center text-xs text-primary font-mono">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {/* Initial Report */}
                <tr>
                  <td className="px-4 py-2.5 text-left" colSpan={7}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        {initialReport.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{initialReport.description}</p>
                  </td>
                </tr>
                <tr className="bg-muted/10 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-left pl-8 text-xs text-muted-foreground">% of Searches</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground/50 text-sm">—</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground/50 text-sm">—</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground/50 text-sm">—</td>
                  <td className="px-4 py-2.5 text-center text-primary/60 text-sm">5</td>
                  <td className="px-4 py-2.5 text-center text-primary/60 text-sm">5</td>
                  <td className="px-4 py-2.5 text-center text-primary/60 text-sm">5</td>
                </tr>
                <tr className="bg-muted/20 font-semibold hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 pl-8 text-xs text-muted-foreground uppercase tracking-wide">SUBTOTAL</td>
                  {initialReport.subtotals.current.map((v, i) => (
                    <CellVal key={i} value={v} />
                  ))}
                  {initialReport.subtotals.future.map((v, i) => (
                    <CellVal key={i} value={v} highlight />
                  ))}
                </tr>

                {/* Type 1 */}
                <tr>
                  <td className="px-4 py-2.5 text-left" colSpan={7}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        {type1.label}
                      </span>
                      <Badge className="bg-primary/20 text-primary text-[10px]">{type1.percentage}%</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{type1.description}</p>
                  </td>
                </tr>
                <tr className="bg-muted/10 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-left pl-8 text-xs text-muted-foreground">% of Searches</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground/50 text-sm">—</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground/50 text-sm">—</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground/50 text-sm">—</td>
                  <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono">100%</td>
                  <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono">100%</td>
                  <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono">100%</td>
                </tr>
                <tr className="bg-muted/20 font-semibold hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 pl-8 text-xs text-muted-foreground uppercase tracking-wide">SUBTOTAL</td>
                  {type1.subtotals.current.map((v, i) => (
                    <CellVal key={i} value={v} />
                  ))}
                  {type1.subtotals.future.map((v, i) => (
                    <CellVal key={i} value={v} highlight />
                  ))}
                </tr>

                {/* Type 2 */}
                <tr>
                  <td className="px-4 py-2.5 text-left" colSpan={7}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        {type2.label}
                      </span>
                      <Badge variant="outline" className="text-amber-400 border-amber-400/40 text-[10px]">{type2.percentage}%</Badge>
                    </div>
                    <p className="text-xs text-amber-400/80 mt-0.5 flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      {type2.backlinkNote}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{type2.note}</p>
                  </td>
                </tr>
                <tr className="bg-muted/20 font-semibold hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 pl-8 text-xs text-muted-foreground uppercase tracking-wide">SUBTOTAL</td>
                  {type2.subtotals.current.map((v, i) => (
                    <CellVal key={i} value={v} />
                  ))}
                  {type2.subtotals.future.map((v, i) => (
                    <CellVal key={i} value={v} highlight />
                  ))}
                </tr>

                {/* Totals */}
                <tr className="border-t-2 border-border bg-muted/30">
                  <td className="px-4 py-3 text-left font-bold text-foreground text-xs uppercase tracking-wider">TOTAL PER DAY</td>
                  {totalsPerDay.current.map((v, i) => (
                    <td key={i} className="px-4 py-3 text-center text-sm font-bold font-mono text-foreground">{v}</td>
                  ))}
                  {totalsPerDay.future.map((v, i) => (
                    <td key={i} className="px-4 py-3 text-center text-sm font-bold font-mono text-primary">{v}</td>
                  ))}
                </tr>
                <tr className="bg-primary/10 border-t border-primary/20">
                  <td className="px-4 py-3 text-left font-bold text-primary text-xs uppercase tracking-wider">TOTAL PER MONTH</td>
                  {totalsPerMonth.current.map((v, i) => (
                    <td key={i} className="px-4 py-3 text-center text-base font-bold font-mono text-foreground">{v.toLocaleString()}</td>
                  ))}
                  {totalsPerMonth.future.map((v, i) => (
                    <td key={i} className="px-4 py-3 text-center text-base font-bold font-mono text-primary">{v.toLocaleString()}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Two-column: Discrepancy Reports + User Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Discrepancy Reports */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Discrepancy Reports
            </CardTitle>
            <CardDescription>Quality control checks run per client per search cycle</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {discrepancyReports.map((report) => (
              <div
                key={report.id}
                className="flex items-start gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">{report.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{report.description}</p>
                </div>
              </div>
            ))}
            <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
              <MapPin className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-primary">Local Falcon API Integration</p>
                <p className="text-xs text-muted-foreground mt-0.5">GMB map rank tracking via Local Falcon — automated weekly pulls</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* User Dashboard */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              {userDashboard.label}
            </CardTitle>
            <CardDescription>{userDashboard.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {userDashboard.sections.map((section, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                    {i + 1}
                  </div>
                  <span className="text-sm font-medium text-foreground">{section.label}</span>
                </div>
                {section.perWord && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/50">
                    per word
                  </Badge>
                )}
              </div>
            ))}

            <div className="mt-4 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-xs font-semibold text-emerald-400 mb-1">Current Capacity</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {plans.map((plan) => (
                  <div key={plan.name}>
                    <p className="text-xs text-muted-foreground">{plan.name}</p>
                    <p className="text-base font-bold text-emerald-400">{plan.totalPerDay}<span className="text-xs font-normal text-muted-foreground">/day</span></p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
