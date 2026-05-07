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
  ScrollText, ChevronRight, Loader2, PlayCircle, AlertTriangle,
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
                      <TableCell className="text-sm font-mono">{r.reportDate}</TableCell>
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
                        <Link href={`/reports/${r.id}`}>
                          <Button size="icon" variant="ghost" className="h-7 w-7">
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </Link>
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
}

function RunReportDialog({ open, onOpenChange, onScheduled }: RunReportDialogProps) {
  const [date, setDate] = useState(todayIsoLocal());
  const [scopeKind, setScopeKind] = useState<"all" | "client" | "business" | "campaign">("all");
  const [scopeId, setScopeId] = useState("");
  const [lookbackDays, setLookbackDays] = useState("14");
  const [pending, setPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        <Button size="sm">
          <PlayCircle className="w-4 h-4 mr-1.5" />
          Run report
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run audit report</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="date">Report date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
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
            <p className="text-xs text-muted-foreground">
              Window for movement + activity correlation. Default 14 days.
            </p>
          </div>
          {errorMsg ? (
            <div className="text-xs text-destructive">{errorMsg}</div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            R1 takes ~80 seconds. The dialog closes immediately; refresh the list in ~2 minutes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
