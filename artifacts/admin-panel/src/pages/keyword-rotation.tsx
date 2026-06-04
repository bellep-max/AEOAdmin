import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, Lock, Unlock, Zap, AlertCircle, CheckCircle2,
  BarChart3, Target, Star, Info, TrendingDown, TrendingUp,
  RotateCcw, Bell, ShieldAlert, Activity, ArrowRight,
  Archive, Sparkles, ChevronDown, ChevronRight, Plus,
  CheckCircle, XCircle, Loader2, ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// ── API helpers ───────────────────────────────────────────────────────────────
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const h: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) h["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers: h });
}
// ranking-reports uses api-token auth (not the session cookie); route it through the same
// env-based BASE (Vercel rewrites /api/* to the API server) — no hardcoded host.
const RANKING_API_TOKEN = import.meta.env.VITE_AEO_API_TOKEN ?? "";
function rankingFetch(path: string) {
  const h: Record<string, string> = { Authorization: `Bearer ${RANKING_API_TOKEN}` };
  if (BASE.includes("ngrok")) h["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { headers: h });
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TOP3_THRESHOLD = 3;
const LOCK_MIN_RUNS  = 5;
const WINDOW_RUNS    = 7;
const STALE_RUNS     = 5;
const FETCH_DAYS     = 90;

type Platform = "chatgpt" | "gemini" | "perplexity";
const PLATFORMS: { value: Platform; label: string; color: string; dot: string }[] = [
  { value: "chatgpt",    label: "ChatGPT",    color: "text-emerald-500", dot: "bg-emerald-500" },
  { value: "gemini",     label: "Gemini",     color: "text-blue-500",    dot: "bg-blue-500"    },
  { value: "perplexity", label: "Perplexity", color: "text-amber-500",   dot: "bg-amber-500"   },
];

function getDateRange() {
  const today = new Date();
  const start = new Date(today); start.setDate(today.getDate() - FETCH_DAYS);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { dateFrom: fmt(start), dateTo: fmt(today) };
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Kw { id: number; keywordText: string; clientId: number; businessId: number | null; isActive: boolean; isPrimary: boolean | number; priority?: number; archivedAt?: string | null; archiveReason?: string | null; replacementSuggestion?: string | null; }
interface RankReport { id: number; keywordId?: number; keyword?: string; keywordText?: string; rankingPosition: number | null; date?: string; timestamp?: string; createdAt?: string; }
interface Variant { id: number; keywordId: number; variantText: string; isActive: boolean; generatedAt?: string; }
interface Entry {
  kw: Kw; top3Runs: number; stability: number; currentRank: number | null; firstRank: number | null;
  history: (number | null)[]; runDates: string[]; windowSize: number;
  locked: boolean; atRisk: boolean; trend: "up" | "down" | "flat" | "none";
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StabilityBar({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const c = pct >= 72 ? "bg-emerald-500" : pct >= 43 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${c}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-xs text-muted-foreground">—</span>;
  const c = rank <= 1 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
    : rank <= 3 ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
    : rank <= 10 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
    : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${c}`}>#{rank}</span>;
}

function Sparkline({ history, atRisk }: { history: (number | null)[]; atRisk?: boolean }) {
  const valid = history.filter((v): v is number => v !== null);
  if (valid.length < 2) return <span className="text-xs text-muted-foreground opacity-40">—</span>;
  const max = Math.max(...valid), min = Math.min(...valid), range = max - min || 1;
  const w = 56, h = 20;
  const pts = history.map((v, i) => `${(i / (history.length - 1)) * w},${v === null ? h / 2 : ((v - min) / range) * (h - 4) + 2}`);
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5"
        className={atRisk ? "text-destructive" : "text-primary"} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TrendIcon({ trend }: { trend: Entry["trend"] }) {
  if (trend === "up")   return <TrendingUp  className="w-4 h-4 text-emerald-500" />;
  if (trend === "down") return <TrendingDown className="w-4 h-4 text-destructive" />;
  if (trend === "flat") return <Activity className="w-4 h-4 text-amber-500" />;
  return <span className="text-muted-foreground text-xs">—</span>;
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color ?? "bg-muted"}`}>{icon}</div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold leading-tight">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Variants panel ────────────────────────────────────────────────────────────
function VariantsPanel({ kwId, kwText, isTop3, clientId }: { kwId: number; kwText: string; isTop3: boolean; clientId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["variants", kwId],
    enabled: open,
    queryFn: async () => {
      const r = await rawFetch(`/api/keywords/${kwId}/variants?includeInactive=false`);
      if (!r.ok) throw new Error("Failed");
      return (await r.json()) as { variants: Variant[]; total: number };
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const r = await rawFetch(`/api/keywords/${kwId}/variants/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: 8 }) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["variants", kwId] });
      toast({ title: "Variants generated", description: `${d.total} new variants created for "${kwText}"` });
    },
    onError: (e: Error) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Sparkles className="w-3 h-3 text-primary" />
          Variants {data ? `(${data.total})` : ""}
          {isTop3 && <Badge className="text-[9px] h-3.5 px-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0 ml-1">auto-included</Badge>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 pl-4 border-l-2 border-primary/20 space-y-1.5">
          {isLoading && <Skeleton className="h-4 w-48" />}
          {!isLoading && data && data.variants.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No variants yet.</p>
          )}
          {!isLoading && data && data.variants.map((v) => (
            <div key={v.id} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary/40 flex-shrink-0" />
              <span className="text-xs">{v.variantText}</span>
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-6 text-xs mt-1" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
            {data?.total ? "Regenerate" : "Generate variants"}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Archive + Replace panel ───────────────────────────────────────────────────
function ArchivePanel({ entry, clientId, onDone }: { entry: Entry; clientId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string>("");
  const [step, setStep] = useState<"idle" | "generating" | "choosing" | "done">("idle");

  const archiveAndGenerate = useMutation({
    mutationFn: async () => {
      setStep("generating");
      const r = await rawFetch(`/api/keywords/${entry.kw.id}/generate-replacement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: `No ranking improvement after ${STALE_RUNS}+ runs — auto-replaced` }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json() as Promise<{ archived: boolean; replacement: string; allSuggestions: string[] }>;
    },
    onSuccess: (d) => {
      setSuggestions(d.allSuggestions.slice(0, 5));
      setChosen(d.allSuggestions[0] ?? "");
      setStep("choosing");
      toast({ title: "Keyword archived", description: `"${entry.kw.keywordText}" archived. Choose a replacement below.` });
    },
    onError: (e: Error) => { setStep("idle"); toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const createNew = useMutation({
    mutationFn: async () => {
      const r = await rawFetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: parseInt(clientId),
          businessId: entry.kw.businessId,
          keywordText: chosen,
          isActive: true,
          status: "new",
          notes: `Replacement for archived keyword "${entry.kw.keywordText}"`,
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: (d) => {
      setStep("done");
      toast({ title: "New keyword created!", description: `"${chosen}" added to rotation queue.` });
      onDone();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (step === "idle") {
    return (
      <Button size="sm" variant="destructive" className="h-7 text-xs gap-1.5 mt-1"
        onClick={() => archiveAndGenerate.mutate()}>
        <Archive className="w-3.5 h-3.5" />
        Archive &amp; Generate Replacement
      </Button>
    );
  }

  if (step === "generating") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Archiving keyword &amp; generating AI replacements…
      </div>
    );
  }

  if (step === "choosing") {
    return (
      <div className="mt-2 space-y-2 bg-muted/40 rounded-lg p-3">
        <p className="text-xs font-medium">Choose replacement keyword:</p>
        <div className="space-y-1">
          {suggestions.map((s) => (
            <button key={s} onClick={() => setChosen(s)}
              className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-2 ${chosen === s ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted"}`}>
              {chosen === s ? <CheckCircle className="w-3 h-3 flex-shrink-0" /> : <div className="w-3 h-3 rounded-full border border-muted-foreground/40 flex-shrink-0" />}
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => createNew.mutate()} disabled={!chosen || createNew.isPending}>
            {createNew.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Add to rotation
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setStep("idle"); onDone(); }}>
            Skip
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-emerald-600 mt-1">
      <CheckCircle2 className="w-3.5 h-3.5" />
      Keyword replaced — rotation updated
    </div>
  );
}

// ── Rotation queue ────────────────────────────────────────────────────────────
function RotationQueue({ entries, selected }: { entries: Entry[]; selected: Entry | null }) {
  const queue = [...entries]
    .filter((e) => !e.locked)
    .sort((a, b) => {
      if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1;
      return (b.currentRank ?? 0) - (a.currentRank ?? 0);
    })
    .slice(0, 5);

  if (!queue.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4 text-primary" />
          Rotation Queue
          <span className="text-xs font-normal text-muted-foreground ml-1">Next keywords in line</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {queue.map((e, i) => {
          const isCurrent = selected?.kw.id === e.kw.id;
          return (
            <div key={e.kw.id} className={`flex items-center gap-3 px-4 py-2.5 ${i < queue.length - 1 ? "border-b" : ""} ${isCurrent ? "bg-primary/5" : ""}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${isCurrent ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{e.kw.keywordText}</span>
                  {e.atRisk && <Badge variant="destructive" className="text-[9px] h-3.5 px-1">at risk</Badge>}
                  {isCurrent && <Badge className="text-[9px] h-3.5 px-1 bg-primary/15 text-primary border-0">current</Badge>}
                </div>
              </div>
              <RankBadge rank={e.currentRank} />
              <Sparkline history={e.history} atRisk={e.atRisk} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function KeywordRotation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [platform, setPlatform] = useState<Platform>("chatgpt");
  const { dateFrom, dateTo } = useMemo(getDateRange, []);
  const notifiedRef = useRef("");
  const platformMeta = PLATFORMS.find((p) => p.value === platform)!;

  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const r = await rawFetch("/api/clients?status=active&limit=200");
      if (!r.ok) throw new Error("Failed");
      const b = await r.json(); return (b.data ?? b) as { id: number; businessName: string }[];
    },
  });

  const { data: keywords = [], isLoading: kwLoading } = useQuery({
    queryKey: ["kw-rotation", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const r = await rawFetch(`/api/keywords?clientId=${clientId}`);
      if (!r.ok) throw new Error("Failed");
      const b = await r.json(); return (b.data ?? b) as Kw[];
    },
  });

  const { data: rankingReports = [], isLoading: ranksLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["ranking-rotation", clientId, platform, dateFrom, dateTo],
    enabled: !!clientId && keywords.length > 0,
    queryFn: async () => {
      const p = new URLSearchParams({ clientId, platform, status: "success", dateFrom, dateTo, limit: "500" });
      const r = await rankingFetch(`/api/ranking-reports?${p}`);
      if (!r.ok) throw new Error("Failed");
      const b = await r.json(); return (b.data ?? b) as RankReport[];
    },
  });

  const isLoading = kwLoading || ranksLoading;

  // ── Run rotation (auto-lock winners) with dry-run preview ──────────────────
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotatePreview, setRotatePreview] = useState<
    { keywordId: number; keywordText: string; top3Runs: number; windowRuns: number }[] | null
  >(null);

  async function postRotate(dryRun: boolean) {
    const r = await rawFetch("/api/keywords/rotate-winners", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientId ? Number(clientId) : undefined, dryRun }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Rotation request failed");
    return r.json() as Promise<{ scanned: number; locked: typeof rotatePreview & object[] }>;
  }

  const previewRotation = useMutation({
    mutationFn: () => postRotate(true),
    onSuccess: (d: any) => { setRotatePreview(d.locked ?? []); setRotateOpen(true); },
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const confirmRotation = useMutation({
    mutationFn: () => postRotate(false),
    onSuccess: (d: any) => {
      const n = (d.locked ?? []).length;
      toast({
        title: n ? `Locked & rotated ${n} keyword(s)` : "Nothing to rotate",
        description: (d.locked ?? []).map((l: any) => l.keywordText).slice(0, 3).join(", "),
      });
      setRotateOpen(false);
      setRotatePreview(null);
      qc.invalidateQueries({ queryKey: ["kw-rotation", clientId] });
      refetch();
    },
    onError: (e: Error) => toast({ title: "Rotation failed", description: e.message, variant: "destructive" }),
  });

  // ── Compute entries ─────────────────────────────────────────────────────────
  const entries: Entry[] = useMemo(() => {
    return keywords.filter((kw) => kw.isActive && !kw.archivedAt).map((kw) => {
      const reports = rankingReports.filter(
        (r) => (r.keyword ?? r.keywordText ?? "").toLowerCase() === kw.keywordText.toLowerCase() || r.keywordId === kw.id,
      );
      const dayMap = new Map<string, number>();
      reports.forEach((r) => {
        const d = (r.date ?? r.timestamp ?? r.createdAt ?? "").slice(0, 10);
        if (!d || r.rankingPosition === null) return;
        const p = dayMap.get(d); if (p === undefined || r.rankingPosition < p) dayMap.set(d, r.rankingPosition);
      });
      const runDates = Array.from(dayMap.keys()).sort().reverse().slice(0, WINDOW_RUNS).reverse();
      const history  = runDates.map((d) => dayMap.get(d) ?? null);
      const top3Runs = history.filter((v) => v !== null && v <= TOP3_THRESHOLD).length;
      const windowSize = Math.max(runDates.length, 1);
      const currentRank = runDates.length > 0 ? (dayMap.get(runDates[runDates.length - 1]) ?? null) : null;
      const firstRank   = runDates.length > 0 ? (dayMap.get(runDates[0]) ?? null) : null;
      const recent      = history.slice(-STALE_RUNS).filter((v): v is number => v !== null);
      const atRisk      = top3Runs < LOCK_MIN_RUNS && recent.length >= 2 && recent[recent.length - 1] >= recent[0];
      const trend: Entry["trend"] = firstRank === null || currentRank === null ? "none"
        : currentRank < firstRank ? "up" : currentRank > firstRank ? "down" : "flat";
      return { kw, top3Runs, stability: top3Runs / windowSize, currentRank, firstRank, history, runDates, windowSize, locked: top3Runs >= LOCK_MIN_RUNS, atRisk, trend };
    });
  }, [keywords, rankingReports]);

  const locked  = entries.filter((e) => e.locked);
  const atRisk  = entries.filter((e) => e.atRisk && !e.locked);
  const active  = entries.filter((e) => !e.locked);
  const healthy = active.filter((e) => !e.atRisk);

  const selected = useMemo(() => {
    if (!active.length) return null;
    return [...active].sort((a, b) => {
      if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1;
      return (b.currentRank ?? 0) - (a.currentRank ?? 0);
    })[0];
  }, [active]);

  // ── Toast notifications ─────────────────────────────────────────────────────
  useEffect(() => {
    const key = `${clientId}::${platform}`;
    if (isLoading || !entries.length || notifiedRef.current === key) return;
    notifiedRef.current = key;

    if (selected) {
      setTimeout(() => toast({
        title: selected.atRisk ? "⚠️ Auto-rotation triggered" : "🔄 Keyword selected for today",
        description: `"${selected.kw.keywordText}" — rank #${selected.currentRank ?? "?"}${selected.atRisk ? " (stalled — auto-rotated)" : ""}`,
        duration: 6000,
      }), 300);
    }
    atRisk.forEach((e, i) => {
      setTimeout(() => toast({
        title: "⚠️ Keyword not improving",
        description: `"${e.kw.keywordText}" stalled at #${e.currentRank ?? "?"} for ${STALE_RUNS}+ runs`,
        variant: "destructive", duration: 7000,
      }), 900 + i * 600);
    });
    locked.filter((e) => e.top3Runs >= LOCK_MIN_RUNS).forEach((e, i) => {
      setTimeout(() => toast({
        title: "🔒 Keyword locked — variants included",
        description: `"${e.kw.keywordText}" is consistently Top ${TOP3_THRESHOLD}. Variants now active in rotation.`,
        duration: 5000,
      }), 1800 + i * 400);
    });
    if (locked.length === entries.length) {
      setTimeout(() => toast({ title: "✅ All keywords locked", description: "No optimization needed today.", duration: 5000 }), 500);
    }
  }, [isLoading, entries.length, clientId]);

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  const tableRows = [...atRisk, ...locked, ...healthy];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-primary" /> Keyword Rotation Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Top-3 for {LOCK_MIN_RUNS}/{WINDOW_RUNS} runs → locked + variants included · {STALE_RUNS} stale runs → archive &amp; replace · all 3 AI platforms
          </p>
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && <span className="text-xs text-muted-foreground">Updated {updatedAt}</span>}
          {clientId && (
            <Button variant="outline" size="sm" onClick={() => { notifiedRef.current = ""; refetch(); toast({ title: "Refreshing rankings…" }); }} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          )}
          {clientId && (
            <Button size="sm" onClick={() => previewRotation.mutate()} disabled={previewRotation.isPending || isLoading}>
              {previewRotation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Lock className="w-4 h-4 mr-1.5" />}
              Run rotation
            </Button>
          )}
        </div>
      </div>

      {/* Client selector */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-medium whitespace-nowrap">Client</label>
            {clientsLoading ? <Skeleton className="h-9 w-56" /> : (
              <Select value={clientId} onValueChange={(v) => { notifiedRef.current = ""; setClientId(v); }}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Choose a client…" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.businessName}</SelectItem>)}</SelectContent>
              </Select>
            )}

            {/* Platform tabs */}
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1 ml-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => { notifiedRef.current = ""; setPlatform(p.value); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    platform === p.value
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.dot}`} />
                  {p.label}
                </button>
              ))}
            </div>

            {clientId && !isLoading && entries.length > 0 && (
              <div className="flex items-center gap-3 ml-1 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><Lock className="w-3 h-3 text-emerald-500" />{locked.length} locked</span>
                <span className="flex items-center gap-1"><Unlock className="w-3 h-3 text-amber-500" />{healthy.length} active</span>
                {atRisk.length > 0 && <span className="flex items-center gap-1 text-destructive font-medium"><ShieldAlert className="w-3 h-3" />{atRisk.length} at risk</span>}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Empty */}
      {!clientId && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <BarChart3 className="w-12 h-12 opacity-20" />
          <p className="text-base font-medium">Select a client to view keyword rotation</p>
          <p className="text-sm opacity-60">Select a client and platform to view rotation status</p>
        </div>
      )}

      {clientId && isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      )}

      {clientId && !isLoading && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <AlertCircle className="w-10 h-10 opacity-30" />
          <p className="text-base font-medium">No active keywords found</p>
        </div>
      )}

      {clientId && !isLoading && entries.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={<Target className="w-5 h-5 text-muted-foreground" />} label="Total Keywords" value={entries.length} sub="active & tracked" color="bg-muted" />
            <StatCard icon={<Lock className="w-5 h-5 text-emerald-600" />} label="Locked" value={locked.length} sub={`Top-${TOP3_THRESHOLD} for ${LOCK_MIN_RUNS}+ runs`} color="bg-emerald-50 dark:bg-emerald-900/30" />
            <StatCard icon={<Unlock className="w-5 h-5 text-amber-600" />} label="Active" value={healthy.length} sub="in rotation queue" color="bg-amber-50 dark:bg-amber-900/30" />
            <StatCard icon={<ShieldAlert className="w-5 h-5 text-destructive" />} label="At Risk" value={atRisk.length} sub="stalled → auto-archive" color="bg-red-50 dark:bg-red-900/30" />
          </div>

          {/* At-risk alert */}
          {atRisk.length > 0 && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <Bell className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-destructive">
                      {atRisk.length} keyword{atRisk.length > 1 ? "s" : ""} stalled — archive &amp; replace to keep rotation fresh
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                      No rank improvement over {STALE_RUNS} consecutive runs. Use "Archive &amp; Generate Replacement" below to swap them out with AI-suggested keywords.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {atRisk.map((e) => (
                        <div key={e.kw.id} className="flex items-center gap-1.5 bg-background border border-destructive/30 rounded-lg px-2.5 py-1.5 text-xs">
                          <ShieldAlert className="w-3 h-3 text-destructive" />
                          <span className="font-medium">{e.kw.keywordText}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <RankBadge rank={e.currentRank} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Selected keyword */}
          {selected ? (
            <Card className={`shadow-sm ${selected.atRisk ? "border-destructive/50 bg-destructive/5" : "border-primary/40 bg-primary/5"}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center ${selected.atRisk ? "bg-destructive/15" : "bg-primary/15"}`}>
                    <Zap className={`w-4 h-4 ${selected.atRisk ? "text-destructive" : "text-primary"}`} />
                  </div>
                  <CardTitle className="text-base">{selected.atRisk ? "Auto-Rotated — Stalled Keyword" : "Selected for Optimization Today"}</CardTitle>
                  <Badge variant="outline" className={`ml-auto text-xs ${selected.atRisk ? "border-destructive/40 text-destructive" : "border-primary/40 text-primary"}`}>
                    {selected.atRisk ? "At Risk" : "Active"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-6 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-xl font-bold truncate">{selected.kw.keywordText}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {selected.atRisk ? `Stalled for ${STALE_RUNS}+ runs — prioritised for replacement` : "Next in rotation queue"}
                    </p>
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground mb-1.5">Top-3 Stability</p>
                      <StabilityBar v={selected.stability} />
                    </div>
                    <VariantsPanel kwId={selected.kw.id} kwText={selected.kw.keywordText} isTop3={selected.currentRank !== null && selected.currentRank <= TOP3_THRESHOLD} clientId={clientId} />
                  </div>
                  <div className="flex items-center gap-5 flex-shrink-0 flex-wrap">
                    <div className="text-center"><p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Current</p><RankBadge rank={selected.currentRank} /></div>
                    <div className="text-center"><p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Top-3 runs</p><span className="text-sm font-bold">{selected.top3Runs}/{selected.windowSize}</span></div>
                    <div className="text-center"><p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Trend</p><TrendIcon trend={selected.trend} /></div>
                    <div className="text-center"><p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">History</p><Sparkline history={selected.history} atRisk={selected.atRisk} /></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-emerald-400/30 bg-emerald-50/50 dark:bg-emerald-900/10">
              <CardContent className="flex items-center gap-3 py-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm text-emerald-700 dark:text-emerald-400">All keywords locked</p>
                  <p className="text-xs text-muted-foreground">All keywords are in Top {TOP3_THRESHOLD} for ≥{LOCK_MIN_RUNS} runs. Variants auto-included.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rotation queue */}
          <RotationQueue entries={entries} selected={selected} />

          {/* Keyword table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />All Keywords</CardTitle>
              <CardDescription>Last {WINDOW_RUNS} runs on <span className={`font-medium ${platformMeta.color}`}>{platformMeta.label}</span> · at-risk first · variants shown under Top-{TOP3_THRESHOLD} keywords</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex items-center gap-4 px-6 py-2 border-b bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                <div className="w-8 flex-shrink-0" />
                <div className="flex-1">Keyword / Variants</div>
                <div className="w-20 text-center flex-shrink-0">Top-3 runs</div>
                <div className="w-20 text-center flex-shrink-0">Current</div>
                <div className="w-14 text-center flex-shrink-0">Trend</div>
                <div className="w-16 text-center flex-shrink-0">History</div>
                <div className="w-36 flex-shrink-0">Actions</div>
              </div>

              <div className="divide-y">
                {tableRows.map((e) => {
                  const isSelected = selected?.kw.id === e.kw.id;
                  const isTop3     = e.currentRank !== null && e.currentRank <= TOP3_THRESHOLD;
                  const rowBg      = e.atRisk ? "bg-destructive/5 hover:bg-destructive/8" : e.locked ? "bg-emerald-50/40 dark:bg-emerald-900/10" : isSelected ? "bg-primary/5" : "hover:bg-muted/20";

                  return (
                    <div key={e.kw.id} className={`px-6 py-3.5 transition-colors ${rowBg}`}>
                      <div className="flex items-center gap-4">
                        {/* Icon */}
                        <div className="w-8 flex-shrink-0">
                          {e.atRisk ? (
                            <Tooltip><TooltipTrigger><div className="w-8 h-8 rounded-full bg-destructive/15 flex items-center justify-center"><ShieldAlert className="w-4 h-4 text-destructive" /></div></TooltipTrigger><TooltipContent>At risk — no improvement in {STALE_RUNS}+ runs</TooltipContent></Tooltip>
                          ) : e.locked ? (
                            <Tooltip><TooltipTrigger><div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center"><Lock className="w-4 h-4 text-emerald-600" /></div></TooltipTrigger><TooltipContent>Locked — variants auto-included in rotation</TooltipContent></Tooltip>
                          ) : isSelected ? (
                            <Tooltip><TooltipTrigger><div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center"><Zap className="w-4 h-4 text-primary" /></div></TooltipTrigger><TooltipContent>Today's optimization target</TooltipContent></Tooltip>
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center"><Unlock className="w-4 h-4 text-amber-600" /></div>
                          )}
                        </div>

                        {/* Keyword + stability + variants */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm truncate">{e.kw.keywordText}</span>
                            {(e.kw.isPrimary === true || e.kw.isPrimary === 1) && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                            {e.atRisk  && <Badge variant="destructive" className="text-[9px] h-3.5 px-1">at risk</Badge>}
                            {e.locked  && <Badge className="text-[9px] h-3.5 px-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0">locked</Badge>}
                            {isSelected && !e.atRisk && <Badge className="text-[9px] h-3.5 px-1 bg-primary/15 text-primary border-0">selected</Badge>}
                            {isTop3 && e.locked && <Badge className="text-[9px] h-3.5 px-1 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-0">variants active</Badge>}
                          </div>
                          <StabilityBar v={e.stability} />
                          {/* Variants panel — show for locked + top3 keywords */}
                          {(e.locked || isTop3) && (
                            <VariantsPanel kwId={e.kw.id} kwText={e.kw.keywordText} isTop3={isTop3} clientId={clientId} />
                          )}
                        </div>

                        {/* Top-3 runs */}
                        <div className="w-20 text-center flex-shrink-0">
                          <p className="text-sm font-bold">
                            <span className={e.locked ? "text-emerald-600" : e.top3Runs >= 3 ? "text-amber-600" : "text-destructive"}>{e.top3Runs}</span>
                            <span className="text-muted-foreground font-normal text-xs">/{e.windowSize}</span>
                          </p>
                        </div>

                        {/* Current rank */}
                        <div className="w-20 text-center flex-shrink-0"><RankBadge rank={e.currentRank} /></div>

                        {/* Trend */}
                        <div className="w-14 flex-shrink-0 flex justify-center"><TrendIcon trend={e.trend} /></div>

                        {/* Sparkline */}
                        <div className="w-16 flex-shrink-0 flex justify-center"><Sparkline history={e.history} atRisk={e.atRisk} /></div>

                        {/* Actions */}
                        <div className="w-36 flex-shrink-0">
                          {e.atRisk && (
                            <ArchivePanel entry={e} clientId={clientId} onDone={() => {
                              notifiedRef.current = "";
                              qc.invalidateQueries({ queryKey: ["kw-rotation", clientId] });
                              qc.invalidateQueries({ queryKey: ["ranking-rotation", clientId] });
                            }} />
                          )}
                          {e.locked && (
                            <div className="text-xs text-emerald-600 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Performing well
                            </div>
                          )}
                          {!e.atRisk && !e.locked && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Activity className="w-3.5 h-3.5" /> In rotation
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex items-center flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground px-1">
            <div className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-emerald-500" />Locked → variants auto-included in rotation</div>
            <div className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-destructive" />At risk → archive &amp; replace with AI keyword</div>
            <div className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" />Variants expand reach for Top-{TOP3_THRESHOLD} keywords</div>
          </div>
        </>
      )}

      {/* Run-rotation dry-run preview */}
      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="w-5 h-5 text-primary" /> Run rotation — preview</DialogTitle>
            <DialogDescription>
              {rotatePreview && rotatePreview.length > 0
                ? `${rotatePreview.length} keyword(s) have held Top-${TOP3_THRESHOLD} for ≥${LOCK_MIN_RUNS}/${WINDOW_RUNS} runs. Confirming archives them (they stop getting ranking sessions) and creates an AI-generated replacement for each.`
                : "No keywords currently qualify for rotation (none sustained Top-3 long enough)."}
            </DialogDescription>
          </DialogHeader>

          {rotatePreview && rotatePreview.length > 0 && (
            <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
              {rotatePreview.map((l) => (
                <div key={l.keywordId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="font-medium truncate">{l.keywordText}</span>
                  <Badge variant="outline" className="shrink-0">Top-{TOP3_THRESHOLD} in {l.top3Runs}/{l.windowRuns}</Badge>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateOpen(false)} disabled={confirmRotation.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rotatePreview?.length || confirmRotation.isPending}
              onClick={() => confirmRotation.mutate()}
            >
              {confirmRotation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Lock className="w-4 h-4 mr-1.5" />}
              Confirm — lock &amp; rotate {rotatePreview?.length ?? 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
