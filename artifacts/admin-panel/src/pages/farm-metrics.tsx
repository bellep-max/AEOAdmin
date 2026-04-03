import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Types ─────────────────────────────────────────────── */
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

/* ─── Category config ────────────────────────────────────── */
const CATEGORY_CONFIG: Record<string, {
  label: string; icon: React.ElementType; color: string; accent: string;
}> = {
  performance:  { label: "Performance",         icon: ShieldCheck, color: "text-primary",     accent: "bg-primary/10 border-primary/20"    },
  device_health:{ label: "Device Health",       icon: Cpu,         color: "text-emerald-400", accent: "bg-emerald-500/10 border-emerald-500/20" },
  proxy_network:{ label: "Proxy / Network",     icon: Network,     color: "text-violet-400",  accent: "bg-violet-500/10 border-violet-500/20"  },
  campaign:     { label: "AEO Campaign",        icon: BarChart2,   color: "text-amber-400",   accent: "bg-amber-500/10 border-amber-500/20"    },
  capacity:     { label: "Capacity",            icon: Server,      color: "text-blue-400",    accent: "bg-blue-500/10 border-blue-500/20"      },
};

const KEY_ICONS: Record<string, React.ElementType> = {
  device_rotation:        Cpu,
  ip_rotation:            Wifi,
  cache_clearing:         RefreshCcw,
  prompt_exec_accuracy:   ShieldCheck,
  volume_search_accuracy: BarChart2,
  device_uptime:          Activity,
  avg_battery_level:      Battery,
  device_error_rate:      AlertTriangle,
  reboot_frequency:       RefreshCcw,
  proxy_success_rate:     CheckCircle2,
  avg_session_latency:    Clock,
  proxy_rotation_interval:Network,
  daily_target_achievement: Target,
  keyword_coverage:       Globe,
  platform_gemini:        Smartphone,
  platform_chatgpt:       Smartphone,
  platform_perplexity:    Smartphone,
  active_devices_target:  Server,
  sessions_per_day:       Zap,
  searches_per_device_day:TrendingUp,
  client_capacity:        Users,
};

function statusColor(value: string | null, target: string | null, unit: string | null): string {
  if (!value || !target) return "text-muted-foreground";
  const v = parseFloat(value);
  const t = parseFloat(target);
  if (isNaN(v) || isNaN(t)) return "text-foreground";
  const isError   = unit === "%" && ["device_error_rate", "reboot_frequency"].includes("");
  const ratio     = v / t;
  if (unit === "%") {
    if (v >= t) return "text-emerald-400";
    if (v >= t * 0.85) return "text-amber-400";
    return "text-destructive";
  }
  if (ratio >= 0.9) return "text-emerald-400";
  if (ratio >= 0.7) return "text-amber-400";
  return "text-destructive";
}

function pctBar(value: string | null, target: string | null, accent: string): React.ReactNode {
  if (!value || !target) return null;
  const v = Math.min(100, Math.max(0, parseFloat(value)));
  const t = Math.min(100, Math.max(0, parseFloat(target)));
  if (isNaN(v) || isNaN(t)) return null;
  const ratio = v / (t || 1);
  const barColor = ratio >= 1 ? "bg-emerald-500" : ratio >= 0.85 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="mt-2 space-y-0.5">
      <div className="w-full h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, (v / t) * 100)}%` }} />
      </div>
      <div className="flex justify-between">
        <span className="text-[9px] text-muted-foreground/50">0</span>
        <span className="text-[9px] text-muted-foreground/50">Target: {target}</span>
      </div>
    </div>
  );
}

/* ─── Edit Dialog ────────────────────────────────────────── */
function EditMetricDialog({
  metric, open, onOpenChange, onSave, saving,
}: {
  metric:       FarmMetric;
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  onSave:       (value: string, target: string) => void;
  saving:       boolean;
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
            <Input
              className="bg-muted/30 border-border/60 h-10 text-lg font-bold font-mono"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder={`e.g. ${metric.targetValue ?? "0"}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">
              Target Value {metric.unit && <span className="text-muted-foreground/40 normal-case font-normal">({metric.unit})</span>}
            </Label>
            <Input
              className="bg-muted/30 border-border/60 h-10 font-mono"
              value={tgt}
              onChange={(e) => setTgt(e.target.value)}
              placeholder="Target…"
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
          <Button className="flex-1 gap-2" disabled={saving || !val.trim()}
            onClick={() => onSave(val.trim(), tgt.trim())}
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}>
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function FarmMetrics() {
  const [editMetric, setEditMetric] = useState<FarmMetric | null>(null);
  const [saving,     setSaving]     = useState(false);
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const { data: metrics, isLoading } = useQuery<FarmMetric[]>({
    queryKey:  ["farm-metrics"],
    queryFn:   () => fetch(`${BASE}/api/farm-metrics`, { credentials: "include" }).then((r) => r.json()),
  });

  async function saveMetric(key: string, value: string, targetValue: string) {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/farm-metrics/${key}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ value, targetValue }),
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

  /* Group by category */
  const grouped = new Map<string, FarmMetric[]>();
  for (const m of metrics ?? []) {
    if (!grouped.has(m.category)) grouped.set(m.category, []);
    grouped.get(m.category)!.push(m);
  }

  /* High-level KPIs for the summary strip */
  const getVal = (key: string) => metrics?.find((m) => m.key === key)?.value ?? "—";
  const summaryKpis = [
    { label: "Device Rotation",    value: getVal("device_rotation"),        unit: "%", icon: Cpu,         color: "text-primary"     },
    { label: "IP Rotation",         value: getVal("ip_rotation"),            unit: "%", icon: Wifi,        color: "text-violet-400"  },
    { label: "Cache Clearing",      value: getVal("cache_clearing"),         unit: "%", icon: RefreshCcw,  color: "text-emerald-400" },
    { label: "Prompt Accuracy",     value: getVal("prompt_exec_accuracy"),   unit: "%", icon: ShieldCheck, color: "text-amber-400"   },
    { label: "Volume Accuracy",     value: getVal("volume_search_accuracy"), unit: "%", icon: BarChart2,   color: "text-blue-400"    },
  ];

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Device Farm Metrics</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          AEO device farm performance — all metrics are editable and stored persistently
        </p>
      </div>

      {/* ── KPI summary strip ── */}
      {isLoading ? (
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {summaryKpis.map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${k.color}`} />
                  <span className="text-[10px] text-muted-foreground">{k.label}</span>
                </div>
                <p className={`text-2xl font-bold font-mono ${k.color}`}>
                  {k.value}{k.value !== "—" ? k.unit : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Category sections ── */}
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
            const cfg  = CATEGORY_CONFIG[category] ?? { label: category, icon: BarChart2, color: "text-foreground", accent: "bg-muted/20 border-border/30" };
            const CatIcon = cfg.icon;

            return (
              <div key={category} className="space-y-3">
                {/* Section header */}
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-lg ${cfg.accent} flex items-center justify-center border`}>
                    <CatIcon className={`w-3.5 h-3.5 ${cfg.color}`} />
                  </div>
                  <h2 className={`text-sm font-bold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</h2>
                  <div className="flex-1 h-px bg-border/30" />
                  <span className="text-[10px] text-muted-foreground/40">{items.length} metrics</span>
                </div>

                {/* Metric cards grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {items.map((metric) => {
                    const Icon        = KEY_ICONS[metric.key] ?? BarChart2;
                    const valColor    = statusColor(metric.value, metric.targetValue, metric.unit);
                    const showBar     = metric.unit === "%" && metric.value !== null && metric.targetValue !== null;
                    const hasTarget   = metric.targetValue !== null;

                    return (
                      <Card key={metric.key}
                        className="border-border/50 bg-card/60 hover:bg-card/80 transition-colors group relative overflow-hidden">
                        {/* Edit button (top-right, appears on hover) */}
                        <button
                          onClick={() => setEditMetric(metric)}
                          className="absolute top-2 right-2 w-6 h-6 rounded-md bg-muted/40 hover:bg-primary/20 hover:text-primary text-muted-foreground/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10">
                          <Pencil className="w-3 h-3" />
                        </button>

                        <CardContent className="p-4">
                          {/* Icon + label */}
                          <div className="flex items-start gap-2 mb-2">
                            <div className={`w-7 h-7 rounded-lg border ${cfg.accent} flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                            </div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 leading-tight pt-0.5">
                              {metric.label}
                            </p>
                          </div>

                          {/* Value */}
                          <div className="flex items-end gap-1 mt-1">
                            <p className={`text-2xl font-bold font-mono leading-none ${valColor}`}>
                              {metric.value ?? "—"}
                            </p>
                            {metric.unit && metric.value !== null && (
                              <span className="text-xs text-muted-foreground mb-0.5">{metric.unit}</span>
                            )}
                          </div>

                          {/* Target badge */}
                          {hasTarget && (
                            <div className="flex items-center gap-1 mt-1.5">
                              <Target className="w-2.5 h-2.5 text-muted-foreground/40" />
                              <span className="text-[10px] text-muted-foreground/50">
                                Target: {metric.targetValue}{metric.unit}
                              </span>
                            </div>
                          )}

                          {/* Progress bar for % metrics */}
                          {showBar && pctBar(metric.value, metric.targetValue, cfg.accent)}

                          {/* Description */}
                          {metric.description && (
                            <p className="text-[10px] text-muted-foreground/40 mt-2 leading-relaxed line-clamp-2">
                              {metric.description}
                            </p>
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

      {/* ── Update info footer ── */}
      {metrics && metrics.length > 0 && (
        <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-3 flex items-center gap-3">
          <Pencil className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
          <p className="text-xs text-muted-foreground/50">
            Hover any metric card and click the edit icon to update its current value and target.
            All changes are saved immediately to the database.
          </p>
        </div>
      )}

      {/* ── Edit Dialog ── */}
      {editMetric && (
        <EditMetricDialog
          metric={editMetric}
          open
          onOpenChange={(o) => { if (!o) setEditMetric(null); }}
          saving={saving}
          onSave={(value, target) => saveMetric(editMetric.key, value, target)}
        />
      )}
    </div>
  );
}
