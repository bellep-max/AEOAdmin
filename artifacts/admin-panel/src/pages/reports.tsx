import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ScrollText, ChevronRight, Loader2, PlayCircle, AlertTriangle, Trash2,
} from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { format } from "date-fns";

interface AuditReportListRow {
  id: number;
  reportDate: string;
  scope: string;
  scopeId: number | null;
  modelUsed: string | null;
  inputSummary: Record<string, unknown> | null;
  generatedAt: string | null;
  durationMs: number | null;
  costUsd: string | null;
}

interface AuditReportListResponse {
  reports: AuditReportListRow[];
  total: number;
}

const TOKEN = import.meta.env.VITE_EXECUTOR_TOKEN ?? "";
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function recsCount(input: Record<string, unknown> | null): number | null {
  if (!input) return null;
  const inferred = (input.recommendationsCount ?? input.recsCount) as unknown;
  return typeof inferred === "number" ? inferred : null;
}

function dateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

export default function Reports() {
  const qc = useQueryClient();
  const [runOpen, setRunOpen] = useState(false);
  const [generatingUntil, setGeneratingUntil] = useState<number | null>(null);

  const isGenerating = generatingUntil != null && Date.now() < generatingUntil;

  const { data, isLoading, error } = useQuery<AuditReportListResponse>({
    queryKey: ["/api/llm/audit-reports"],
    queryFn: async () => {
      const res = await rawFetch("/api/llm/audit-reports?limit=50");
      if (!res.ok) throw new Error(`Failed to load reports (${res.status})`);
      return res.json();
    },
    // Poll every 10s while a report is being generated server-side.
    refetchInterval: isGenerating ? 10_000 : false,
  });

  // Stop the polling banner once it expires or once a new report appears.
  const newestId = data?.reports?.[0]?.id ?? null;
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const deleteReport = async (id: number) => {
    if (!confirm(`Delete report #${id}? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${BASE}/api/llm/audit-reports/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
      }
      qc.invalidateQueries({ queryKey: ["/api/llm/audit-reports"] });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    if (generatingUntil == null) return;
    const triggeredAtNewestId = (window as unknown as { __reportsBaselineId?: number | null }).__reportsBaselineId;
    if (newestId != null && triggeredAtNewestId != null && newestId !== triggeredAtNewestId) {
      setGeneratingUntil(null);
    }
  }, [newestId, generatingUntil]);

  useEffect(() => {
    if (generatingUntil == null) return;
    const remaining = generatingUntil - Date.now();
    if (remaining <= 0) { setGeneratingUntil(null); return; }
    const t = window.setTimeout(() => setGeneratingUntil(null), remaining);
    return () => window.clearTimeout(t);
  }, [generatingUntil]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
          <ScrollText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Reports</h1>
          <p className="text-sm text-muted-foreground">
            DeepSeek-R1 analysis of ranking movements, similarity flags, GMB mismatches, and session activity.
          </p>
        </div>
        <div className="ml-auto">
          <RunReportDialog
            open={runOpen}
            onOpenChange={setRunOpen}
            disabled={isGenerating}
            onScheduled={() => {
              setRunOpen(false);
              // Remember the newest id at trigger time so we can stop the
              // banner when a new report appears in the list.
              (window as unknown as { __reportsBaselineId?: number | null }).__reportsBaselineId = newestId;
              // Poll for up to 3 minutes — R1 typically finishes in 50-90s
              // but can occasionally take longer.
              setGeneratingUntil(Date.now() + 3 * 60 * 1000);
              qc.invalidateQueries({ queryKey: ["/api/llm/audit-reports"] });
            }}
          />
        </div>
      </div>

      {isGenerating ? (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/30 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
          <span className="text-foreground">
            Generating audit report (DeepSeek-R1)… typically 50–90 seconds. The list refreshes automatically when it lands.
          </span>
        </div>
      ) : null}

      {/* List */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent reports</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="px-4 py-3 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {(error as Error).message}
            </div>
          ) : isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : !data?.reports?.length ? (
            <div className="p-6 text-sm text-muted-foreground">
              No reports yet. Click <span className="font-semibold">Run report</span> to generate one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead className="w-32">Scope</TableHead>
                  <TableHead className="w-20">Recs</TableHead>
                  <TableHead className="w-44">Model</TableHead>
                  <TableHead className="w-24">Cost</TableHead>
                  <TableHead className="w-44">Generated</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.reports.map((r) => {
                  const recs = recsCount(r.inputSummary);
                  const scope = r.scope === "all"
                    ? "All"
                    : r.scopeId != null
                      ? `${r.scope} #${r.scopeId}`
                      : r.scope;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-mono">{dateOnly(r.reportDate)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{scope}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{recs ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.modelUsed ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.costUsd ? `$${Number(r.costUsd).toFixed(4)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.generatedAt ? format(new Date(r.generatedAt), "MMM d, h:mm a") : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => deleteReport(r.id)}
                            disabled={deletingId === r.id}
                          >
                            {deletingId === r.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                          </Button>
                          <Link href={`/reports/${r.id}`}>
                            <Button size="icon" variant="ghost" className="h-7 w-7">
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface RunReportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onScheduled: () => void;
  disabled?: boolean;
}

function RunReportDialog({ open, onOpenChange, onScheduled, disabled }: RunReportDialogProps) {
  const [date, setDate] = useState(todayIsoLocal());
  const [scopeKind, setScopeKind] = useState<"all" | "client" | "business" | "campaign">("all");
  const [scopeId, setScopeId] = useState("");
  const [lookbackDays, setLookbackDays] = useState("14");
  const [pending, setPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lookbackNum = Number(lookbackDays);
  const lookbackInvalid = !Number.isFinite(lookbackNum) || lookbackNum < 1;
  const tooShort = !lookbackInvalid && lookbackNum < 3;
  const noisy = !lookbackInvalid && lookbackNum >= 3 && lookbackNum < 7;

  const windowStart = ((): string | null => {
    if (lookbackInvalid || !date) return null;
    const end = new Date(`${date}T00:00:00`);
    if (Number.isNaN(end.getTime())) return null;
    const start = new Date(end);
    start.setDate(start.getDate() - lookbackNum);
    const y = start.getFullYear();
    const m = `${start.getMonth() + 1}`.padStart(2, "0");
    const d = `${start.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();

  const submit = async () => {
    setPending(true);
    setErrorMsg(null);
    try {
      const body: Record<string, string | number> = { date, lookbackDays: Number(lookbackDays) };
      if (scopeKind === "client" && scopeId) body.clientId = Number(scopeId);
      if (scopeKind === "business" && scopeId) body.businessId = Number(scopeId);
      if (scopeKind === "campaign" && scopeId) body.campaignId = Number(scopeId);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (TOKEN) headers["X-Executor-Token"] = TOKEN;

      // Fire-and-forget: server takes ~80s. Don't await full response — just confirm 2xx start.
      const ctrl = new AbortController();
      const timeout = window.setTimeout(() => ctrl.abort(), 5000);

      try {
        await fetch(`${BASE}/api/llm/audit-report/run`, {
          method: "POST",
          credentials: "include",
          signal: ctrl.signal,
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        // expected — abort on timeout. Server is still processing.
      } finally {
        window.clearTimeout(timeout);
      }
      onScheduled();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to start report");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <PlayCircle className="w-4 h-4 mr-1.5" />
          {disabled ? "Generating…" : "Run report"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run audit report</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="date">Window end</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Last day included. Stored on the report as its label — the data window is set by Lookback below.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Select value={scopeKind} onValueChange={(v) => setScopeKind(v as typeof scopeKind)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="campaign">Campaign</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scopeKind !== "all" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="scopeId">{scopeKind} ID</Label>
                  <Input
                    id="scopeId"
                    type="number"
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    placeholder="e.g. 12"
                  />
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">All</span> = every campaign. Pick Client / Business / Campaign to focus the analysis on that subset's keywords only.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lookback">Lookback days</Label>
            <Input
              id="lookback"
              type="number"
              min={1}
              max={90}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(e.target.value)}
            />
            {!lookbackInvalid && windowStart ? (
              <p className="text-xs text-muted-foreground">
                Analyzing <span className="font-mono">{windowStart}</span> → <span className="font-mono">{date}</span> ({lookbackNum} day{lookbackNum === 1 ? "" : "s"})
              </p>
            ) : null}
            {tooShort ? (
              <p className="text-xs text-destructive flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                Under 3 days produces unusable output (almost no rank movement to analyze). Use 7 (weekly) or 14 (bi-weekly).
              </p>
            ) : noisy ? (
              <p className="text-xs text-amber-600 dark:text-amber-500 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                Shorter than 7 days produces narrow, noisy reports. Recommended: 14 (bi-weekly) or 7 (weekly).
              </p>
            ) : !lookbackInvalid ? (
              <p className="text-xs text-muted-foreground">
                Default 14 (bi-weekly cadence). Movement, similarity, and session activity are correlated within this window.
              </p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground border-l-2 border-border pl-2">
            Same scope + same window = near-identical R1 output (input data is identical). Vary scope or shift the window to compare.
          </p>
          {errorMsg ? (
            <div className="text-xs text-destructive">{errorMsg}</div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            R1 takes ~80 seconds. The dialog closes immediately; refresh the list in ~2 minutes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || tooShort || lookbackInvalid}>
            {pending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
