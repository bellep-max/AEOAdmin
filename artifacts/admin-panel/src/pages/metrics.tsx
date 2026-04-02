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
  Zap,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface MetricsData {
  plans: { name: string; totalPerDay: number; totalPerMonth: number }[];
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

function CellVal({ value, highlight, dash }: { value?: number; highlight?: boolean; dash?: boolean }) {
  if (dash) return <td className="px-4 py-2.5 text-center text-muted-foreground/30 text-sm select-none">—</td>;
  return (
    <td
      className={`px-4 py-2.5 text-center text-sm font-mono font-semibold tabular-nums ${
        highlight ? "text-primary" : (value ?? 0) > 0 ? "text-foreground" : "text-muted-foreground/50"
      }`}
    >
      {value}
    </td>
  );
}

export default function Metrics() {
  const { data, isLoading } = useQuery<MetricsData>({
    queryKey: ["metrics-session-breakdown"],
    queryFn: () =>
      fetch(`${BASE}/api/metrics/session-breakdown`, { credentials: "include" }).then((r) => r.json()),
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

  const { plans, type1, type2, totalsPerDay, totalsPerMonth, discrepancyReports, userDashboard, liveStats } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Session Metrics</h1>
        <p className="text-muted-foreground mt-1">
          AEO prompt search volume breakdown — Type 1 (Geo Specific) and Type 2 (Backlink)
        </p>
      </div>

      {/* Live stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Sessions Run",        value: liveStats.totalSessionsRun,            icon: Search,    color: "text-primary"    },
          { label: "Followup Rate",        value: `${liveStats.followupRate.toFixed(0)}%`, icon: TrendingUp, color: "text-emerald-400" },
          { label: "Active Clients",       value: liveStats.activeClients,               icon: Users,     color: "text-amber-400"  },
          { label: "AEO Keywords",         value: liveStats.aeoKeywordsActive,            icon: FileSearch, color: "text-violet-400" },
          { label: "Searches/Device/Day",  value: liveStats.searchesPerDayPerDevice,      icon: Smartphone, color: "text-blue-400"  },
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

      {/* Plan volume targets */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Plan Volume Targets
          </CardTitle>
          <CardDescription>Total AEO prompt searches per plan tier</CardDescription>
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

      {/* ── Search Type Breakdown Table ───────────────────────── */}
      <Card className="border-border/50 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            AEO Prompt Search Breakdown
          </CardTitle>
          <CardDescription>
            Current process vs. future process per plan tier — Type 1 (Geo Specific) and Type 2 (Backlink)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-72">Prompt Search Type</th>
                  <th
                    colSpan={3}
                    className="px-4 py-3 text-center font-semibold text-muted-foreground border-l border-border/30"
                  >
                    Current Process
                  </th>
                  <th
                    colSpan={3}
                    className="px-4 py-3 text-center font-semibold text-primary border-l border-primary/20 bg-primary/5"
                  >
                    Future Process
                  </th>
                </tr>
                <tr className="border-b border-border/50 bg-muted/10">
                  <th className="px-4 py-2 text-left text-xs text-muted-foreground/70"></th>
                  {plans.map((p) => (
                    <th key={`cur-${p.name}`} className="px-4 py-2 text-center text-xs text-muted-foreground font-mono">{p.name}</th>
                  ))}
                  {plans.map((p) => (
                    <th key={`fut-${p.name}`} className="px-4 py-2 text-center text-xs text-primary font-mono">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">

                {/* ── Type 1 ─────────────────────────────────────── */}
                <tr className="bg-muted/5">
                  <td className="px-4 py-3 text-left" colSpan={7}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                        {type1.label}
                      </span>
                      <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
                        {type1.percentage}% budget
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{type1.description}</p>
                  </td>
                </tr>

                {/* % of searches row */}
                <tr className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 pl-8 text-xs text-muted-foreground">% of Searches</td>
                  {/* current: no geo searches yet */}
                  <CellVal dash />
                  <CellVal dash />
                  <CellVal dash />
                  {/* future: 100% */}
                  <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono font-semibold">100%</td>
                  <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono font-semibold">100%</td>
                  <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono font-semibold">100%</td>
                </tr>

                {/* Subtotal row */}
                <tr className="bg-muted/20 font-semibold hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 pl-8 text-xs text-muted-foreground uppercase tracking-wide">SUBTOTAL</td>
                  {type1.subtotals.current.map((v, i) => <CellVal key={i} value={v} />)}
                  {type1.subtotals.future.map((v, i)  => <CellVal key={i} value={v} highlight />)}
                </tr>

                {/* ── Type 2 ─────────────────────────────────────── */}
                <tr className="bg-amber-500/5">
                  <td className="px-4 py-3 text-left" colSpan={7}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                        {type2.label}
                      </span>
                      <Badge variant="outline" className="text-amber-400 border-amber-400/40 text-[10px]">
                        {type2.percentage}% budget
                      </Badge>
                    </div>
                    <p className="text-xs text-amber-400/80 mt-0.5 flex items-center gap-1">
                      <Link2 className="w-3 h-3 flex-shrink-0" />
                      {type2.backlinkNote}
                    </p>
                    <div className="flex gap-4 mt-1">
                      <span className="text-xs text-muted-foreground">
                        <span className="font-semibold text-muted-foreground/80">Current:</span> search the backlink
                      </span>
                      <span className="text-xs text-primary/80">
                        <span className="font-semibold">Future:</span> do NOT search the backlink
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Subtotal row */}
                <tr className="bg-muted/20 font-semibold hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 pl-8 text-xs text-muted-foreground uppercase tracking-wide">SUBTOTAL</td>
                  {type2.subtotals.current.map((v, i) => <CellVal key={i} value={v} />)}
                  {type2.subtotals.future.map((v, i)  => <CellVal key={i} value={v} highlight />)}
                </tr>

                {/* ── Totals ─────────────────────────────────────── */}
                <tr className="border-t-2 border-border bg-muted/30">
                  <td className="px-4 py-3 text-left font-bold text-foreground text-xs uppercase tracking-wider">
                    TOTAL PER DAY
                  </td>
                  {totalsPerDay.current.map((v, i) => (
                    <td key={i} className="px-4 py-3 text-center text-sm font-bold font-mono text-foreground">{v}</td>
                  ))}
                  {totalsPerDay.future.map((v, i) => (
                    <td key={i} className="px-4 py-3 text-center text-sm font-bold font-mono text-primary">{v}</td>
                  ))}
                </tr>
                <tr className="bg-primary/10 border-t border-primary/20">
                  <td className="px-4 py-3 text-left font-bold text-primary text-xs uppercase tracking-wider">
                    TOTAL PER MONTH
                  </td>
                  {totalsPerMonth.current.map((v, i) => (
                    <td key={i} className="px-4 py-3 text-center text-base font-bold font-mono text-foreground">
                      {v.toLocaleString()}
                    </td>
                  ))}
                  {totalsPerMonth.future.map((v, i) => (
                    <td key={i} className="px-4 py-3 text-center text-base font-bold font-mono text-primary">
                      {v.toLocaleString()}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Two-column: Discrepancy Reports + User Dashboard ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Discrepancy Reports */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Discrepancy Reports
            </CardTitle>
            <CardDescription>Quality control checks run per client per AEO search cycle</CardDescription>
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
                <p className="text-xs text-muted-foreground mt-0.5">
                  GBP map rank tracking via Local Falcon — automated weekly pulls
                </p>
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
                    per keyword
                  </Badge>
                )}
              </div>
            ))}

            <div className="mt-4 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-xs font-semibold text-emerald-400 mb-2">Current Capacity</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {plans.map((plan) => (
                  <div key={plan.name}>
                    <p className="text-xs text-muted-foreground">{plan.name}</p>
                    <p className="text-base font-bold text-emerald-400">
                      {plan.totalPerDay}
                      <span className="text-xs font-normal text-muted-foreground">/day</span>
                    </p>
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
