import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3, CheckCircle2, AlertTriangle, TrendingUp, Search, Link2, MapPin,
  Smartphone, FileSearch, Users, Zap, Cpu, Wifi, RefreshCcw, ShieldCheck,
  BarChart2, Pencil, Target, Info,
} from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Types ─────────────────────────────────────────────── */
interface PerformanceMetric {
  value:     number | null;
  target:    string;
  updatedAt: string | null;
  isManual?: boolean;
  // extra detail fields
  uniqueDevices?: number;
  withDevice?:    number;
  uniqueProxies?: number;
  withProxy?:     number;
  withPrompt?:    number;
  total?:         number;
  actual?:        number;
  targetCount?:   number;
}
interface PerformanceData {
  total:           number;
  deviceRotation:  PerformanceMetric;
  ipRotation:      PerformanceMetric;
  cacheClearing:   PerformanceMetric;
  promptAccuracy:  PerformanceMetric;
  volumeAccuracy:  PerformanceMetric;
}
interface MetricsData {
  plans: { name: string; totalPerDay: number; totalPerMonth: number }[];
  type1: { label: string; description: string; percentage: number; subtotals: { current: number[]; future: number[] } };
  type2: { label: string; description: string; percentage: number; note: string; backlinkNote: string; subtotals: { current: number[]; future: number[] } };
  totalsPerDay:    { current: number[]; future: number[] };
  totalsPerMonth:  { current: number[]; future: number[] };
  discrepancyReports: { id: number; label: string; description: string }[];
  userDashboard:   { label: string; description: string; sections: { label: string; perWord: boolean }[] };
  liveStats:       { totalSessionsRun: number; followupRate: number; activeClients: number; aeoKeywordsActive: number; searchesPerDayPerDevice: number };
}

/* ─── Progress bar helper ────────────────────────────────── */
function PctBar({ value, target }: { value: number | null; target: string }) {
  if (value === null) return null;
  const t       = parseFloat(target) || 100;
  const pct     = Math.min(100, (value / t) * 100);
  const barCls  = value >= t ? "bg-emerald-500" : value >= t * 0.8 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="mt-2">
      <div className="w-full h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <div className={`h-full rounded-full ${barCls} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-muted-foreground/40">0{target.includes("%") ? "%" : ""}</span>
        <span className="text-[9px] text-muted-foreground/50">Target: {target}</span>
      </div>
    </div>
  );
}

/* ─── Edit target / manual value dialog ─────────────────── */
function EditMetricDialog({
  open, onOpenChange, metricKey, label, metric, isManual, saving, onSave,
}: {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  metricKey:    string;
  label:        string;
  metric:       PerformanceMetric;
  isManual:     boolean;
  saving:       boolean;
  onSave:       (target: string, value?: string) => void;
}) {
  const [target, setTarget] = useState(metric.target);
  const [manVal, setManVal] = useState(metric.value !== null ? String(metric.value) : "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] border-border/60 bg-card">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Target className="w-4 h-4 text-primary" />
            </div>
            <DialogTitle className="text-base">{label}</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            {isManual
              ? "This metric is manually set — enter the current value and your target."
              : "This metric is computed live from session data. Set your performance target below."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {isManual && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground/60">Current Value (%)</Label>
              <Input
                className="bg-muted/30 border-border/60 h-10 text-lg font-bold font-mono"
                type="number" min={0} max={100}
                value={manVal}
                onChange={(e) => setManVal(e.target.value)}
                placeholder="e.g. 100"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground/60">Target (%)</Label>
            <Input
              className="bg-muted/30 border-border/60 h-10 font-mono"
              type="number" min={0} max={100}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. 95"
            />
          </div>
          {metric.updatedAt && (
            <p className="text-[10px] text-muted-foreground/40">
              Last updated: {format(new Date(metric.updatedAt), "MMM d, yyyy HH:mm")}
            </p>
          )}
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 border-border/50"
            onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="flex-1"
            onClick={() => onSave(target, isManual ? manVal : undefined)}
            disabled={saving || !target}
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── CellVal for the breakdown table ───────────────────── */
function CellVal({ value, highlight, dash }: { value?: number; highlight?: boolean; dash?: boolean }) {
  if (dash) return <td className="px-4 py-2.5 text-center text-muted-foreground/30 text-sm select-none">—</td>;
  return (
    <td className={`px-4 py-2.5 text-center text-sm font-mono font-semibold tabular-nums ${
      highlight ? "text-primary" : (value ?? 0) > 0 ? "text-foreground" : "text-muted-foreground/50"
    }`}>{value}</td>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/* Main Page                                                    */
/* ═══════════════════════════════════════════════════════════ */
export default function Metrics() {
  const [editKey,   setEditKey]   = useState<string | null>(null);
  const [saving,    setSaving]    = useState(false);
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const { data: perf, isLoading: perfLoading } = useQuery<PerformanceData>({
    queryKey: ["metrics-performance"],
    queryFn:  () => fetch(`${BASE}/api/metrics/performance`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data, isLoading } = useQuery<MetricsData>({
    queryKey: ["metrics-session-breakdown"],
    queryFn:  () => fetch(`${BASE}/api/metrics/session-breakdown`, { credentials: "include" }).then((r) => r.json()),
  });

  async function saveTarget(key: string, target: string, value?: string) {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/metrics/performance/${key}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ target, ...(value !== undefined ? { value } : {}) }),
      });
      await queryClient.invalidateQueries({ queryKey: ["metrics-performance"] });
      toast({ title: "Target updated" });
      setEditKey(null);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ── 5 core performance metrics definition ── */
  const perfReady = perf && perf.deviceRotation && perf.ipRotation && perf.cacheClearing && perf.promptAccuracy && perf.volumeAccuracy;
  const PERF_METRICS = perfReady ? [
    {
      key:      "device_rotation",
      label:    "Device Rotation",
      icon:     Cpu,
      color:    "text-primary",
      accent:   "bg-primary/10 border-primary/20",
      metric:   perf!.deviceRotation,
      isManual: false,
      detail:   perf!.deviceRotation.withDevice
        ? `${perf!.deviceRotation.uniqueDevices} unique devices across ${perf!.deviceRotation.withDevice} sessions`
        : "No device data yet",
      description: "% of sessions using a distinct device ID — measures how well the farm rotates hardware.",
    },
    {
      key:      "ip_rotation",
      label:    "IP Address Rotation",
      icon:     Wifi,
      color:    "text-violet-400",
      accent:   "bg-violet-500/10 border-violet-500/20",
      metric:   perf!.ipRotation,
      isManual: false,
      detail:   perf!.ipRotation.withProxy
        ? `${perf!.ipRotation.uniqueProxies} unique proxies across ${perf!.ipRotation.withProxy} sessions`
        : "No proxy data yet",
      description: "% of sessions using a unique proxy / IP address to avoid fingerprinting.",
    },
    {
      key:      "cache_clearing",
      label:    "Cache Clearing",
      icon:     RefreshCcw,
      color:    "text-emerald-400",
      accent:   "bg-emerald-500/10 border-emerald-500/20",
      metric:   perf!.cacheClearing,
      isManual: true,
      detail:   "Manual — set actual % below via edit",
      description: "% of sessions where device app cache is fully cleared before prompt execution.",
    },
    {
      key:      "prompt_exec_accuracy",
      label:    "Prompt Execution Accuracy",
      icon:     ShieldCheck,
      color:    "text-amber-400",
      accent:   "bg-amber-500/10 border-amber-500/20",
      metric:   perf!.promptAccuracy,
      isManual: false,
      detail:   `${perf!.promptAccuracy.withPrompt ?? 0} of ${perf!.promptAccuracy.total ?? 0} sessions executed with prompt`,
      description: "% of sessions that successfully executed an AEO prompt without error or timeout.",
    },
    {
      key:      "volume_search_accuracy",
      label:    "Volume Searches Accuracy",
      icon:     BarChart2,
      color:    "text-blue-400",
      accent:   "bg-blue-500/10 border-blue-500/20",
      metric:   perf!.volumeAccuracy,
      isManual: false,
      detail:   `${perf!.volumeAccuracy.actual ?? 0} actual vs ${perf!.volumeAccuracy.targetCount ?? 0} monthly target`,
      description: "Actual AEO searches delivered vs. target volume based on active keywords × 30 days.",
    },
  ] : [];

  const editMetricDef = PERF_METRICS.find((m) => m.key === editKey);

  if ((isLoading && !data) || (perfLoading && !perf)) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-5 gap-4">
          {[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-36" />)}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { plans, type1, type2, totalsPerDay, totalsPerMonth, discrepancyReports, userDashboard, liveStats } = data!;

  return (
    <div className="space-y-8">

      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Session Metrics</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          AEO device farm performance + prompt search volume breakdown
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 1 — Device Farm Performance (5 core metrics)
      ══════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Device Farm Performance</h2>
          <div className="flex-1 h-px bg-border/30" />
          <span className="text-[10px] text-muted-foreground/40">Live computed · hover to edit targets</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {perfLoading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)
            : PERF_METRICS.map((m) => {
                const Icon      = m.icon;
                const val       = m.metric.value;
                const tgt       = parseFloat(m.metric.target);
                const valColor  = val === null ? "text-muted-foreground/40"
                  : val >= tgt ? "text-emerald-400"
                  : val >= tgt * 0.8 ? "text-amber-400"
                  : "text-destructive";

                return (
                  <Card key={m.key}
                    className="border-border/50 bg-card/60 hover:bg-card/80 transition-colors group relative overflow-hidden">
                    {/* Edit button */}
                    <button
                      onClick={() => setEditKey(m.key)}
                      className="absolute top-2 right-2 w-6 h-6 rounded-md bg-muted/40 hover:bg-primary/20 hover:text-primary text-muted-foreground/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                      title="Edit target">
                      <Pencil className="w-3 h-3" />
                    </button>

                    <CardContent className="p-4">
                      {/* Icon + label */}
                      <div className="flex items-start gap-2 mb-3">
                        <div className={`w-8 h-8 rounded-lg ${m.accent} border flex items-center justify-center flex-shrink-0`}>
                          <Icon className={`w-3.5 h-3.5 ${m.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-muted-foreground/70 leading-tight">
                            {m.label}
                          </p>
                          {m.isManual && (
                            <Badge variant="outline" className="text-[9px] mt-0.5 border-muted-foreground/20 text-muted-foreground/50 h-4">
                              Manual
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Value */}
                      <div className="flex items-baseline gap-1">
                        <span className={`text-3xl font-bold font-mono leading-none ${valColor}`}>
                          {val !== null ? val : "—"}
                        </span>
                        {val !== null && <span className="text-sm text-muted-foreground">%</span>}
                      </div>

                      {/* Progress bar */}
                      <PctBar value={val} target={m.metric.target} />

                      {/* Target */}
                      <div className="flex items-center gap-1 mt-2">
                        <Target className="w-2.5 h-2.5 text-muted-foreground/40" />
                        <span className="text-[10px] text-muted-foreground/50">Target: {m.metric.target}%</span>
                      </div>

                      {/* Detail text */}
                      <p className="text-[10px] text-muted-foreground/40 mt-1.5 leading-relaxed">
                        {m.detail}
                      </p>
                    </CardContent>
                  </Card>
                );
              })
          }
        </div>

        {/* Info note */}
        <div className="flex items-start gap-2 rounded-lg border border-border/30 bg-muted/10 px-3 py-2.5">
          <Info className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
            Device Rotation, IP Rotation, Prompt Accuracy, and Volume Accuracy are computed live from session records.
            Cache Clearing is manually set. Hover any card and click the pencil to edit targets.
          </p>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 2 — Live stats strip
      ══════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400">Live Campaign Stats</h2>
          <div className="flex-1 h-px bg-border/30" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Sessions Run",       value: liveStats.totalSessionsRun,               icon: Search,     color: "text-primary"    },
            { label: "Followup Rate",       value: `${liveStats.followupRate.toFixed(0)}%`,   icon: TrendingUp, color: "text-emerald-400" },
            { label: "Active Clients",      value: liveStats.activeClients,                  icon: Users,      color: "text-amber-400"  },
            { label: "AEO Keywords",        value: liveStats.aeoKeywordsActive,              icon: FileSearch, color: "text-violet-400" },
            { label: "Searches/Device/Day", value: liveStats.searchesPerDayPerDevice,        icon: Smartphone, color: "text-blue-400"  },
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
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 3 — Plan Volume Targets
      ══════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-400">Plan Volume Targets</h2>
          <div className="flex-1 h-px bg-border/30" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          {plans.map((plan) => (
            <div key={plan.name} className="rounded-xl border border-border/50 bg-card/60 p-4 text-center">
              <Badge variant="outline" className="mb-2 text-primary border-primary/40">{plan.name}</Badge>
              <p className="text-2xl font-bold text-foreground">{plan.totalPerMonth.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">searches / month</p>
              <p className="text-sm font-semibold text-primary mt-1">{plan.totalPerDay}/day</p>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 4 — AEO Prompt Search Breakdown Table
      ══════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">AEO Prompt Search Breakdown</h2>
          <div className="flex-1 h-px bg-border/30" />
        </div>

        <Card className="border-border/50 overflow-hidden">
          <CardHeader className="pb-2">
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
                    <th colSpan={3} className="px-4 py-3 text-center font-semibold text-muted-foreground border-l border-border/30">Current Process</th>
                    <th colSpan={3} className="px-4 py-3 text-center font-semibold text-primary border-l border-primary/20 bg-primary/5">Future Process</th>
                  </tr>
                  <tr className="border-b border-border/50 bg-muted/10">
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground/70"></th>
                    {plans.map((p) => <th key={`cur-${p.name}`} className="px-4 py-2 text-center text-xs text-muted-foreground font-mono">{p.name}</th>)}
                    {plans.map((p) => <th key={`fut-${p.name}`} className="px-4 py-2 text-center text-xs text-primary font-mono">{p.name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {/* Type 1 */}
                  <tr className="bg-muted/5">
                    <td className="px-4 py-3 text-left" colSpan={7}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground uppercase tracking-wider">{type1.label}</span>
                        <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">{type1.percentage}% budget</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{type1.description}</p>
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 pl-8 text-xs text-muted-foreground">% of Searches</td>
                    <CellVal dash /><CellVal dash /><CellVal dash />
                    <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono font-semibold">100%</td>
                    <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono font-semibold">100%</td>
                    <td className="px-4 py-2.5 text-center text-primary/80 text-sm font-mono font-semibold">100%</td>
                  </tr>
                  <tr className="bg-muted/20 font-semibold">
                    <td className="px-4 py-2 pl-8 text-xs text-muted-foreground uppercase tracking-wide">SUBTOTAL</td>
                    {type1.subtotals.current.map((v, i) => <CellVal key={i} value={v} />)}
                    {type1.subtotals.future.map((v, i)  => <CellVal key={i} value={v} highlight />)}
                  </tr>
                  {/* Type 2 */}
                  <tr className="bg-amber-500/5">
                    <td className="px-4 py-3 text-left" colSpan={7}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground uppercase tracking-wider">{type2.label}</span>
                        <Badge variant="outline" className="text-amber-400 border-amber-400/40 text-[10px]">{type2.percentage}% budget</Badge>
                      </div>
                      <p className="text-xs text-amber-400/80 mt-0.5 flex items-center gap-1">
                        <Link2 className="w-3 h-3 flex-shrink-0" />{type2.backlinkNote}
                      </p>
                    </td>
                  </tr>
                  <tr className="bg-muted/20 font-semibold">
                    <td className="px-4 py-2 pl-8 text-xs text-muted-foreground uppercase tracking-wide">SUBTOTAL</td>
                    {type2.subtotals.current.map((v, i) => <CellVal key={i} value={v} />)}
                    {type2.subtotals.future.map((v, i)  => <CellVal key={i} value={v} highlight />)}
                  </tr>
                  {/* Totals */}
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td className="px-4 py-3 font-bold text-foreground text-xs uppercase tracking-wider">TOTAL PER DAY</td>
                    {totalsPerDay.current.map((v, i) => <td key={i} className="px-4 py-3 text-center text-sm font-bold font-mono text-foreground">{v}</td>)}
                    {totalsPerDay.future.map((v, i)  => <td key={i} className="px-4 py-3 text-center text-sm font-bold font-mono text-primary">{v}</td>)}
                  </tr>
                  <tr className="bg-primary/10 border-t border-primary/20">
                    <td className="px-4 py-3 font-bold text-primary text-xs uppercase tracking-wider">TOTAL PER MONTH</td>
                    {totalsPerMonth.current.map((v, i) => <td key={i} className="px-4 py-3 text-center text-base font-bold font-mono text-foreground">{v.toLocaleString()}</td>)}
                    {totalsPerMonth.future.map((v, i)  => <td key={i} className="px-4 py-3 text-center text-base font-bold font-mono text-primary">{v.toLocaleString()}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 5 — Discrepancy Reports + User Dashboard
      ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Discrepancy Reports */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> Discrepancy Reports
            </CardTitle>
            <CardDescription>Quality control checks run per client per AEO search cycle</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {discrepancyReports.map((report) => (
              <div key={report.id}
                className="flex items-start gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2.5">
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
                <p className="text-xs text-muted-foreground mt-0.5">GBP map rank tracking via Local Falcon — automated weekly pulls</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* User Dashboard */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> {userDashboard.label}
            </CardTitle>
            <CardDescription>{userDashboard.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {userDashboard.sections.map((section, i) => (
              <div key={i}
                className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">{i + 1}</div>
                  <span className="text-sm font-medium text-foreground">{section.label}</span>
                </div>
                {section.perWord && <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/50">per keyword</Badge>}
              </div>
            ))}
            <div className="mt-4 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-xs font-semibold text-emerald-400 mb-2">Current Capacity</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {plans.map((plan) => (
                  <div key={plan.name}>
                    <p className="text-xs text-muted-foreground">{plan.name}</p>
                    <p className="text-base font-bold text-emerald-400">
                      {plan.totalPerDay}<span className="text-xs font-normal text-muted-foreground">/day</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Edit metric target dialog ── */}
      {editKey && editMetricDef && (
        <EditMetricDialog
          open
          onOpenChange={(o) => { if (!o) setEditKey(null); }}
          metricKey={editKey}
          label={editMetricDef.label}
          metric={editMetricDef.metric}
          isManual={editMetricDef.isManual}
          saving={saving}
          onSave={(target, value) => saveTarget(editKey, target, value)}
        />
      )}
    </div>
  );
}
