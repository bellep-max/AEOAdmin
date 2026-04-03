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
  BarChart2, Pencil, Target, ChevronDown, ChevronUp,
} from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Types ─────────────────────────────────────────────── */
interface MetricCell {
  value:         number | null;
  target:        number;
  isManual?:     boolean;
  uniqueDevices?: number;
  withDevice?:    number;
  uniqueProxies?: number;
  withProxy?:     number;
  withPrompt?:    number;
  total?:         number;
  actual?:        number;
  monthlyTarget?: number;
}
interface BusinessMetric {
  client:         { id: number; name: string; status: string; plan: string | null };
  sessionTotal:   number;
  devices:        { deviceId: number; identifier: string; model: string }[];
  activeKeywords: number;
  monthlyTarget:  number;
  deviceRotation: MetricCell;
  ipRotation:     MetricCell;
  cacheClearing:  MetricCell;
  promptAccuracy: MetricCell;
  volumeAccuracy: MetricCell;
}
interface BusinessData {
  metrics: BusinessMetric[];
  targets: Record<string, number>;
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

/* ─── Metric column config ───────────────────────────────── */
const METRIC_COLS = [
  { key: "deviceRotation" as const, label: "Device Rotation",   icon: Cpu,        color: "text-primary",     bg: "bg-primary/10",     fmKey: "device_rotation"        },
  { key: "ipRotation"     as const, label: "IP Rotation",        icon: Wifi,       color: "text-violet-400",  bg: "bg-violet-500/10",  fmKey: "ip_rotation"            },
  { key: "cacheClearing"  as const, label: "Cache Clearing",     icon: RefreshCcw, color: "text-emerald-400", bg: "bg-emerald-500/10", fmKey: "cache_clearing"         },
  { key: "promptAccuracy" as const, label: "Prompt Accuracy",    icon: ShieldCheck,color: "text-amber-400",   bg: "bg-amber-500/10",   fmKey: "prompt_exec_accuracy"   },
  { key: "volumeAccuracy" as const, label: "Volume Accuracy",    icon: BarChart2,  color: "text-blue-400",    bg: "bg-blue-500/10",    fmKey: "volume_search_accuracy" },
];

/* ─── Inline metric cell ─────────────────────────────────── */
function MCell({ cell, colKey }: { cell: MetricCell; colKey: string }) {
  const val = cell.value;
  const tgt = cell.target;
  if (val === null) {
    return (
      <td className="px-2 py-0 border-l border-border/30 align-middle text-center">
        <span className="text-[10px] text-muted-foreground/30 italic">{cell.isManual ? "Manual" : "—"}</span>
      </td>
    );
  }
  const pct    = Math.min(100, (val / tgt) * 100);
  const vc     = val >= tgt ? "text-emerald-400" : val >= tgt * 0.8 ? "text-amber-400" : "text-destructive";
  const bc     = val >= tgt ? "bg-emerald-500"   : val >= tgt * 0.8 ? "bg-amber-500"   : "bg-destructive";

  let sub = "";
  if (colKey === "deviceRotation")  sub = `${cell.uniqueDevices ?? 0}d/${cell.withDevice ?? 0}s`;
  if (colKey === "ipRotation")      sub = `${cell.uniqueProxies ?? 0}p/${cell.withProxy ?? 0}s`;
  if (colKey === "promptAccuracy")  sub = `${cell.withPrompt ?? 0}/${cell.total ?? 0}`;
  if (colKey === "volumeAccuracy")  sub = `${cell.actual ?? 0}/${cell.monthlyTarget ?? 0}`;
  if (colKey === "cacheClearing")   sub = "global";

  return (
    <td className="px-3 py-0 border-l border-border/30 align-middle">
      <div className="flex flex-col items-center justify-center py-2.5 gap-1">
        <span className={`text-lg font-bold font-mono leading-none ${vc}`}>
          {val}<span className="text-[10px] font-normal text-muted-foreground">%</span>
        </span>
        <div className="w-12 h-1 rounded-full bg-muted/30 overflow-hidden">
          <div className={`h-full rounded-full ${bc} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[9px] text-muted-foreground/40 whitespace-nowrap">{sub}</span>
      </div>
    </td>
  );
}

/* ─── Edit targets dialog ────────────────────────────────── */
function EditTargetsDialog({
  open, onOpenChange, col, currentTarget, currentValue, isManual, saving, onSave,
}: {
  open:          boolean;
  onOpenChange:  (v: boolean) => void;
  col:           typeof METRIC_COLS[number];
  currentTarget: number;
  currentValue:  number | null;
  isManual:      boolean;
  saving:        boolean;
  onSave:        (target: string, value?: string) => void;
}) {
  const [target, setTarget] = useState(String(currentTarget));
  const [manVal, setManVal] = useState(currentValue !== null ? String(currentValue) : "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px] border-border/60 bg-card">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className={`w-9 h-9 rounded-xl ${col.bg} flex items-center justify-center`}>
              <col.icon className={`w-4 h-4 ${col.color}`} />
            </div>
            <DialogTitle className="text-base">{col.label}</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            {isManual ? "Manually set the global value and target for all businesses." : "Set the global target threshold applied to all businesses."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {isManual && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground/60">Global Value (%)</Label>
              <Input className="bg-muted/30 border-border/60 h-10 text-lg font-bold font-mono" type="number" min={0} max={100} value={manVal} onChange={(e) => setManVal(e.target.value)} placeholder="e.g. 100" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground/60">Target (%)</Label>
            <Input className="bg-muted/30 border-border/60 h-10 font-mono" type="number" min={0} max={100} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 95" />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 border-border/50" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="flex-1" onClick={() => onSave(target, isManual ? manVal : undefined)} disabled={saving || !target}
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
export default function Metrics() {
  const [editCol,    setEditCol]   = useState<typeof METRIC_COLS[number] | null>(null);
  const [saving,     setSaving]    = useState(false);
  const [expanded,   setExpanded]  = useState<Set<number>>(new Set());
  const [bmSearch,   setBmSearch]  = useState("");
  const { toast }    = useToast();
  const queryClient  = useQueryClient();

  /* ─── Data fetching ─── */
  const { data: bizData, isLoading: bizLoading } = useQuery<BusinessData>({
    queryKey: ["business-metrics"],
    queryFn:  () => fetch(`${BASE}/api/metrics/business`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data, isLoading } = useQuery<MetricsData>({
    queryKey: ["metrics-session-breakdown"],
    queryFn:  () => fetch(`${BASE}/api/metrics/session-breakdown`, { credentials: "include" }).then((r) => r.json()),
  });

  function toggleExpand(id: number) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function saveTarget(fmKey: string, target: string, value?: string) {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/metrics/performance/${fmKey}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, ...(value !== undefined ? { value } : {}) }),
      });
      await queryClient.invalidateQueries({ queryKey: ["business-metrics"] });
      toast({ title: "Target updated" });
      setEditCol(null);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ─── Fleet averages ─── */
  function avg(vals: (number | null)[]) {
    const valid = vals.filter((v): v is number => v !== null);
    return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  }

  const bizList = bizData?.metrics ?? [];
  const filtered = bizList.filter((m) => (m.client.name ?? "").toLowerCase().includes(bmSearch.toLowerCase()));

  if ((isLoading && !data)) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
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
          Per-business AEO device farm performance · prompt search volume breakdown
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 1 — Device Farm Performance per Business
      ══════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Device Farm Performance — Per Business</h2>
          <div className="flex-1 h-px bg-border/30 min-w-[20px]" />
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
              <Input
                className="pl-7 h-7 w-40 text-xs bg-muted/30 border-border/50"
                placeholder="Filter businesses…"
                value={bmSearch}
                onChange={(e) => setBmSearch(e.target.value)}
              />
            </div>
            <span className="text-[10px] text-muted-foreground/40 whitespace-nowrap">Hover column header to edit targets</span>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 overflow-hidden bg-card/60">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[780px]">
              <thead className="bg-muted/20 border-b border-border/50">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground/50 w-64">
                    Business
                  </th>
                  <th className="px-3 py-3 text-center text-[10px] uppercase tracking-wider text-muted-foreground/50 border-l border-border/30 w-16">
                    Sessions
                  </th>
                  {METRIC_COLS.map((col) => (
                    <th
                      key={col.key}
                      className="px-3 py-3 border-l border-border/30 text-center group/th cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setEditCol(col)}>
                      <div className="flex flex-col items-center gap-1">
                        <div className={`w-6 h-6 rounded-md ${col.bg} flex items-center justify-center group-hover/th:ring-1 ring-primary/30 transition-all`}>
                          <col.icon className={`w-3.5 h-3.5 ${col.color}`} />
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 whitespace-nowrap leading-tight">{col.label}</span>
                        <span className="text-[9px] text-muted-foreground/30 leading-none">
                          tgt {bizData?.targets?.[col.fmKey] ?? "—"}%
                        </span>
                        <Pencil className="w-2.5 h-2.5 text-muted-foreground/20 group-hover/th:text-primary/50 transition-colors" />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {bizLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3"><Skeleton className="h-6 w-36" /></td>
                        <td className="px-3 py-3 border-l border-border/30"><Skeleton className="h-5 w-8 mx-auto" /></td>
                        {METRIC_COLS.map((c) => <td key={c.key} className="px-3 py-3 border-l border-border/30"><Skeleton className="h-10 w-14 mx-auto" /></td>)}
                      </tr>
                    ))
                  : filtered.length === 0
                    ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground/40 text-sm">
                          {bmSearch ? "No businesses match your search." : "No business data available yet."}
                        </td>
                      </tr>
                    )
                    : filtered.map((bm) => {
                        const isExp = expanded.has(bm.client.id);
                        return (
                          <>
                            <tr
                              key={`bm-${bm.client.id}`}
                              className="hover:bg-muted/20 transition-colors cursor-pointer group/row"
                              onClick={() => toggleExpand(bm.client.id)}>
                              {/* Business */}
                              <td className="px-4 py-2 align-middle">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground/30 group-hover/row:text-muted-foreground/60 transition-colors">
                                    {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </span>
                                  <div className="min-w-0">
                                    <Link
                                      href={`/clients/${bm.client.id}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-sm font-semibold text-foreground hover:text-primary truncate block transition-colors">
                                      {bm.client.name}
                                    </Link>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <span className={`w-1.5 h-1.5 rounded-full ${bm.client.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                                      <span className="text-[10px] text-muted-foreground/50 capitalize">{bm.client.status}</span>
                                      {bm.client.plan && <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground/50 border-border/40">{bm.client.plan}</Badge>}
                                      <span className="text-[10px] text-muted-foreground/40">{bm.activeKeywords} kws</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              {/* Sessions */}
                              <td className="px-3 py-2 text-center border-l border-border/30 align-middle">
                                <span className="text-sm font-mono font-semibold text-foreground">{bm.sessionTotal}</span>
                              </td>
                              {/* 5 metric cells */}
                              <MCell cell={bm.deviceRotation} colKey="deviceRotation" />
                              <MCell cell={bm.ipRotation}     colKey="ipRotation"     />
                              <MCell cell={bm.cacheClearing}  colKey="cacheClearing"  />
                              <MCell cell={bm.promptAccuracy} colKey="promptAccuracy" />
                              <MCell cell={bm.volumeAccuracy} colKey="volumeAccuracy" />
                            </tr>

                            {/* Expanded device detail */}
                            {isExp && (
                              <tr key={`bm-${bm.client.id}-exp`} className="bg-muted/10">
                                <td colSpan={7} className="px-6 py-3.5">
                                  <div className="flex gap-8 flex-wrap">
                                    {/* Devices */}
                                    <div>
                                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-2 flex items-center gap-1">
                                        <Smartphone className="w-3 h-3" /> Devices Used
                                      </p>
                                      {bm.devices.length === 0
                                        ? <span className="text-xs text-muted-foreground/30 italic">No device records yet</span>
                                        : (
                                          <div className="flex flex-wrap gap-1.5">
                                            {bm.devices.map((d) => (
                                              <div key={d.deviceId} className="flex items-center gap-1.5 rounded-md border border-border/40 bg-card/60 px-2 py-1">
                                                <Cpu className="w-3 h-3 text-primary/50 flex-shrink-0" />
                                                <span className="text-[10px] font-mono font-semibold text-foreground">{d.identifier}</span>
                                                <span className="text-[9px] text-muted-foreground/50">{d.model}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )
                                      }
                                    </div>
                                    {/* Volume detail */}
                                    <div>
                                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-2">Volume Detail</p>
                                      <div className="flex gap-5 text-xs">
                                        <div>
                                          <span className="text-muted-foreground/50 block">Active Keywords</span>
                                          <span className="font-semibold text-foreground">{bm.activeKeywords}</span>
                                        </div>
                                        <div>
                                          <span className="text-muted-foreground/50 block">Monthly Target</span>
                                          <span className="font-semibold text-primary">{bm.monthlyTarget.toLocaleString()}</span>
                                        </div>
                                        <div>
                                          <span className="text-muted-foreground/50 block">Actual Sessions</span>
                                          <span className="font-semibold text-foreground">{bm.sessionTotal}</span>
                                        </div>
                                        <div>
                                          <span className="text-muted-foreground/50 block">Remaining</span>
                                          <span className={`font-semibold ${Math.max(0, bm.monthlyTarget - bm.sessionTotal) > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                                            {Math.max(0, bm.monthlyTarget - bm.sessionTotal).toLocaleString()}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })
                }
              </tbody>

              {/* Fleet averages footer */}
              {!bizLoading && filtered.length > 0 && (
                <tfoot className="border-t-2 border-border bg-muted/20">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-xs uppercase tracking-wider text-muted-foreground/60">
                      Fleet Avg ({filtered.length})
                    </td>
                    <td className="px-3 py-2.5 text-center border-l border-border/30 font-mono font-bold text-foreground text-sm">
                      {filtered.reduce((a, b) => a + b.sessionTotal, 0)}
                    </td>
                    {(["deviceRotation","ipRotation","cacheClearing","promptAccuracy","volumeAccuracy"] as const).map((k, i) => {
                      const tgtKey = METRIC_COLS[i].fmKey;
                      const tgt    = bizData?.targets?.[tgtKey] ?? 80;
                      const val    = avg(filtered.map((m) => m[k].value));
                      return (
                        <td key={k} className="px-3 py-2.5 text-center border-l border-border/30">
                          {val !== null
                            ? <span className={`text-sm font-bold font-mono ${val >= tgt ? "text-emerald-400" : val >= tgt * 0.8 ? "text-amber-400" : "text-destructive"}`}>{val}%</span>
                            : <span className="text-muted-foreground/30 text-xs">—</span>
                          }
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
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
            <CardDescription>Current process vs. future process per plan tier — Type 1 (Geo Specific) and Type 2 (Backlink)</CardDescription>
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
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> Discrepancy Reports
            </CardTitle>
            <CardDescription>Quality control checks run per client per AEO search cycle</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {discrepancyReports.map((report) => (
              <div key={report.id} className="flex items-start gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2.5">
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

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> {userDashboard.label}
            </CardTitle>
            <CardDescription>{userDashboard.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {userDashboard.sections.map((section, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2.5">
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
                    <p className="text-base font-bold text-emerald-400">{plan.totalPerDay}<span className="text-xs font-normal text-muted-foreground">/day</span></p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Edit column targets dialog ── */}
      {editCol && bizData && (
        <EditTargetsDialog
          open
          onOpenChange={(o) => { if (!o) setEditCol(null); }}
          col={editCol}
          currentTarget={bizData.targets[editCol.fmKey] ?? 80}
          currentValue={editCol.key === "cacheClearing" ? (bizList[0]?.cacheClearing.value ?? null) : null}
          isManual={editCol.key === "cacheClearing"}
          saving={saving}
          onSave={(target, value) => saveTarget(editCol.fmKey, target, value)}
        />
      )}
    </div>
  );
}
