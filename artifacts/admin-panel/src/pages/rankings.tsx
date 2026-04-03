import { useState } from "react";
import { useGetRankingReports, useGetInitialVsCurrentRankings } from "@workspace/api-client-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  ArrowUp, ArrowDown, Minus, MapPin, TrendingUp, TrendingDown,
  Clock, CheckCircle2, AlertCircle, Search, BarChart3,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

/* ── Status derivation ──────────────────────────────────── */
type PerfStatus = "performing" | "steady" | "underperforming" | "pending";

function getStatus(positionChange: number | null, currentPosition: number | null, initialPosition: number | null): PerfStatus {
  if (positionChange === null || initialPosition === null || currentPosition === null) return "pending";
  if (positionChange > 0)  return "performing";
  if (positionChange < 0)  return "underperforming";
  return "steady";
}

/* ── Status badge component ─────────────────────────────── */
function StatusBadge({ status }: { status: PerfStatus }) {
  const map = {
    performing:      { label: "Performing",      cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25", icon: CheckCircle2 },
    steady:          { label: "Steady",           cls: "bg-amber-500/15 text-amber-400 border-amber-500/25",       icon: Minus        },
    underperforming: { label: "Underperforming",  cls: "bg-destructive/15 text-destructive border-destructive/25", icon: AlertCircle  },
    pending:         { label: "Pending",          cls: "bg-muted/40 text-muted-foreground border-border/40",        icon: Clock        },
  } satisfies Record<PerfStatus, { label: string; cls: string; icon: React.ElementType }>;
  const { label, cls, icon: Icon } = map[status];
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] font-semibold ${cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {label}
    </Badge>
  );
}

/* ── Position badge ─────────────────────────────────────── */
function RankBadge({ pos }: { pos: number | null | undefined }) {
  if (!pos) return <Badge variant="outline" className="bg-muted/30 text-muted-foreground">N/A</Badge>;
  if (pos <= 3)  return <Badge className="bg-amber-400/90 hover:bg-amber-400 text-amber-950 font-bold">#{pos}</Badge>;
  if (pos <= 7)  return <Badge className="bg-slate-300/90 hover:bg-slate-300 text-slate-900">#{pos}</Badge>;
  if (pos <= 10) return <Badge className="bg-amber-700/80 hover:bg-amber-700 text-white">#{pos}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">#{pos}</Badge>;
}

/* ── Change indicator ───────────────────────────────────── */
function ChangeCell({ change }: { change: number | null }) {
  if (change === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (change === 0)    return <span className="flex items-center gap-0.5 text-amber-400 font-mono text-sm"><Minus className="w-3 h-3" />0</span>;
  const up = change > 0;
  return (
    <span className={`flex items-center gap-0.5 font-bold font-mono text-sm ${up ? "text-emerald-400" : "text-destructive"}`}>
      {up ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
      {Math.abs(change)}
    </span>
  );
}

/* ── Main Page ──────────────────────────────────────────── */
export default function Rankings() {
  const { data: reports,    isLoading: isReportsLoading    } = useGetRankingReports();
  const { data: comparison, isLoading: isComparisonLoading } = useGetInitialVsCurrentRankings();

  const [statusFilter, setStatusFilter] = useState<PerfStatus | "all">("all");
  const [search, setSearch] = useState("");

  /* Enrich comparison rows with status */
  type CompRow = NonNullable<typeof comparison>[number] & { status: PerfStatus };
  const enriched: CompRow[] = (comparison ?? []).map((row) => ({
    ...row,
    status: getStatus(row.positionChange ?? null, row.currentPosition ?? null, row.initialPosition ?? null),
  }));

  /* Summary counts */
  const counts = {
    performing:      enriched.filter((r) => r.status === "performing").length,
    steady:          enriched.filter((r) => r.status === "steady").length,
    underperforming: enriched.filter((r) => r.status === "underperforming").length,
    pending:         enriched.filter((r) => r.status === "pending").length,
  };
  const totalImproved = counts.performing;
  const total         = enriched.length;
  const successRate   = total > 0 ? Math.round((totalImproved / total) * 100) : 0;

  /* Filtered rows */
  const filtered = enriched.filter((row) => {
    const matchStatus = statusFilter === "all" || row.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q
      || (row.clientName ?? "").toLowerCase().includes(q)
      || (row.keywordText ?? "").toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Ranking Reports</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          AI answer engine visibility and performance across all clients
        </p>
      </div>

      {/* ── AEO Impact Summary ── */}
      <div className="rounded-xl border border-border/50 bg-card/40 p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-primary" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AEO Performance Overview</p>
          {!isComparisonLoading && total > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              <span className="font-bold text-emerald-400">{successRate}%</span> success rate
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {isComparisonLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)
          ) : (
            [
              { key: "performing",      label: "Performing",      value: counts.performing,      icon: TrendingUp,   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
              { key: "steady",          label: "Steady",          value: counts.steady,          icon: Minus,        color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20"   },
              { key: "underperforming", label: "Underperforming", value: counts.underperforming, icon: TrendingDown, color: "text-destructive",  bg: "bg-destructive/10", border: "border-destructive/20" },
              { key: "pending",         label: "Pending",         value: counts.pending,         icon: Clock,        color: "text-muted-foreground", bg: "bg-muted/20",   border: "border-border/30"      },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(statusFilter === s.key as PerfStatus ? "all" : s.key as PerfStatus)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  statusFilter === s.key
                    ? `${s.border} ${s.bg}`
                    : "border-border/30 bg-transparent hover:border-border/50"
                }`}
              >
                <div className={`w-8 h-8 rounded-lg ${s.bg} ${s.border} border flex items-center justify-center shrink-0`}>
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <div>
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Progress bar */}
        {!isComparisonLoading && total > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
              <span>AEO Effectiveness</span>
              <span>{totalImproved}/{total} keywords improving</span>
            </div>
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="comparison" className="w-full">
        <TabsList className="grid w-full max-w-xs grid-cols-2 bg-card/60">
          <TabsTrigger value="comparison">Before / After</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ═══════════════════════ BEFORE / AFTER TAB ═══════════════════════ */}
        <TabsContent value="comparison" className="mt-4 space-y-3">
          {/* Search + status filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search client or keyword…"
                className="pl-8 bg-card/60 border-border/50 h-8 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["all", "performing", "steady", "underperforming", "pending"] as const).map((s) => {
                const labels: Record<typeof s, string> = {
                  all: "All", performing: "Performing", steady: "Steady",
                  underperforming: "Underperforming", pending: "Pending",
                };
                const active = statusFilter === s;
                const colors: Record<typeof s, string> = {
                  all:             "bg-primary text-primary-foreground border-primary",
                  performing:      "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
                  steady:          "bg-amber-500/20 text-amber-400 border-amber-500/40",
                  underperforming: "bg-destructive/20 text-destructive border-destructive/40",
                  pending:         "bg-muted/40 text-muted-foreground border-border/40",
                };
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      active ? colors[s] : "border-border/40 text-muted-foreground hover:border-border/70 bg-transparent"
                    }`}
                  >
                    {labels[s]}
                    {s !== "all" && <span className="ml-1 opacity-60">({counts[s] ?? 0})</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Table or cards */}
          {isComparisonLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground rounded-xl border border-dashed border-border/40 bg-card/20">
              No results found.
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block rounded-xl border border-border/50 overflow-hidden bg-card/30">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableHead className="text-xs">Client</TableHead>
                      <TableHead className="text-xs">Keyword</TableHead>
                      <TableHead className="text-xs">Maps</TableHead>
                      <TableHead className="text-xs text-center">Before</TableHead>
                      <TableHead className="text-xs text-center">Now</TableHead>
                      <TableHead className="text-xs text-center">Change</TableHead>
                      <TableHead className="text-xs text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row, i) => (
                      <TableRow key={`${row.clientId}-${row.keywordId}-${i}`} className="hover:bg-muted/20">
                        <TableCell className="font-medium text-sm">{row.clientName}</TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[180px] truncate">
                          {row.keywordText}
                        </TableCell>
                        <TableCell>
                          {row.mapsPresence === "yes"
                            ? <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <RankBadge pos={row.initialPosition} />
                            {row.initialDate && (
                              <span className="text-[9px] text-muted-foreground/60">
                                {format(new Date(row.initialDate), "MMM d")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <RankBadge pos={row.currentPosition} />
                            {row.currentDate && (
                              <span className="text-[9px] text-muted-foreground/60">
                                {format(new Date(row.currentDate), "MMM d")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <ChangeCell change={row.positionChange ?? null} />
                        </TableCell>
                        <TableCell className="text-right">
                          <StatusBadge status={row.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {filtered.map((row, i) => (
                  <div
                    key={`m-${row.clientId}-${row.keywordId}-${i}`}
                    className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3"
                  >
                    {/* Client + status */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm text-foreground">{row.clientName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{row.keywordText}</p>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    {/* Positions */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 rounded-lg bg-muted/20 p-2 text-center border border-border/30">
                        <p className="text-[9px] text-muted-foreground mb-1">Before</p>
                        <RankBadge pos={row.initialPosition} />
                      </div>
                      <div className="shrink-0">
                        <ChangeCell change={row.positionChange ?? null} />
                      </div>
                      <div className="flex-1 rounded-lg bg-muted/20 p-2 text-center border border-border/30">
                        <p className="text-[9px] text-muted-foreground mb-1">Now</p>
                        <RankBadge pos={row.currentPosition} />
                      </div>
                    </div>
                    {/* Maps */}
                    {row.mapsPresence === "yes" && (
                      <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <MapPin className="w-3 h-3" /> Listed on Maps
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ═══════════════════════ HISTORY TAB ═══════════════════════ */}
        <TabsContent value="history" className="mt-4">
          {isReportsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : (
            <div className="rounded-xl border border-border/50 overflow-hidden bg-card/30">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs">Keyword</TableHead>
                    <TableHead className="text-xs text-center">Position</TableHead>
                    <TableHead className="text-xs">AI Snippet</TableHead>
                    <TableHead className="text-xs text-right">Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!reports || reports.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-sm">
                        No ranking history yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    reports.map((report) => (
                      <TableRow key={report.id} className="hover:bg-muted/20">
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          <div>{format(new Date(report.createdAt), "MMM d, yyyy")}</div>
                          <div className="text-[9px] opacity-60">
                            {formatDistanceToNow(new Date(report.createdAt), { addSuffix: true })}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {report.clientName || `Client #${report.clientId}`}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[160px] truncate">
                          {report.keywordText || `Keyword #${report.keywordId}`}
                        </TableCell>
                        <TableCell className="text-center">
                          <RankBadge pos={report.rankingPosition} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate" title={report.reasonRecommended ?? ""}>
                          {report.reasonRecommended ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {report.isInitialRanking ? (
                            <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/20">
                              Initial
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] bg-muted/40 text-muted-foreground border-border/30">
                              Check-in
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
