import { useState } from "react";
import { useGetKeywords, useUpdateKeyword, useGetClients } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Search, Plus, Key, Loader2, Star, Filter, X, Link2, MapPin,
  Building2, ExternalLink, Pencil, Trash2, Calendar, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const LINK_TYPES = ["GBP snippet", "Client website blog post", "External article", "Other"];

/* ─────────────────────────────────────────────────────────── */
/* Keyword add / edit dialog (full fields)                     */
/* ─────────────────────────────────────────────────────────── */
function KeywordDialog({
  open, onOpenChange, title, saving, initial, clients, onSave,
}: {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  title:        string;
  saving:       boolean;
  initial?:     Record<string, unknown>;
  clients?:     { id: number; businessName: string; city?: string | null; state?: string | null }[];
  onSave:       (data: Record<string, unknown>) => void;
}) {
  const blank: Record<string, unknown> = {
    clientId:                  "",
    keywordText:               "",
    keywordType:               "1",
    isPrimary:                 "0",
    isActive:                  true,
    linkTypeLabel:             "",
    linkActive:                true,
    initialRankReportLink:     "",
    currentRankReportLink:     "",
    initialSearchCount30Days:  0,
    followupSearchCount30Days: 0,
    initialSearchCountLife:    0,
    followupSearchCountLife:   0,
  };

  const [vals, setVals] = useState<Record<string, unknown>>(initial ?? blank);
  function set(k: string, v: unknown) { setVals((p) => ({ ...p, [k]: v })); }

  const isEdit = !!initial;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setVals(initial ?? blank); }}>
      <DialogContent className="sm:max-w-[640px] border-border/60 bg-card max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Key className="w-4 h-4 text-primary" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Business / Keyword */}
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground/60 tracking-wide">Business <span className="text-destructive">*</span></Label>
                <Select value={vals.clientId as string} onValueChange={(v) => set("clientId", v)}>
                  <SelectTrigger className="bg-muted/30 border-border/60 h-9 text-sm"><SelectValue placeholder="Select business…" /></SelectTrigger>
                  <SelectContent>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        <span className="font-medium">{c.businessName}</span>
                        {c.city && <span className="text-muted-foreground ml-2 text-xs">{c.city}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={`space-y-1.5 ${!isEdit ? "" : "col-span-2"}`}>
              <Label className="text-xs uppercase text-muted-foreground/60 tracking-wide">Keyword <span className="text-destructive">*</span></Label>
              <Input className="bg-muted/30 border-border/60 h-9 text-sm"
                placeholder="e.g. best plumber in Manchester"
                value={vals.keywordText as string}
                onChange={(e) => set("keywordText", e.target.value)} />
            </div>
          </div>

          {/* Keyword type selector */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase text-muted-foreground/60 tracking-wide">Keyword Type <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "1", label: "Type 1 — Geo Specific",  desc: "60% budget · 100% search rate",  icon: MapPin, accent: "border-primary/50 bg-primary/10 text-primary" },
                { value: "2", label: "Type 2 — Backlink",       desc: "10% budget · 1st keyword only",  icon: Link2,  accent: "border-amber-400/50 bg-amber-500/10 text-amber-400" },
              ].map((opt) => {
                const Icon     = opt.icon;
                const selected = String(vals.keywordType) === opt.value;
                return (
                  <button key={opt.value} type="button" onClick={() => set("keywordType", opt.value)}
                    className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-all ${
                      selected ? opt.accent : "border-border/50 bg-muted/20 text-muted-foreground hover:border-border/80"
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">{opt.label}</span>
                    </div>
                    <span className="text-[10px] opacity-70">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary + Active */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg p-3">
              <div className="flex-1">
                <p className="text-xs font-medium">Primary (1st)</p>
                <p className="text-[10px] text-muted-foreground">Mark as primary keyword</p>
              </div>
              <Switch
                checked={vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true}
                onCheckedChange={(v) => set("isPrimary", v ? "1" : "0")}
                className="data-[state=checked]:bg-primary" />
            </div>
            <div className="flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg p-3">
              <div className="flex-1">
                <p className="text-xs font-medium">Active</p>
                <p className="text-[10px] text-muted-foreground">Enable for campaigns</p>
              </div>
              <Switch
                checked={vals.isActive !== false}
                onCheckedChange={(v) => set("isActive", v)}
                className="data-[state=checked]:bg-emerald-500" />
            </div>
          </div>

          {/* Search counts */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 mb-2">Search Counts</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { k: "initialSearchCount30Days",  label: "Initial · 30 days" },
                { k: "followupSearchCount30Days", label: "Follow-up · 30 days" },
                { k: "initialSearchCountLife",    label: "Initial · Lifetime" },
                { k: "followupSearchCountLife",   label: "Follow-up · Lifetime" },
              ].map(({ k, label }) => (
                <div key={k} className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60">{label}</Label>
                  <Input type="number" min={0}
                    className="bg-muted/30 border-border/60 h-9 text-sm font-mono"
                    value={vals[k] as number}
                    onChange={(e) => set(k, parseInt(e.target.value) || 0)} />
                </div>
              ))}
            </div>
          </div>

          {/* Associated links */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 mb-2">Associated Links</p>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 items-end">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60">Link Type Label</Label>
                  <Select value={(vals.linkTypeLabel as string) || ""} onValueChange={(v) => set("linkTypeLabel", v)}>
                    <SelectTrigger className="bg-muted/30 border-border/60 h-9 text-sm"><SelectValue placeholder="Select type…" /></SelectTrigger>
                    <SelectContent>
                      {LINK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg px-3 h-9">
                  <p className="text-xs flex-1">Link Active</p>
                  <Switch
                    checked={vals.linkActive !== false}
                    onCheckedChange={(v) => set("linkActive", v)}
                    className="data-[state=checked]:bg-emerald-500 scale-75" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60 flex items-center gap-1"><Link2 className="w-3 h-3" /> Initial Rank Report</Label>
                  <Input className="bg-muted/30 border-border/60 h-9 text-xs font-mono"
                    placeholder="https://…"
                    value={(vals.initialRankReportLink as string) || ""}
                    onChange={(e) => set("initialRankReportLink", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60 flex items-center gap-1"><Link2 className="w-3 h-3" /> Current Rank Report</Label>
                  <Input className="bg-muted/30 border-border/60 h-9 text-xs font-mono"
                    placeholder="https://…"
                    value={(vals.currentRankReportLink as string) || ""}
                    onChange={(e) => set("currentRankReportLink", e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <Button variant="outline" className="flex-1 border-border/50"
            onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="flex-1 gap-2" disabled={saving || !(vals.keywordText as string)?.trim() || (!isEdit && !vals.clientId)}
            onClick={() => onSave({
              ...vals,
              keywordType:               Number(vals.keywordType),
              isPrimary:                 vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true ? 1 : 0,
              initialSearchCount30Days:  Number(vals.initialSearchCount30Days)  || 0,
              followupSearchCount30Days: Number(vals.followupSearchCount30Days) || 0,
              initialSearchCountLife:    Number(vals.initialSearchCountLife)    || 0,
              followupSearchCountLife:   Number(vals.followupSearchCountLife)   || 0,
            })}
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : isEdit ? "Save Changes" : "Add Keyword"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Main page                                                    */
/* ─────────────────────────────────────────────────────────── */
export default function Keywords() {
  const [search,     setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  /* All businesses start COLLAPSED — user clicks to expand */
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set());
  const [addOpen,    setAddOpen]    = useState(false);
  const [editKw,     setEditKw]     = useState<null | Record<string, unknown>>(null);
  const [saving,     setSaving]     = useState(false);

  const { data: keywords, isLoading } = useGetKeywords();
  const { data: clients }             = useGetClients();
  const updateKeyword                 = useUpdateKeyword();
  const { toast }                     = useToast();
  const queryClient                   = useQueryClient();

  /* ── Save (add / edit) ── */
  async function saveKeyword(id: number | null, data: Record<string, unknown>) {
    setSaving(true);
    try {
      if (id) {
        await new Promise<void>((res, rej) =>
          updateKeyword.mutate({ id, data }, { onSuccess: () => res(), onError: (e) => rej(e) }),
        );
      } else {
        const r = await fetch(`${BASE}/api/keywords`, {
          method:      "POST",
          credentials: "include",
          headers:     { "Content-Type": "application/json" },
          body:        JSON.stringify({ ...data, clientId: Number(data.clientId), tierLabel: "aeo" }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: id ? "Keyword updated" : "Keyword added" });
      setEditKw(null);
      setAddOpen(false);
    } catch (err: unknown) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteKeyword(id: number) {
    try {
      await fetch(`${BASE}/api/keywords/${id}`, { method: "DELETE", credentials: "include" });
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: "Keyword deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  function toggleExpand(clientId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(clientId) ? next.delete(clientId) : next.add(clientId);
      return next;
    });
  }

  /* ── Filter ── */
  const searchLower = search.toLowerCase();
  const filteredKws = (keywords ?? []).filter((k) => {
    const matchText   = k.keywordText.toLowerCase().includes(searchLower);
    const matchType   = typeFilter === "all" || String(k.keywordType) === typeFilter;
    const client      = clients?.find((c) => c.id === k.clientId);
    const matchClient = client ? client.businessName.toLowerCase().includes(searchLower) : true;
    return (matchText || matchClient) && matchType;
  });

  /* ── Group by client ── */
  const grouped = new Map<number, typeof filteredKws>();
  for (const kw of filteredKws) {
    if (!grouped.has(kw.clientId)) grouped.set(kw.clientId, []);
    grouped.get(kw.clientId)!.push(kw);
  }

  /* ── Stats ── */
  const totalKws   = keywords?.length ?? 0;
  const activeKws  = keywords?.filter((k) => k.isActive).length ?? 0;
  const type1Count = keywords?.filter((k) => k.keywordType === 1).length ?? 0;
  const type2Count = keywords?.filter((k) => k.keywordType === 2).length ?? 0;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">AEO Keywords</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Keywords organised per business — click a row to view details</p>
        </div>
        <Button
          className="gap-2 shadow-sm"
          style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.3)" }}
          onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" /> Add Keyword
        </Button>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Keywords", value: totalKws,   color: "text-foreground"  },
          { label: "Active",          value: activeKws,  color: "text-emerald-400" },
          { label: "Type 1 (Geo)",   value: type1Count, color: "text-primary"     },
          { label: "Type 2 (Link)",  value: type2Count, color: "text-amber-400"   },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input type="search" placeholder="Search business or keyword…"
            className="pl-9 bg-card/60 border-border/50 h-9"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {[{ id: "all", label: "All" }, { id: "1", label: "Type 1 – Geo" }, { id: "2", label: "Type 2 – Backlink" }].map((t) => (
            <button key={t.id} onClick={() => setTypeFilter(t.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                typeFilter === t.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground bg-transparent"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        {(search || typeFilter !== "all") && (
          <button onClick={() => { setSearch(""); setTypeFilter("all"); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── Business list ── */}
      {isLoading ? (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 border-b border-border/30 last:border-0">
              <Skeleton className="h-9 w-9 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-7 w-28 rounded-lg" />
            </div>
          ))}
        </div>
      ) : grouped.size === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 rounded-xl border border-dashed border-border/40 bg-card/30 text-muted-foreground gap-3">
          <Key className="w-10 h-10 opacity-15" />
          <p className="text-sm">No keywords found</p>
          <Button size="sm" className="gap-1.5 mt-1"
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))" }}
            onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add first keyword
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          {Array.from(grouped.entries()).map(([clientId, kws], idx, arr) => {
            const client   = clients?.find((c) => c.id === clientId);
            const isOpen   = expanded.has(clientId);
            const initials = client?.businessName
              ? client.businessName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()
              : "?";
            const activeCount = kws.filter((k) => k.isActive).length;
            const type1 = kws.filter((k) => k.keywordType === 1).length;
            const type2 = kws.filter((k) => k.keywordType === 2).length;
            const isLast = idx === arr.length - 1;

            return (
              <div key={clientId} className={!isLast || isOpen ? "border-b border-border/40" : ""}>

                {/* ═══ Business row (always visible) ═══ */}
                <div className="flex items-center gap-0 bg-card/40 hover:bg-card/60 transition-colors">

                  {/* LEFT: View keywords action */}
                  <button
                    onClick={() => toggleExpand(clientId)}
                    className={`flex items-center gap-2 px-4 py-4 border-r border-border/40 h-full min-w-[170px] flex-shrink-0 transition-colors ${
                      isOpen
                        ? "bg-primary/10 text-primary border-primary/20"
                        : "text-muted-foreground hover:text-primary hover:bg-primary/5"
                    }`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 ${
                      isOpen ? "bg-primary/20" : "bg-muted/40"
                    }`}>
                      {isOpen
                        ? <ChevronUp   className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5" />}
                    </div>
                    <div className="text-left">
                      <p className={`text-xs font-semibold leading-none ${isOpen ? "text-primary" : ""}`}>
                        {isOpen ? "Hide keywords" : "View keywords"}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{kws.length} total</p>
                    </div>
                  </button>

                  {/* MIDDLE: Business info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0 px-4 py-4">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground leading-tight">
                        {client?.businessName ?? `Business #${clientId}`}
                      </p>
                      {client?.city && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{client.city}{client.state ? `, ${client.state}` : ""}</p>
                      )}
                    </div>
                  </div>

                  {/* RIGHT: Keyword breakdown + link to client */}
                  <div className="flex items-center gap-3 px-4 py-4 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 h-5">
                        {activeCount} active
                      </Badge>
                      {type1 > 0 && (
                        <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/20 h-5">
                          {type1} T1
                        </Badge>
                      )}
                      {type2 > 0 && (
                        <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20 h-5">
                          {type2} T2
                        </Badge>
                      )}
                    </div>
                    <Link href={`/clients/${clientId}`}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors border border-border/40 hover:border-primary/30 rounded-lg px-2.5 py-1.5 bg-muted/20 hover:bg-primary/5">
                      <Building2 className="w-3 h-3" /> Client
                    </Link>
                  </div>
                </div>

                {/* ═══ Expanded keyword cards ═══ */}
                {isOpen && (
                  <div className="divide-y divide-border/25 bg-muted/5 border-t border-border/30">
                    {kws.map((kw) => {
                      const kwr        = kw as Record<string, unknown>;
                      const isType2    = kw.keywordType === 2;
                      const isPrimary  = !!kw.isPrimary;
                      const linkUrl    = kwr.initialRankReportLink as string;
                      const curLinkUrl = kwr.currentRankReportLink as string;

                      return (
                        <div key={kw.id}>
                          {/* Keyword header */}
                          <div className="flex items-start gap-3 pl-[170px] pr-4 py-3 border-b border-border/15">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isPrimary && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
                                <span className="font-semibold text-sm text-foreground">{kw.keywordText}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <Badge variant="outline" className={isType2
                                  ? "text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20"
                                  : "text-[10px] bg-primary/10 text-primary border-primary/20"}>
                                  {isType2 ? "Type 2 — Backlink" : "Type 1 — Geo Specific"}
                                </Badge>
                                {isPrimary && <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">1st</Badge>}
                                {(kwr.dateAdded as string) && (
                                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {format(new Date(kwr.dateAdded as string), "MMM d, yyyy")}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{kw.isActive ? "Active" : "Inactive"}</span>
                                <Switch
                                  checked={kw.isActive}
                                  onCheckedChange={(v) => updateKeyword.mutate(
                                    { id: kw.id, data: { isActive: v } },
                                    { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/keywords"] }) },
                                  )}
                                  className="data-[state=checked]:bg-emerald-500" />
                              </div>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                                  onClick={() => setEditKw({ ...kwr, id: kw.id })}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive text-muted-foreground/40"
                                  onClick={() => deleteKeyword(kw.id)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>

                          {/* Keyword detail: search counts + links */}
                          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/15 pl-[170px]">
                            {/* Search counts */}
                            <div className="px-4 py-3 space-y-2">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Search Counts</p>
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  { label: "Initial · 30 days",    value: (kwr.initialSearchCount30Days  as number) ?? 0 },
                                  { label: "Follow-up · 30 days",  value: (kwr.followupSearchCount30Days as number) ?? 0 },
                                  { label: "Initial · Lifetime",   value: (kwr.initialSearchCountLife    as number) ?? 0 },
                                  { label: "Follow-up · Lifetime", value: (kwr.followupSearchCountLife   as number) ?? 0 },
                                ].map(({ label, value }) => (
                                  <div key={label} className="rounded-lg bg-muted/20 border border-border/25 px-2.5 py-2">
                                    <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wide leading-none mb-1">{label}</p>
                                    <p className="text-base font-bold font-mono text-foreground">{value}</p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Associated links */}
                            <div className="px-4 py-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Associated Links</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-muted-foreground">
                                    {(kwr.linkActive as boolean) !== false ? "Active" : "Inactive"}
                                  </span>
                                  <Switch
                                    checked={(kwr.linkActive as boolean) !== false}
                                    onCheckedChange={(v) => updateKeyword.mutate(
                                      { id: kw.id, data: { linkActive: v } },
                                      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/keywords"] }) },
                                    )}
                                    className="data-[state=checked]:bg-emerald-500 scale-75" />
                                </div>
                              </div>
                              {(kwr.linkTypeLabel as string) ? (
                                <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/20">
                                  {kwr.linkTypeLabel as string}
                                </Badge>
                              ) : (
                                <p className="text-[11px] text-muted-foreground/30 italic">No link type set</p>
                              )}
                              <div className="space-y-1.5">
                                {[
                                  { label: "Initial Rank Report",  url: linkUrl },
                                  { label: "Current Rank Report",  url: curLinkUrl },
                                ].map(({ label, url }) => (
                                  <div key={label} className="rounded-lg bg-muted/20 border border-border/25 px-3 py-2">
                                    <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">{label}</p>
                                    {url ? (
                                      <a href={url} target="_blank" rel="noopener noreferrer"
                                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                                        <Link2 className="w-3 h-3 flex-shrink-0" />
                                        <span className="truncate max-w-[240px]">{url}</span>
                                        <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                                      </a>
                                    ) : (
                                      <p className="text-[11px] text-muted-foreground/30 mt-0.5">Not set</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add keyword shortcut */}
                    <div className="pl-[170px] pr-4 py-2.5 bg-muted/5">
                      <button
                        onClick={() => setAddOpen(true)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-primary transition-colors border border-dashed border-border/30 hover:border-primary/30 rounded-lg px-3 py-1.5">
                        <Plus className="w-3 h-3" /> Add keyword for {client?.businessName ?? "this client"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Keyword Dialog ── */}
      <KeywordDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add AEO Keyword"
        saving={saving}
        clients={clients}
        onSave={(data) => saveKeyword(null, data)}
      />

      {/* ── Edit Keyword Dialog ── */}
      {editKw && (
        <KeywordDialog
          open
          onOpenChange={(o) => { if (!o) setEditKw(null); }}
          title="Edit Keyword"
          saving={saving}
          initial={editKw}
          clients={clients}
          onSave={(data) => saveKeyword(editKw.id as number, data)}
        />
      )}
    </div>
  );
}
