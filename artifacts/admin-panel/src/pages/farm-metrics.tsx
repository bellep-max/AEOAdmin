import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Cpu, Wifi, RefreshCcw, ShieldCheck, BarChart2, Activity,
  Pencil, Target, TrendingUp, Server, Zap, Smartphone, Network,
  Clock, Battery, AlertTriangle, CheckCircle2, Globe, Users,
  ChevronDown, ChevronUp, Search,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── FarmMetric type ────────────────────────────────────── */
interface FarmMetric {
  id:          number;
  key:         string;
  label:       string;
  description: string | null;
  category:    string;
  value:       string | null;
  unit:        string | null;
  targetValue: string | null;
  isComputed:  boolean;
  updatedAt:   string | null;
}

/* ─── Business metrics types ─────────────────────────────── */
interface MetricCell {
  value:          number | null;
  target:         number;
  isManual?:      boolean;
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

/* ─── Category config ────────────────────────────────────── */
const CATEGORY_CONFIG: Record<string, {
  label: string; icon: React.ElementType; color: string; accent: string;
}> = {
  performance:   { label: "Performance",     icon: ShieldCheck, color: "text-primary",     accent: "bg-primary/10 border-primary/20"         },
  device_health: { label: "Device Health",   icon: Cpu,         color: "text-emerald-400", accent: "bg-emerald-500/10 border-emerald-500/20"  },
  proxy_network: { label: "Proxy / Network", icon: Network,     color: "text-violet-400",  accent: "bg-violet-500/10 border-violet-500/20"    },
  campaign:      { label: "AEO Campaign",    icon: BarChart2,   color: "text-amber-400",   accent: "bg-amber-500/10 border-amber-500/20"      },
  capacity:      { label: "Capacity",        icon: Server,      color: "text-blue-400",    accent: "bg-blue-500/10 border-blue-500/20"        },
};

const KEY_ICONS: Record<string, React.ElementType> = {
  device_rotation: Cpu, ip_rotation: Wifi, cache_clearing: RefreshCcw,
  prompt_exec_accuracy: ShieldCheck, volume_search_accuracy: BarChart2,
  device_uptime: Activity, avg_battery_level: Battery, device_error_rate: AlertTriangle,
  reboot_frequency: RefreshCcw, proxy_success_rate: CheckCircle2, avg_session_latency: Clock,
  proxy_rotation_interval: Network, daily_target_achievement: Target, keyword_coverage: Globe,
  platform_gemini: Smartphone, platform_chatgpt: Smartphone, platform_perplexity: Smartphone,
  active_devices_target: Server, sessions_per_day: Zap, searches_per_device_day: TrendingUp,
  client_capacity: Users,
};

/* ─── Metric column config for per-business table ─────────── */
const METRIC_COLS = [
  { key: "deviceRotation" as const, label: "Device Rotation",  icon: Cpu,         color: "text-primary",     bg: "bg-primary/10",     fmKey: "device_rotation"        },
  { key: "ipRotation"     as const, label: "IP Rotation",       icon: Wifi,        color: "text-violet-400",  bg: "bg-violet-500/10",  fmKey: "ip_rotation"            },
  { key: "cacheClearing"  as const, label: "Cache Clearing",    icon: RefreshCcw,  color: "text-emerald-400", bg: "bg-emerald-500/10", fmKey: "cache_clearing"         },
  { key: "promptAccuracy" as const, label: "Prompt Accuracy",   icon: ShieldCheck, color: "text-amber-400",   bg: "bg-amber-500/10",   fmKey: "prompt_exec_accuracy"   },
  { key: "volumeAccuracy" as const, label: "Volume Accuracy",   icon: BarChart2,   color: "text-blue-400",    bg: "bg-blue-500/10",    fmKey: "volume_search_accuracy" },
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
  const pct = Math.min(100, (val / tgt) * 100);
  const vc  = val >= tgt ? "text-emerald-400" : val >= tgt * 0.8 ? "text-amber-400" : "text-destructive";
  const bc  = val >= tgt ? "bg-emerald-500"   : val >= tgt * 0.8 ? "bg-amber-500"   : "bg-destructive";

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

/* ─── Status helpers ─────────────────────────────────────── */
function statusColor(value: string | null, target: string | null, unit: string | null): string {
  if (!value || !target) return "text-muted-foreground";
  const v = parseFloat(value), t = parseFloat(target);
  if (isNaN(v) || isNaN(t)) return "text-foreground";
  if (unit === "%") {
    if (v >= t) return "text-emerald-400";
    if (v >= t * 0.85) return "text-amber-400";
    return "text-destructive";
  }
  const r = v / t;
  if (r >= 0.9) return "text-emerald-400";
  if (r >= 0.7) return "text-amber-400";
  return "text-destructive";
}

function pctBar(value: string | null, target: string | null): React.ReactNode {
  if (!value || !target) return null;
  const v = Math.min(100, Math.max(0, parseFloat(value)));
  const t = Math.min(100, Math.max(0, parseFloat(target)));
  if (isNaN(v) || isNaN(t)) return null;
  const ratio = v / (t || 1);
  const bar   = ratio >= 1 ? "bg-emerald-500" : ratio >= 0.85 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="mt-2 space-y-0.5">
      <div className="w-full h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${Math.min(100, (v / t) * 100)}%` }} />
      </div>
      <div className="flex justify-between">
        <span className="text-[9px] text-muted-foreground/50">0</span>
        <span className="text-[9px] text-muted-foreground/50">Target: {target}</span>
      </div>
    </div>
  );
}

/* ─── Edit Dialog ────────────────────────────────────────── */
function EditMetricDialog({ metric, open, onOpenChange, onSave, saving }: {
  metric: FarmMetric; open: boolean; onOpenChange: (v: boolean) => void;
  onSave: (value: string, target: string) => void; saving: boolean;
}) {
  const [val, setVal] = useState(metric.value ?? "");
  const [tgt, setTgt] = useState(metric.targetValue ?? "");
  const Icon = KEY_ICONS[metric.key] ?? BarChart2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] border-border/60 bg-card">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <DialogTitle className="text-base">{metric.label}</DialogTitle>
          </div>
          <DialogDescription className="text-xs leading-relaxed">{metric.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">
              Current Value {metric.unit && <span className="text-muted-foreground/40 normal-case font-normal">({metric.unit})</span>}
            </Label>
            <Input className="bg-muted/30 border-border/60 h-10 text-lg font-bold font-mono" value={val} onChange={(e) => setVal(e.target.value)} placeholder={`e.g. ${metric.targetValue ?? "0"}`} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">
              Target Value {metric.unit && <span className="text-muted-foreground/40 normal-case font-normal">({metric.unit})</span>}
            </Label>
            <Input className="bg-muted/30 border-border/60 h-10 font-mono" value={tgt} onChange={(e) => setTgt(e.target.value)} placeholder="Target…" />
          </div>
          {metric.updatedAt && (
            <p className="text-[10px] text-muted-foreground/40">Last updated: {format(new Date(metric.updatedAt), "MMM d, yyyy HH:mm")}</p>
          )}
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 border-border/50" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="flex-1" disabled={saving || !val.trim()} onClick={() => onSave(val.trim(), tgt.trim())}
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}>
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Fleet avg helper ───────────────────────────────────── */
function avg(vals: (number | null)[]) {
  const v = vals.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

/* ═══════════════════════════════════════════════════════════ */
export default function FarmMetrics() {
  const [editMetric, setEditMetric] = useState<FarmMetric | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set());
  const [bmSearch,   setBmSearch]   = useState("");
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const { data: metrics, isLoading } = useQuery<FarmMetric[]>({
    queryKey: ["farm-metrics"],
    queryFn:  () => fetch(`${BASE}/api/farm-metrics`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data: bizData, isLoading: bizLoading } = useQuery<BusinessData>({
    queryKey: ["business-metrics"],
    queryFn:  () => fetch(`${BASE}/api/metrics/business`, { credentials: "include" }).then((r) => r.json()),
  });

  async function saveMetric(key: string, value: string, targetValue: string) {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/farm-metrics/${key}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, targetValue }),
      });
      if (!r.ok) throw new Error("Failed to save");
      await queryClient.invalidateQueries({ queryKey: ["farm-metrics"] });
      toast({ title: "Metric updated" });
      setEditMetric(null);
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  /* Group farm metrics by category */
  const grouped = new Map<string, FarmMetric[]>();
  for (const m of metrics ?? []) {
    if (!grouped.has(m.category)) grouped.set(m.category, []);
    grouped.get(m.category)!.push(m);
  }

  const bizList  = bizData?.metrics ?? [];
  const filtered = bizList.filter((m) => (m.client.name ?? "").toLowerCase().includes(bmSearch.toLowerCase()));

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Device Farm Metrics</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Per-business AEO performance · device health · proxy · campaign · capacity
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECTION 1 — Per-Business Performance Matrix
      ══════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Performance — Per Business</h2>
          <div className="flex-1 h-px bg-border/30 min-w-[20px]" />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
            <Input
              className="pl-7 h-7 w-40 text-xs bg-muted/30 border-border/50"
              placeholder="Filter businesses…"
              value={bmSearch}
              onChange={(e) => setBmSearch(e.target.value)}
            />
          </div>
          <span className="text-[10px] text-muted-foreground/40 whitespace-nowrap hidden sm:block">Click row to expand devices</span>
        </div>

        <div className="rounded-xl border border-border/50 overflow-hidden bg-card/60">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[780px]">
              <thead className="bg-muted/20 border-b border-border/50">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground/50 w-64">Business</th>
                  <th className="px-3 py-3 text-center text-[10px] uppercase tracking-wider text-muted-foreground/50 border-l border-border/30 w-16">Sessions</th>
                  {METRIC_COLS.map((col) => (
                    <th key={col.key} className="px-3 py-3 border-l border-border/30 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <div className={`w-6 h-6 rounded-md ${col.bg} flex items-center justify-center`}>
                          <col.icon className={`w-3.5 h-3.5 ${col.color}`} />
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 whitespace-nowrap">{col.label}</span>
                        <span className="text-[9px] text-muted-foreground/30">tgt {bizData?.targets?.[col.fmKey] ?? "—"}%</span>
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
                          {bmSearch ? "No businesses match." : "No business data yet."}
                        </td>
                      </tr>
                    )
                    : filtered.map((bm) => {
                        const isExp = expanded.has(bm.client.id);
                        return (
                          <React.Fragment key={`fm-bm-${bm.client.id}`}>
                            <tr
                              className="hover:bg-muted/20 transition-colors cursor-pointer group/row"
                              onClick={() => toggleExpand(bm.client.id)}>
                              <td className="px-4 py-2 align-middle">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground/30 group-hover/row:text-muted-foreground/60 transition-colors">
                                    {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </span>
                                  <div className="min-w-0">
                                    <Link href={`/clients/${bm.client.id}`} onClick={(e) => e.stopPropagation()}
                                      className="text-sm font-semibold text-foreground hover:text-primary truncate block transition-colors">
                                      {bm.client.name ?? "—"}
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
                              <td className="px-3 py-2 text-center border-l border-border/30 align-middle">
                                <span className="text-sm font-mono font-semibold text-foreground">{bm.sessionTotal}</span>
                              </td>
                              <MCell cell={bm.deviceRotation} colKey="deviceRotation" />
                              <MCell cell={bm.ipRotation}     colKey="ipRotation"     />
                              <MCell cell={bm.cacheClearing}  colKey="cacheClearing"  />
                              <MCell cell={bm.promptAccuracy} colKey="promptAccuracy" />
                              <MCell cell={bm.volumeAccuracy} colKey="volumeAccuracy" />
                            </tr>

                            {isExp && (
                              <tr key={`fm-bm-${bm.client.id}-exp`} className="bg-muted/10">
                                <td colSpan={7} className="px-6 py-3.5">
                                  <div className="flex gap-8 flex-wrap">
                                    <div>
                                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-2 flex items-center gap-1">
                                        <Cpu className="w-3 h-3" /> Devices Used
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
                                    <div>
                                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-2">Volume Detail</p>
                                      <div className="flex gap-5 text-xs">
                                        <div><span className="text-muted-foreground/50 block">Keywords</span><span className="font-semibold text-foreground">{bm.activeKeywords}</span></div>
                                        <div><span className="text-muted-foreground/50 block">Monthly Target</span><span className="font-semibold text-primary">{bm.monthlyTarget.toLocaleString()}</span></div>
                                        <div><span className="text-muted-foreground/50 block">Actual</span><span className="font-semibold text-foreground">{bm.sessionTotal}</span></div>
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
                          </React.Fragment>
                        );
                      })
                }
              </tbody>

              {/* Fleet averages footer */}
              {!bizLoading && filtered.length > 0 && (
                <tfoot className="border-t-2 border-border bg-muted/20">
                  <tr>
                    <td className="px-4 py-2.5 font-bold text-xs uppercase tracking-wider text-muted-foreground/60">Fleet Avg ({filtered.length})</td>
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
          SECTION 2 — All 20 Farm Metric Cards by Category
      ══════════════════════════════════════════════════════ */}
      {isLoading ? (
        <div className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-32 rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {Array.from(grouped.entries()).map(([category, items]) => {
            const cfg     = CATEGORY_CONFIG[category] ?? { label: category, icon: BarChart2, color: "text-foreground", accent: "bg-muted/20 border-border/30" };
            const CatIcon = cfg.icon;
            return (
              <div key={category} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-lg ${cfg.accent} flex items-center justify-center border`}>
                    <CatIcon className={`w-3.5 h-3.5 ${cfg.color}`} />
                  </div>
                  <h2 className={`text-sm font-bold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</h2>
                  <div className="flex-1 h-px bg-border/30" />
                  <span className="text-[10px] text-muted-foreground/40">{items.length} metrics</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {items.map((metric) => {
                    const Icon      = KEY_ICONS[metric.key] ?? BarChart2;
                    const valColor  = statusColor(metric.value, metric.targetValue, metric.unit);
                    const showBar   = metric.unit === "%" && metric.value !== null && metric.targetValue !== null;

                    return (
                      <Card key={metric.key} className="border-border/50 bg-card/60 hover:bg-card/80 transition-colors group relative overflow-hidden">
                        <button onClick={() => setEditMetric(metric)}
                          className="absolute top-2 right-2 w-6 h-6 rounded-md bg-muted/40 hover:bg-primary/20 hover:text-primary text-muted-foreground/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-2 mb-2">
                            <div className={`w-7 h-7 rounded-lg border ${cfg.accent} flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                            </div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 leading-tight pt-0.5">{metric.label}</p>
                          </div>
                          <div className="flex items-end gap-1 mt-1">
                            <p className={`text-2xl font-bold font-mono leading-none ${valColor}`}>{metric.value ?? "—"}</p>
                            {metric.unit && metric.value !== null && <span className="text-xs text-muted-foreground mb-0.5">{metric.unit}</span>}
                          </div>
                          {metric.targetValue !== null && (
                            <div className="flex items-center gap-1 mt-1.5">
                              <Target className="w-2.5 h-2.5 text-muted-foreground/40" />
                              <span className="text-[10px] text-muted-foreground/50">Target: {metric.targetValue}{metric.unit}</span>
                            </div>
                          )}
                          {showBar && pctBar(metric.value, metric.targetValue)}
                          {metric.description && (
                            <p className="text-[10px] text-muted-foreground/40 mt-2 leading-relaxed line-clamp-2">{metric.description}</p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer hint ── */}
      {metrics && metrics.length > 0 && (
        <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-3 flex items-center gap-3">
          <Pencil className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
          <p className="text-xs text-muted-foreground/50">
            Hover any metric card and click the edit icon to update its value and target. All changes are saved immediately.
          </p>
        </div>
      )}

      {/* ── Edit Dialog ── */}
      {editMetric && (
        <EditMetricDialog
          metric={editMetric} open
          onOpenChange={(o) => { if (!o) setEditMetric(null); }}
          saving={saving}
          onSave={(value, target) => saveMetric(editMetric.key, value, target)}
        />
      )}
    </div>
  );
}
