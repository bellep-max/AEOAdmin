import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Cpu, Wifi, RefreshCcw, ShieldCheck, BarChart2, Search, TrendingUp, TrendingDown,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Types ─────────────────────────────────────────────── */
interface MetricCell {
  value: number | null;
  target: number;
  isManual?: boolean;
  uniqueDevices?: number;
  withDevice?: number;
  uniqueProxies?: number;
  withProxy?: number;
  withPrompt?: number;
  total?: number;
  actual?: number;
  monthlyTarget?: number;
}

interface BusinessMetric {
  client: { id: number; name: string; status: string; plan: string | null };
  sessionTotal: number;
  devices: { deviceId: number; identifier: string; model: string }[];
  activeKeywords: number;
  monthlyTarget: number;
  deviceRotation: MetricCell;
  ipRotation: MetricCell;
  cacheClearing: MetricCell;
  promptAccuracy: MetricCell;
  volumeAccuracy: MetricCell;
}

interface BusinessData {
  metrics: BusinessMetric[];
  targets: Record<string, number>;
}

/* ─── Metric column definitions ──────────────────────────── */
const METRIC_COLS = [
  { key: "deviceRotation", label: "Device Rotation", icon: Cpu, color: "text-blue-500", bg: "bg-blue-500/10" },
  { key: "ipRotation", label: "IP Rotation", icon: Wifi, color: "text-purple-500", bg: "bg-purple-500/10" },
  { key: "cacheClearing", label: "Cache Clearing", icon: RefreshCcw, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { key: "promptAccuracy", label: "Prompt Accuracy", icon: ShieldCheck, color: "text-amber-500", bg: "bg-amber-500/10" },
  { key: "volumeAccuracy", label: "Volume Accuracy", icon: BarChart2, color: "text-rose-500", bg: "bg-rose-500/10" },
] as const;

export default function Metrics() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<BusinessData>({
    queryKey: ["business-metrics"],
    queryFn: () => fetch(`${BASE}/api/metrics/business`, { credentials: "include" }).then((r) => r.json()),
  });

  const filtered = (data?.metrics ?? []).filter((m) =>
    m.client.name.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  // Calculate fleet-wide averages
  const averages = METRIC_COLS.map((col) => {
    const values = (data.metrics ?? [])
      .map((m) => m[col.key as keyof BusinessMetric] as MetricCell)
      .filter((cell) => cell.value !== null)
      .map((cell) => cell.value as number);
    
    const avg = values.length > 0
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : 0;
    
    return avg;
  });

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Metrics</h1>
        <p className="text-lg text-slate-700 dark:text-slate-300 mt-1">
          Performance tracking across all businesses
        </p>
      </div>

      {/* ── Metric overview cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {METRIC_COLS.map((col, idx) => {
          const Icon = col.icon;
          const targetKey = col.key === "deviceRotation" ? "device_rotation" : 
                            col.key === "ipRotation" ? "ip_rotation" :
                            col.key === "cacheClearing" ? "cache_clearing" :
                            col.key === "promptAccuracy" ? "prompt_exec_accuracy" :
                            "volume_search_accuracy";
          const target = (data.targets ?? {})[targetKey] ?? 100;
          const avg = averages[idx];
          const isGood = avg >= target;

          return (
            <Card key={col.key} className="border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className={`w-10 h-10 rounded-xl ${col.bg} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${col.color}`} />
                  </div>
                  {isGood ? (
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-destructive" />
                  )}
                </div>
                <CardTitle className="text-sm font-bold text-black dark:text-white mt-3">
                  {col.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{avg}%</span>
                  <span className="text-xs text-muted-foreground">/ {target}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full transition-all ${isGood ? 'bg-emerald-500' : 'bg-destructive'}`}
                    style={{ width: `${Math.min(100, (avg / target) * 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Search bar ── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search businesses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="secondary" className="text-xs">
          {filtered.length} {filtered.length === 1 ? "business" : "businesses"}
        </Badge>
      </div>

      {/* ── Metrics table ── */}
      <Card className="border-border/50">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left p-4 font-bold text-base text-black dark:text-white">
                  Business
                </th>
                {METRIC_COLS.map((col) => {
                  const Icon = col.icon;
                  return (
                    <th key={col.key} className="text-center p-4 font-bold text-base text-black dark:text-white">
                      <div className="flex flex-col items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg ${col.bg} flex items-center justify-center`}>
                          <Icon className={`w-4 h-4 ${col.color}`} />
                        </div>
                        <span className="text-muted-foreground text-xs">{col.label}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    {search ? "No businesses found" : "No businesses yet"}
                  </td>
                </tr>
              ) : (
                filtered.map((business) => (
                  <tr key={business.client.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-base text-black dark:text-white">{business.client.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={business.client.status === "active" ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {business.client.status}
                          </Badge>
                          {business.client.plan && (
                            <span className="text-xs text-muted-foreground">{business.client.plan}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    {METRIC_COLS.map((col) => {
                      const cell = business[col.key as keyof BusinessMetric] as MetricCell;
                      const value = cell.value;
                      const target = cell.target;

                      if (value === null) {
                        return (
                          <td key={col.key} className="p-4 text-center">
                            <span className="text-xs text-muted-foreground italic">—</span>
                          </td>
                        );
                      }

                      const percentage = value;
                      const isGood = percentage >= target;

                      return (
                        <td key={col.key} className="p-4">
                          <div className="flex flex-col items-center gap-2">
                            <div className="relative w-16 h-16">
                              <svg className="w-16 h-16 transform -rotate-90">
                                <circle
                                  cx="32"
                                  cy="32"
                                  r="28"
                                  stroke="currentColor"
                                  strokeWidth="6"
                                  fill="none"
                                  className="text-muted"
                                />
                                <circle
                                  cx="32"
                                  cy="32"
                                  r="28"
                                  stroke="currentColor"
                                  strokeWidth="6"
                                  fill="none"
                                  strokeDasharray={`${(percentage / 100) * 175.93} 175.93`}
                                  className={isGood ? "text-emerald-500" : "text-destructive"}
                                />
                              </svg>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className={`text-sm font-bold ${isGood ? "text-emerald-500" : "text-destructive"}`}>
                                  {percentage}%
                                </span>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Target: {target}%
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
