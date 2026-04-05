/**
 * @file business-metrics.tsx
 * @page /business-metrics
 *
 * Business Metrics page — sortable, expandable matrix table showing the
 * five core AEO performance KPIs for every client business.
 *
 * KPIs displayed per business:
 *   1. Device Rotation  — unique devices used ÷ sessions with device assigned
 *   2. IP Rotation      — unique proxies used ÷ sessions with proxy assigned
 *   3. Cache Clearing   — manual global value from Device Farm Metrics
 *   4. Prompt Accuracy  — sessions with promptText ÷ total sessions
 *   5. Volume Accuracy  — actual sessions ÷ (active keywords × 30 days)
 *
 * Colour thresholds per cell:
 *   ≥ target        → emerald (on track)
 *   ≥ target × 0.8  → amber   (warning)
 *   < target × 0.8  → red     (critical)
 *
 * Data source: GET /api/metrics/business
 * Expanding a row reveals: device list, volume detail, metric raw counts.
 * The fleet-average footer row covers all businesses (not just the filtered set).
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Cpu, Wifi, RefreshCcw, ShieldCheck, BarChart2,
  ChevronDown, ChevronUp, Search, Smartphone, AlertCircle,
} from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Types ─────────────────────────────────────────────────────────────── */

/** A single KPI cell — value, target, and optional raw component counts */
interface MetricCell {
  value:          number | null;  // Computed percentage (null = no data)
  target:         number;         // Target percentage from farm_metrics
  isManual?:      boolean;        // True for cache clearing (no session signal)
  uniqueDevices?: number;
  withDevice?:    number;
  uniqueProxies?: number;
  withProxy?:     number;
  withPrompt?:    number;
  total?:         number;
  actual?:        number;
  monthlyTarget?: number;
}

/** Full business metrics row as returned by /api/metrics/business */
interface BusinessMetric {
  client:         { id: number; name: string; status: string; plan: string | null };
  sessionTotal:   number;
  devices:        { deviceId: number; identifier: string; model: string }[];
  activeKeywords: number;
  monthlyTarget:  number;         // activeKeywords × 30
  deviceRotation: MetricCell;
  ipRotation:     MetricCell;
  cacheClearing:  MetricCell;
  promptAccuracy: MetricCell;
  volumeAccuracy: MetricCell;
}

interface BusinessData {
  metrics: BusinessMetric[];
  targets: Record<string, number>; // Farm-wide targets keyed by metric key
}

/* ─── Column config ──────────────────────────────────────────────────────── */

/**
 * Ordered list of metric columns with display metadata.
 * `tip` is shown as a native tooltip on the icon sub-header.
 */
const COLS = [
  {
    key:   "deviceRotation" as const,
    label: "Device Rotation",
    short: "Dev Rot",
    icon:  Cpu,
    color: "text-primary",
    bg:    "bg-primary/10",
    tip:   "Unique devices ÷ sessions with device assigned",
  },
  {
    key:   "ipRotation" as const,
    label: "IP Rotation",
    short: "IP Rot",
    icon:  Wifi,
    color: "text-violet-400",
    bg:    "bg-violet-500/10",
    tip:   "Unique proxies ÷ sessions with proxy assigned",
  },
  {
    key:   "cacheClearing" as const,
    label: "Cache Clearing",
    short: "Cache",
    icon:  RefreshCcw,
    color: "text-emerald-400",
    bg:    "bg-emerald-500/10",
    tip:   "Manual — global setting from Device Farm Metrics",
  },
  {
    key:   "promptAccuracy" as const,
    label: "Prompt Accuracy",
    short: "Prompt",
    icon:  ShieldCheck,
    color: "text-amber-400",
    bg:    "bg-amber-500/10",
    tip:   "Sessions with prompt ÷ total sessions",
  },
  {
    key:   "volumeAccuracy" as const,
    label: "Volume Accuracy",
    short: "Volume",
    icon:  BarChart2,
    color: "text-blue-400",
    bg:    "bg-blue-500/10",
    tip:   "Actual sessions ÷ (active keywords × 30 days)",
  },
];

/* ─── MetricValueCell ────────────────────────────────────────────────────── */

/**
 * Renders a single percentage cell in the matrix table.
 * Shows value + mini progress bar + sub-label with raw counts.
 * Null values render a greyed "Manual" or "—" placeholder.
 */
function MetricValueCell({ cell, colKey }: { cell: MetricCell; colKey: string }) {
  const val = cell.value;
  const tgt = cell.target;

  // No data state — show placeholder text
  if (val === null) {
    return (
      <td className="px-3 py-0 border-l border-border/30 align-middle">
        <div className="flex flex-col items-center justify-center h-full py-3">
          {cell.isManual
            ? <span className="text-[10px] text-muted-foreground/40 italic">Manual</span>
            : <span className="text-[10px] text-muted-foreground/30">—</span>
          }
        </div>
      </td>
    );
  }

  // Colour thresholds: green ≥ target, amber ≥ 80% target, red otherwise
  const pct    = Math.min(100, (val / tgt) * 100);
  const valCls = val >= tgt ? "text-emerald-400" : val >= tgt * 0.8 ? "text-amber-400" : "text-destructive";
  const barCls = val >= tgt ? "bg-emerald-500"   : val >= tgt * 0.8 ? "bg-amber-500"   : "bg-destructive";

  // Sub-label shows the raw numerator/denominator for transparency
  let subLabel = "";
  if (colKey === "deviceRotation") subLabel = `${cell.uniqueDevices ?? 0} dev / ${cell.withDevice ?? 0} sess`;
  if (colKey === "ipRotation")     subLabel = `${cell.uniqueProxies ?? 0} prx / ${cell.withProxy ?? 0} sess`;
  if (colKey === "promptAccuracy") subLabel = `${cell.withPrompt ?? 0} / ${cell.total ?? 0} sess`;
  if (colKey === "volumeAccuracy") subLabel = `${cell.actual ?? 0} / ${cell.monthlyTarget ?? 0} tgt`;
  if (colKey === "cacheClearing")  subLabel = "Global";

  return (
    <td className="px-3 py-0 border-l border-border/30 align-middle">
      <div className="flex flex-col items-center justify-center py-3 gap-1">
        {/* Large bold percentage */}
        <span className={`text-xl font-bold font-mono leading-none ${valCls}`}>
          {val}<span className="text-xs font-normal text-muted-foreground">%</span>
        </span>
        {/* Mini progress bar */}
        <div className="w-14 h-1 rounded-full bg-muted/30 overflow-hidden">
          <div className={`h-full rounded-full ${barCls} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        {/* Raw count sub-label */}
        <span className="text-[9px] text-muted-foreground/40 leading-none whitespace-nowrap">{subLabel}</span>
        {/* Target benchmark */}
        <span className="text-[9px] text-muted-foreground/30 leading-none">tgt {tgt}%</span>
      </div>
    </td>
  );
}

/* ─── Sort key type ──────────────────────────────────────────────────────── */
type SortKey = "name" | "sessions" | "deviceRotation" | "ipRotation" | "cacheClearing" | "promptAccuracy" | "volumeAccuracy";

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function BusinessMetrics() {
  const [search,   setSearch]   = useState("");
  const [sortKey,  setSortKey]  = useState<SortKey>("name");
  const [sortAsc,  setSortAsc]  = useState(true);
  // Set of expanded client IDs — clicking a row toggles its detail panel
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data, isLoading, error } = useQuery<BusinessData>({
    queryKey: ["business-metrics"],
    queryFn:  () =>
      fetch(`${BASE}/api/metrics/business`, { credentials: "include" }).then((r) => r.json()),
  });

  /**
   * Toggles sort direction when clicking the same column header,
   * or resets to ascending when switching to a new column.
   */
  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(true); }
  }

  /**
   * Adds or removes a client ID from the expanded set.
   * Expanded rows show a device list, volume breakdown, and metric raw counts.
   */
  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // ── Loading state ────────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-12 w-full" />
      {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );

  // ── Error state ──────────────────────────────────────────────────────────
  if (error || !data) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertCircle className="w-10 h-10 text-destructive" />
      <p className="text-muted-foreground">Failed to load business metrics.</p>
    </div>
  );

  /* ── Filter by client name + sort by selected column ── */
  const filtered = data.metrics
    .filter((m) => (m.client.name ?? "").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      // Map sort key to the comparable value for each row
      if (sortKey === "name")           { av = a.client.name ?? "";           bv = b.client.name ?? "";          }
      if (sortKey === "sessions")       { av = a.sessionTotal;                bv = b.sessionTotal;               }
      if (sortKey === "deviceRotation") { av = a.deviceRotation.value ?? -1;  bv = b.deviceRotation.value ?? -1; }
      if (sortKey === "ipRotation")     { av = a.ipRotation.value ?? -1;      bv = b.ipRotation.value ?? -1;     }
      if (sortKey === "cacheClearing")  { av = a.cacheClearing.value ?? -1;   bv = b.cacheClearing.value ?? -1;  }
      if (sortKey === "promptAccuracy") { av = a.promptAccuracy.value ?? -1;  bv = b.promptAccuracy.value ?? -1; }
      if (sortKey === "volumeAccuracy") { av = a.volumeAccuracy.value ?? -1;  bv = b.volumeAccuracy.value ?? -1; }
      // String sort for name, numeric for everything else
      if (typeof av === "string")
        return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

  /**
   * Sortable table header cell component.
   * Highlights in primary colour when its column is active,
   * and shows a chevron indicating sort direction.
   */
  function SortTh({ label, sortK, className }: { label: string; sortK: SortKey; className?: string }) {
    const active = sortKey === sortK;
    return (
      <th
        className={`px-3 py-3 text-center text-[10px] uppercase tracking-wider cursor-pointer select-none whitespace-nowrap border-l border-border/30 transition-colors hover:bg-muted/30 ${
          active ? "text-primary" : "text-muted-foreground/50"
        } ${className ?? ""}`}
        onClick={() => toggleSort(sortK)}
      >
        <div className="flex items-center justify-center gap-1">
          {label}
          {active
            ? sortAsc
              ? <ChevronUp   className="w-3 h-3" />
              : <ChevronDown className="w-3 h-3" />
            : <ChevronDown className="w-3 h-3 opacity-20" />
          }
        </div>
      </th>
    );
  }

  /* ── Fleet average helper — null-safe mean over all businesses ── */
  function avg(vals: (number | null)[]) {
    const valid = vals.filter((v): v is number => v !== null);
    return valid.length
      ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
      : null;
  }

  // Pre-compute column averages across the full unfiltered dataset
  const avgDR = avg(data.metrics.map((m) => m.deviceRotation.value));
  const avgIP = avg(data.metrics.map((m) => m.ipRotation.value));
  const avgCC = avg(data.metrics.map((m) => m.cacheClearing.value));
  const avgPA = avg(data.metrics.map((m) => m.promptAccuracy.value));
  const avgVA = avg(data.metrics.map((m) => m.volumeAccuracy.value));

  return (
    <div className="space-y-5">

      {/* ── Header + search ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Business Metrics</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Per-business AEO performance — {data.metrics.length} businesses · 5 key metrics
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <Input
            className="pl-8 bg-muted/30 border-border/50 h-9 text-sm"
            placeholder="Search businesses…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Legend row — icons + labels for each metric column ── */}
      <div className="flex flex-wrap gap-3">
        {COLS.map((c) => (
          <div key={c.key} className="flex items-center gap-1.5">
            <div className={`w-5 h-5 rounded-md ${c.bg} flex items-center justify-center`}>
              <c.icon className={`w-3 h-3 ${c.color}`} />
            </div>
            <span className="text-xs text-muted-foreground">{c.label}</span>
          </div>
        ))}
        <div className="ml-auto text-[10px] text-muted-foreground/40 self-center">
          Click column headers to sort · Expand row for device details
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Matrix table: Business | Sessions | DevRot | IPRot | Cache | Prompt | Volume
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-border/50 overflow-hidden bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[900px]">
            <thead className="bg-muted/20 border-b border-border/50">
              <tr>
                {/* Business name — sortable */}
                <th
                  className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground/50 cursor-pointer hover:bg-muted/30 w-72"
                  onClick={() => toggleSort("name")}
                >
                  <div className="flex items-center gap-1">
                    Business
                    {sortKey === "name"
                      ? sortAsc
                        ? <ChevronUp   className="w-3 h-3 text-primary" />
                        : <ChevronDown className="w-3 h-3 text-primary" />
                      : <ChevronDown className="w-3 h-3 opacity-20" />
                    }
                  </div>
                </th>
                {/* Sessions count — sortable */}
                <SortTh label="Sessions" sortK="sessions" className="w-20" />
                {/* Five KPI columns — all sortable */}
                <SortTh label="Device Rotation"  sortK="deviceRotation"  />
                <SortTh label="IP Rotation"       sortK="ipRotation"      />
                <SortTh label="Cache Clearing"    sortK="cacheClearing"   />
                <SortTh label="Prompt Accuracy"   sortK="promptAccuracy"  />
                <SortTh label="Volume Accuracy"   sortK="volumeAccuracy"  />
              </tr>

              {/* Icon sub-header row — shows coloured icons and tooltip hints */}
              <tr className="border-b border-border/30 bg-muted/10">
                <th className="px-4 py-1.5 text-left">
                  <span className="text-[10px] text-muted-foreground/30">{filtered.length} businesses shown</span>
                </th>
                <th className="px-3 py-1.5 border-l border-border/30 text-center">
                  <span className="text-[10px] text-muted-foreground/30">total</span>
                </th>
                {COLS.map((c) => (
                  <th key={c.key} className="px-3 py-1.5 border-l border-border/30 text-center" title={c.tip}>
                    <div className="flex items-center justify-center">
                      <div className={`w-5 h-5 rounded-md ${c.bg} flex items-center justify-center`}>
                        <c.icon className={`w-3 h-3 ${c.color}`} />
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-border/30">
              {/* Empty state when search yields no results */}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground/50 text-sm">
                    No businesses match your search.
                  </td>
                </tr>
              )}

              {filtered.map((bm) => {
                const isExp   = expanded.has(bm.client.id);
                const rowKey  = `bm-${bm.client.id}`;

                return (
                  <React.Fragment key={rowKey}>
                    {/* ── Main data row — click to expand ── */}
                    <tr
                      className="hover:bg-muted/20 transition-colors cursor-pointer group"
                      onClick={() => toggleExpand(bm.client.id)}
                    >
                      {/* Business cell: expand toggle + name + status dot + plan badge */}
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-start gap-2.5">
                          {/* Chevron expand indicator */}
                          <button
                            className="mt-0.5 w-5 h-5 rounded flex items-center justify-center text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors flex-shrink-0"
                            onClick={(e) => { e.stopPropagation(); toggleExpand(bm.client.id); }}
                          >
                            {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          <div className="min-w-0">
                            {/* Client name links to their detail page */}
                            <Link
                              href={`/clients/${bm.client.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate block"
                            >
                              {bm.client.name}
                            </Link>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {/* Status indicator dot */}
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                bm.client.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/30"
                              }`} />
                              <span className="text-[10px] text-muted-foreground capitalize">{bm.client.status}</span>
                              {bm.client.plan && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-muted-foreground/60 border-border/40">
                                  {bm.client.plan}
                                </Badge>
                              )}
                              <span className="text-[10px] text-muted-foreground/40">{bm.activeKeywords} kws</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Total session count */}
                      <td className="px-3 py-3 text-center border-l border-border/30 align-middle">
                        <span className="text-sm font-mono font-semibold text-foreground">{bm.sessionTotal}</span>
                      </td>

                      {/* Five KPI cells */}
                      <MetricValueCell cell={bm.deviceRotation} colKey="deviceRotation" />
                      <MetricValueCell cell={bm.ipRotation}     colKey="ipRotation"     />
                      <MetricValueCell cell={bm.cacheClearing}  colKey="cacheClearing"  />
                      <MetricValueCell cell={bm.promptAccuracy} colKey="promptAccuracy" />
                      <MetricValueCell cell={bm.volumeAccuracy} colKey="volumeAccuracy" />
                    </tr>

                    {/* ── Expanded detail row — devices, volume breakdown, raw counts ── */}
                    {isExp && (
                      <tr key={`${rowKey}-exp`} className="bg-muted/10 border-t-0">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="flex gap-8 flex-wrap">

                            {/* Device list — shows identifier + model for each device used */}
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2 flex items-center gap-1">
                                <Smartphone className="w-3 h-3" /> Devices Used
                              </p>
                              {bm.devices.length === 0
                                ? <span className="text-xs text-muted-foreground/40 italic">No device records yet</span>
                                : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {bm.devices.map((d) => (
                                      <div
                                        key={d.deviceId}
                                        className="flex items-center gap-1.5 rounded-md border border-border/40 bg-card/60 px-2 py-1"
                                      >
                                        <Cpu className="w-3 h-3 text-primary/60 flex-shrink-0" />
                                        <div>
                                          <span className="text-[10px] font-mono font-semibold text-foreground">{d.identifier}</span>
                                          <span className="text-[9px] text-muted-foreground/50 ml-1">{d.model}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )
                              }
                            </div>

                            {/* Volume detail — keyword count, targets, actuals, remaining */}
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2">Volume Detail</p>
                              <div className="flex gap-4 text-xs">
                                <div>
                                  <span className="text-muted-foreground/50">Active Keywords</span>
                                  <p className="text-foreground font-semibold">{bm.activeKeywords}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground/50">Monthly Target</span>
                                  {/* Target = keywords × 30 days */}
                                  <p className="text-primary font-semibold">{bm.monthlyTarget.toLocaleString()}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground/50">Actual Sessions</span>
                                  <p className="text-foreground font-semibold">{bm.sessionTotal}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground/50">Remaining</span>
                                  {/* Amber if sessions still needed, green if target met */}
                                  <p className={`font-semibold ${
                                    bm.monthlyTarget - bm.sessionTotal > 0 ? "text-amber-400" : "text-emerald-400"
                                  }`}>
                                    {Math.max(0, bm.monthlyTarget - bm.sessionTotal).toLocaleString()}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Metric detail — raw numerator/denominator for each KPI */}
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2">Metric Detail</p>
                              <div className="flex gap-4 flex-wrap text-xs">
                                {bm.deviceRotation.withDevice ? (
                                  <span className="text-muted-foreground/60">
                                    {bm.deviceRotation.uniqueDevices} unique devices / {bm.deviceRotation.withDevice} sessions
                                  </span>
                                ) : null}
                                {bm.ipRotation.withProxy ? (
                                  <span className="text-muted-foreground/60">
                                    {bm.ipRotation.uniqueProxies} unique proxies / {bm.ipRotation.withProxy} sessions
                                  </span>
                                ) : null}
                                {bm.promptAccuracy.total ? (
                                  <span className="text-muted-foreground/60">
                                    {bm.promptAccuracy.withPrompt} prompts / {bm.promptAccuracy.total} sessions
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>

            {/* ── Fleet average footer row ── */}
            {/* Averages are computed from the full unfiltered dataset so the footer
                always represents the complete fleet regardless of search filters */}
            <tfoot className="border-t-2 border-border bg-muted/20">
              <tr>
                <td className="px-4 py-3 font-bold text-xs uppercase tracking-wider text-muted-foreground">
                  Fleet Average ({data.metrics.length} businesses)
                </td>
                <td className="px-3 py-3 text-center border-l border-border/30">
                  <span className="text-sm font-mono font-bold text-foreground">
                    {data.metrics.reduce((a, b) => a + b.sessionTotal, 0)}
                  </span>
                </td>
                {/* One average cell per KPI column */}
                {[
                  { val: avgDR, tgt: data.targets.device_rotation       ?? 80  },
                  { val: avgIP, tgt: data.targets.ip_rotation            ?? 90  },
                  { val: avgCC, tgt: data.targets.cache_clearing         ?? 100 },
                  { val: avgPA, tgt: data.targets.prompt_exec_accuracy   ?? 95  },
                  { val: avgVA, tgt: data.targets.volume_search_accuracy ?? 98  },
                ].map(({ val, tgt }, i) => (
                  <td key={i} className="px-3 py-3 text-center border-l border-border/30">
                    {val !== null ? (
                      <span className={`text-sm font-bold font-mono ${
                        val >= tgt       ? "text-emerald-400" :
                        val >= tgt * 0.8 ? "text-amber-400"   : "text-destructive"
                      }`}>
                        {val}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30 text-xs">—</span>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Empty state hint — shown when zero sessions exist ── */}
      {data.metrics.every((m) => m.sessionTotal === 0) && (
        <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-3 text-xs text-muted-foreground/50 text-center">
          No session data yet — metrics will populate once sessions are logged for each business.
        </div>
      )}
    </div>
  );
}
