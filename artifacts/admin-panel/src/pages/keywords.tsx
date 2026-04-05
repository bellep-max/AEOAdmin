import React, { useState, useEffect, useCallback } from "react";
import {
  useGetKeywords, useUpdateKeyword, useGetClients,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Badge }    from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch }   from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast }  from "@/hooks/use-toast";
import { Link }      from "wouter";
import {
  Search, Plus, Key, Loader2, Star, Filter, X,
  Building2, ExternalLink, Pencil, Trash2, Calendar,
  Download, ChevronDown, FileDown, Link2, MapPin, FileText,
} from "lucide-react";
import { format } from "date-fns";
import jsPDF       from "jspdf";
import autoTable   from "jspdf-autotable";

const BASE       = import.meta.env.BASE_URL.replace(/\/$/, "");
const LINK_TYPES = ["GBP snippet", "Client website blog post", "External article"];

type KwRecord = Record<string, unknown>;

interface KeywordLink {
  id: number; keywordId: number;
  linkTypeLabel: string | null;
  linkActive: boolean;
  initialRankReportLink: string | null;
  currentRankReportLink: string | null;
  createdAt: string;
}

/* ═══════════════════════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════════════════════ */
function exportCSV(rows: KwRecord[], clientsMap: Map<number, string>, filename: string) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = [
    "Business", "Keyword", "Keyword Type", "Primary (1st)", "Active", "Date Added",
    "Initial Search (30d)", "Follow-up Search (30d)",
    "Initial Search (Life)", "Follow-up Search (Life)",
    "Link Type", "Link Active", "Initial Rank Report", "Current Rank Report",
  ];
  const lines = rows.map((kw) => {
    const type = kw.keywordType === 2 ? "Type 2 – Backlink" : "Type 1 – Geo Specific";
    const date = kw.dateAdded ? format(new Date(kw.dateAdded as string), "yyyy-MM-dd") : "";
    return [
      esc(clientsMap.get(kw.clientId as number) ?? ""),
      esc(kw.keywordText), esc(type),
      esc(kw.isPrimary ? "Yes" : "No"),
      esc(kw.isActive  ? "Active" : "Inactive"),
      esc(date),
      kw.initialSearchCount30Days  ?? 0,
      kw.followupSearchCount30Days ?? 0,
      kw.initialSearchCountLife    ?? 0,
      kw.followupSearchCountLife   ?? 0,
      esc(kw.linkTypeLabel ?? ""),
      esc((kw.linkActive as boolean) !== false ? "Active" : "Inactive"),
      esc(kw.initialRankReportLink ?? ""),
      esc(kw.currentRankReportLink ?? ""),
    ].join(",");
  });
  const csv  = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════
   PDF EXPORT
═══════════════════════════════════════════════════════════ */
function exportPDF(rows: KwRecord[], clientsMap: Map<number, string>, filename: string, title: string) {
  const doc   = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text("Signal AEO — Keyword Report", 10, 11);
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
  doc.text(title, 10, 18);
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}`, pageW - 10, 18, { align: "right" });

  const grouped = new Map<string, KwRecord[]>();
  for (const kw of rows) {
    const biz = clientsMap.get(kw.clientId as number) ?? `Business #${kw.clientId}`;
    if (!grouped.has(biz)) grouped.set(biz, []);
    grouped.get(biz)!.push(kw);
  }

  let startY = 30;
  const footerFn = (data: { pageNumber: number }) => {
    const pages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    doc.setFontSize(6.5); doc.setTextColor(150);
    doc.text(`Signal AEO Admin Panel  ·  Confidential  ·  Page ${data.pageNumber} of ${pages}`, pageW / 2, pageH - 5, { align: "center" });
  };

  grouped.forEach((kws, bizName) => {
    if (startY > pageH - 40) { doc.addPage(); startY = 15; }
    doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 100, 220);
    doc.text(bizName, 10, startY);
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(120, 130, 150);
    doc.text(`${kws.length} keyword${kws.length !== 1 ? "s" : ""}`, 10, startY + 4);
    startY += 9;

    const bodyRows = kws.map((kw) => {
      const type = kw.keywordType === 2 ? "T2 – Backlink" : "T1 – Geo Specific";
      const date = kw.dateAdded ? format(new Date(kw.dateAdded as string), "MMM d, yyyy") : "—";
      return [
        kw.keywordText as string, type,
        kw.isPrimary ? "Yes" : "No",
        kw.isActive  ? "Active" : "Inactive",
        date,
        String(kw.initialSearchCount30Days  ?? 0),
        String(kw.followupSearchCount30Days ?? 0),
        String(kw.initialSearchCountLife    ?? 0),
        String(kw.followupSearchCountLife   ?? 0),
        (kw.linkTypeLabel as string) || "—",
        (kw.linkActive as boolean) !== false ? "Active" : "Inactive",
        (kw.initialRankReportLink as string) || "—",
        (kw.currentRankReportLink as string) || "—",
      ];
    });

    autoTable(doc, {
      startY,
      head: [["Keyword","Type","1st","Active","Date","Init 30d","F/U 30d","Init Life","F/U Life","Link Type","Link Active","Init Report","Curr Report"]],
      body: bodyRows,
      theme: "striped",
      headStyles: { fillColor: [17, 24, 39], textColor: [180, 200, 230], fontSize: 7, fontStyle: "bold", cellPadding: 2.5 },
      bodyStyles: { fontSize: 7, cellPadding: 2, textColor: [30, 30, 50] },
      alternateRowStyles: { fillColor: [245, 247, 252] },
      columnStyles: {
        0: { cellWidth: 38 }, 1: { cellWidth: 24 }, 2: { cellWidth: 9, halign: "center" },
        3: { cellWidth: 13, halign: "center" }, 4: { cellWidth: 20, halign: "center" },
        5: { cellWidth: 12, halign: "right" }, 6: { cellWidth: 12, halign: "right" },
        7: { cellWidth: 12, halign: "right" }, 8: { cellWidth: 12, halign: "right" },
        9: { cellWidth: 28 }, 10: { cellWidth: 14, halign: "center" },
        11: { cellWidth: 30, overflow: "linebreak" }, 12: { cellWidth: 30, overflow: "linebreak" },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: footerFn,
    });

    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  });

  doc.save(filename);
}

/* ═══════════════════════════════════════════════════════════
   LINK DIALOG — add / edit a single link
═══════════════════════════════════════════════════════════ */
function LinkDialog({
  open, onOpenChange, saving, initial, onSave,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  saving: boolean; initial?: Partial<KeywordLink>;
  onSave: (data: Partial<KeywordLink>) => void;
}) {
  const blank = { linkTypeLabel: "", linkActive: true, initialRankReportLink: "", currentRankReportLink: "" };
  const [vals, setVals] = useState<Partial<KeywordLink>>(blank);
  function set(k: keyof KeywordLink, v: unknown) { setVals((p) => ({ ...p, [k]: v })); }

  useEffect(() => { if (open) setVals(initial ?? blank); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] border-border/60 bg-card">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center">
              <Link2 className="w-4 h-4 text-violet-400" />
            </div>
            <DialogTitle>{initial?.id ? "Edit Link" : "Add Associated Link"}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">Associated link form</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Link Type Label</Label>
              <Select value={(vals.linkTypeLabel as string) || ""} onValueChange={(v) => set("linkTypeLabel", v)}>
                <SelectTrigger className="bg-muted/30 border-border/60 h-9 text-sm">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {LINK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 bg-muted/20 border border-border/40 rounded-lg px-3 h-9">
              <p className="text-xs flex-1 text-muted-foreground">Active</p>
              <Switch
                checked={vals.linkActive !== false}
                onCheckedChange={(v) => set("linkActive", v)}
                className="data-[state=checked]:bg-emerald-500 scale-75"
              />
            </div>
          </div>

          {[
            { k: "initialRankReportLink" as keyof KeywordLink, label: "Initial Rank Report Link" },
            { k: "currentRankReportLink" as keyof KeywordLink, label: "Current Rank Report Link" },
          ].map(({ k, label }) => (
            <div key={k} className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/60">{label}</Label>
              <Input
                className="bg-muted/30 border-border/60 h-9 text-xs font-mono"
                placeholder="https://…"
                value={(vals[k] as string) || ""}
                onChange={(e) => set(k, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-3">
          <Button variant="outline" className="flex-1 border-border/50" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="flex-1 gap-2" disabled={saving} onClick={() => onSave(vals)}
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))" }}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : (initial?.id ? "Save Changes" : "Add Link")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════
   KEYWORD DIALOG — add / edit keyword
═══════════════════════════════════════════════════════════ */
function KeywordDialog({
  open, onOpenChange, title, saving, initial, clients, onSave,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  title: string; saving: boolean;
  initial?: KwRecord;
  clients?: { id: number; businessName: string; city?: string | null }[];
  onSave: (data: KwRecord) => void;
}) {
  const blank: KwRecord = {
    clientId: "", keywordText: "", keywordType: "1", isPrimary: "0", isActive: true,
    initialSearchCount30Days: 0, followupSearchCount30Days: 0,
    initialSearchCountLife: 0,  followupSearchCountLife: 0,
  };
  const [vals, setVals] = useState<KwRecord>(blank);
  function set(k: string, v: unknown) { setVals((p) => ({ ...p, [k]: v })); }
  const isEdit = !!initial;

  useEffect(() => { if (open) setVals(initial ?? blank); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-full max-h-screen rounded-none border-0 bg-[hsl(222,47%,9%)] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 border-b border-border/40 bg-[hsl(222,47%,8%)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Fill in all fields, then save</p>
            </div>
          </div>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl w-full mx-auto space-y-5">
          {/* Business + Keyword */}
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Business <span className="text-destructive">*</span></Label>
                <Select value={vals.clientId as string} onValueChange={(v) => set("clientId", v)}>
                  <SelectTrigger className="bg-muted/30 border-border/60 h-9 text-sm"><SelectValue placeholder="Select business…" /></SelectTrigger>
                  <SelectContent>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        <span className="font-medium">{c.businessName}</span>
                        {c.city && <span className="ml-2 text-muted-foreground text-xs">{c.city}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={!isEdit ? "" : "col-span-2"}>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Keyword <span className="text-destructive">*</span></Label>
              <Input className="bg-muted/30 border-border/60 h-9 text-sm mt-1.5"
                placeholder="e.g. best plumber in Manchester"
                value={vals.keywordText as string}
                onChange={(e) => set("keywordText", e.target.value)} />
            </div>
          </div>

          {/* Keyword type */}
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-2 block">Keyword Type <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "1", label: "Type 1 — Geo Specific",  desc: "60% budget · 100% search rate",  icon: MapPin, sel: "border-primary/50 bg-primary/10 text-primary" },
                { value: "2", label: "Type 2 — Backlink",       desc: "10% budget · 1st keyword only",  icon: Link2,  sel: "border-amber-400/50 bg-amber-500/10 text-amber-400" },
              ].map((opt) => {
                const Icon  = opt.icon;
                const isSelected = String(vals.keywordType) === opt.value;
                return (
                  <button key={opt.value} type="button" onClick={() => set("keywordType", opt.value)}
                    className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-all ${isSelected ? opt.sel : "border-border/50 bg-muted/20 text-muted-foreground hover:border-border/80"}`}>
                    <div className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /><span className="text-xs font-semibold">{opt.label}</span></div>
                    <span className="text-[10px] opacity-70">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary + Active */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: "isPrimary", label: "Primary (1st)", sub: "Mark as primary keyword",
                checked: vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true,
                onChange: (v: boolean) => set("isPrimary", v ? "1" : "0"), cls: "data-[state=checked]:bg-amber-500" },
              { k: "isActive", label: "Active", sub: "Include in campaigns",
                checked: vals.isActive !== false,
                onChange: (v: boolean) => set("isActive", v), cls: "data-[state=checked]:bg-emerald-500" },
            ].map((row) => (
              <div key={row.k} className="flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg p-3">
                <div className="flex-1"><p className="text-xs font-medium">{row.label}</p><p className="text-[10px] text-muted-foreground">{row.sub}</p></div>
                <Switch checked={row.checked} onCheckedChange={row.onChange} className={row.cls} />
              </div>
            ))}
          </div>

          {/* Search counts */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-2">Search Counts</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                { k: "initialSearchCount30Days",  label: "Initial Search Count",      sub: "30 days" },
                { k: "followupSearchCount30Days", label: "Follow-up Search Count",    sub: "30 days" },
                { k: "initialSearchCountLife",    label: "Initial Search Count",      sub: "Lifetime" },
                { k: "followupSearchCountLife",   label: "Follow-up Search Count",    sub: "Lifetime" },
              ].map(({ k, label, sub }) => (
                <div key={k} className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground/60 flex items-baseline gap-1.5">
                    {label} <span className="text-[9px] text-muted-foreground/40 uppercase tracking-widest">{sub}</span>
                  </Label>
                  <Input type="number" min={0}
                    className="bg-muted/30 border-border/60 h-9 text-sm font-mono"
                    value={vals[k] as number}
                    onChange={(e) => set(k, parseInt(e.target.value) || 0)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border/40 bg-[hsl(222,47%,8%)] px-6 py-4">
          <div className="flex gap-3 max-w-3xl mx-auto">
            <Button variant="outline" className="flex-1 border-border/50" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1 gap-2"
              disabled={saving || !(vals.keywordText as string)?.trim() || (!isEdit && !vals.clientId)}
              onClick={() => onSave({
                ...vals,
                keywordType:               Number(vals.keywordType),
                isPrimary:                 (vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true) ? 1 : 0,
                initialSearchCount30Days:  Number(vals.initialSearchCount30Days)  || 0,
                followupSearchCount30Days: Number(vals.followupSearchCount30Days) || 0,
                initialSearchCountLife:    Number(vals.initialSearchCountLife)    || 0,
                followupSearchCountLife:   Number(vals.followupSearchCountLife)   || 0,
              })}
              style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : isEdit ? "Save Changes" : "Add Keyword"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════
   KEYWORD CARD — shows all fields + inline links
═══════════════════════════════════════════════════════════ */
function KeywordCard({
  kw, onEdit, onDelete, onToggleActive,
}: {
  kw: KwRecord;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [links, setLinks]       = useState<KeywordLink[] | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [addOpen, setAddOpen]   = useState(false);
  const [editLink, setEditLink] = useState<KeywordLink | null>(null);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/keywords/${kw.id}/links`, { credentials: "include" });
      setLinks(await r.json());
    } catch { setLinks([]); }
    finally { setLoading(false); }
  }, [kw.id]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  async function addLink(data: Partial<KeywordLink>) {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/keywords/${kw.id}/links`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      toast({ title: "Link added" });
      setAddOpen(false); fetchLinks();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function updateLink(id: number, data: Partial<KeywordLink>) {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/keywords/${kw.id}/links/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      toast({ title: "Saved" });
      setEditLink(null); fetchLinks();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteLink(id: number) {
    try {
      await fetch(`${BASE}/api/keywords/${kw.id}/links/${id}`, { method: "DELETE", credentials: "include" });
      toast({ title: "Link deleted" }); fetchLinks();
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  const isType2   = kw.keywordType === 2;
  const isPrimary = !!kw.isPrimary;
  const isActive  = kw.isActive as boolean;

  return (
    <div className={`rounded-xl border transition-all ${isActive ? "border-border/50 bg-card/60" : "border-border/30 bg-card/30 opacity-75"}`}>

      {/* ── Top row: keyword + type + meta ── */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          {isPrimary && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 flex-shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className="font-semibold text-sm text-foreground leading-snug break-words">{kw.keywordText as string}</p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${isType2 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-primary/10 text-primary border-primary/20"}`}>
                {isType2 ? "Type 2 – Backlink" : "Type 1 – Geo Specific"}
              </Badge>
              {isPrimary && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-amber-500/10 text-amber-400 border-amber-500/20">1st</Badge>
              )}
              {kw.dateAdded && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                  <Calendar className="w-3 h-3" />
                  {format(new Date(kw.dateAdded as string), "MMM d, yyyy")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Active toggle + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-2 bg-muted/20 border border-border/40 rounded-lg px-3 py-1.5">
            <Switch
              checked={isActive}
              onCheckedChange={onToggleActive}
              className="data-[state=checked]:bg-emerald-500 scale-75"
            />
            <span className={`text-[11px] font-medium ${isActive ? "text-emerald-400" : "text-muted-foreground/50"}`}>
              {isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <button onClick={onEdit}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-primary hover:bg-primary/10 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Search counts ── */}
      <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-border/20 pt-3">
        {[
          { label: "Initial Search Count", sub: "30 days",  value: kw.initialSearchCount30Days  ?? 0 },
          { label: "Follow-up Search Count", sub: "30 days", value: kw.followupSearchCount30Days ?? 0 },
          { label: "Initial Search Count",  sub: "Lifetime", value: kw.initialSearchCountLife    ?? 0 },
          { label: "Follow-up Search Count", sub: "Lifetime", value: kw.followupSearchCountLife  ?? 0 },
        ].map(({ label, sub, value }) => (
          <div key={`${label}-${sub}`} className="bg-muted/20 rounded-lg px-3 py-2.5 border border-border/20">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 leading-tight">{label}</p>
            <p className="text-[9px] text-muted-foreground/35 mb-1">{sub}</p>
            <p className="text-lg font-bold tabular-nums text-foreground/90 leading-none">{(value as number).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* ── Associated Links ── */}
      <div className="border-t border-border/20 px-4 pt-3 pb-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-400/70">Associated Links</span>
            {links != null && links.length > 0 && (
              <Badge variant="outline" className="text-[9px] text-violet-400 border-violet-500/30 bg-violet-500/10 h-4 px-1">
                {links.length}
              </Badge>
            )}
          </div>
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 border border-violet-500/30 hover:border-violet-500/60 rounded-lg px-2 py-1 bg-violet-500/5 hover:bg-violet-500/10 transition-all">
            <Plus className="w-3 h-3" /> Add Link
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-[72px] rounded-lg w-full" />
          </div>
        ) : links?.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/30 px-3 py-2.5">
            <Link2 className="w-3.5 h-3.5 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground/30 italic">No links yet — click Add Link</p>
          </div>
        ) : (
          <div className="space-y-2">
            {links?.map((link) => (
              <div key={link.id} className="rounded-lg border border-border/30 bg-muted/10 overflow-hidden">
                {/* Link header: type + active */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/20 bg-muted/10">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3 h-3 text-violet-400/60 flex-shrink-0" />
                    {link.linkTypeLabel ? (
                      <span className="text-[11px] font-medium text-foreground/80">{link.linkTypeLabel}</span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/40 italic">No type set</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={link.linkActive}
                      onCheckedChange={(v) => updateLink(link.id, { linkActive: v })}
                      className="data-[state=checked]:bg-emerald-500 scale-[0.65]"
                    />
                    <span className={`text-[10px] font-medium ${link.linkActive ? "text-emerald-400" : "text-muted-foreground/40"}`}>
                      {link.linkActive ? "Active" : "Inactive"}
                    </span>
                    <div className="w-px h-4 bg-border/40 mx-1" />
                    <button onClick={() => setEditLink(link)}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-primary/10 hover:text-primary text-muted-foreground/40 transition-colors">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => deleteLink(link.id)}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground/40 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Link report URLs */}
                <div className="grid grid-cols-2 divide-x divide-border/20">
                  {[
                    { label: "Initial Rank Report Link",  url: link.initialRankReportLink },
                    { label: "Current Rank Report Link", url: link.currentRankReportLink },
                  ].map(({ label, url }) => (
                    <div key={label} className="px-3 py-2">
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 mb-1">{label}</p>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-primary hover:underline max-w-full">
                          <Link2 className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{url}</span>
                          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-50" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/25 italic">Not set</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit link dialogs */}
      <LinkDialog open={addOpen} onOpenChange={setAddOpen} saving={saving} onSave={addLink} />
      {editLink && (
        <LinkDialog open onOpenChange={(o) => { if (!o) setEditLink(null); }}
          saving={saving} initial={editLink}
          onSave={(data) => updateLink(editLink.id, data)} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════ */
export default function Keywords() {
  const [search,     setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set());
  const [addOpen,    setAddOpen]    = useState(false);
  const [editKw,     setEditKw]     = useState<KwRecord | null>(null);
  const [saving,     setSaving]     = useState(false);

  const { data: keywords, isLoading } = useGetKeywords();
  const { data: clients }             = useGetClients();
  const updateKeyword                 = useUpdateKeyword();
  const { toast }                     = useToast();
  const queryClient                   = useQueryClient();

  const clientsMap = new Map<number, string>((clients ?? []).map((c) => [c.id, c.businessName]));

  async function saveKeyword(id: number | null, data: KwRecord) {
    setSaving(true);
    try {
      if (id) {
        await new Promise<void>((res, rej) =>
          updateKeyword.mutate({ id, data }, { onSuccess: () => res(), onError: (e) => rej(e) }),
        );
      } else {
        const r = await fetch(`${BASE}/api/keywords`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, clientId: Number(data.clientId), tierLabel: "aeo" }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: id ? "Keyword updated" : "Keyword added" });
      setEditKw(null); setAddOpen(false);
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteKeyword(id: number) {
    try {
      await fetch(`${BASE}/api/keywords/${id}`, { method: "DELETE", credentials: "include" });
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: "Keyword deleted" });
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  function toggleActive(kw: KwRecord, v: boolean) {
    updateKeyword.mutate(
      { id: kw.id as number, data: { isActive: v } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/keywords"] }) },
    );
  }

  /* Filter */
  const searchLower  = search.toLowerCase();
  const filteredKws  = (keywords ?? [] as KwRecord[]).filter((k: KwRecord) => {
    const matchText   = (k.keywordText as string).toLowerCase().includes(searchLower);
    const client      = clients?.find((c) => c.id === k.clientId);
    const matchClient = client ? (client.businessName ?? "").toLowerCase().includes(searchLower) : true;
    const matchType   = typeFilter === "all" || String(k.keywordType) === typeFilter;
    return (matchText || matchClient) && matchType;
  });

  /* Group by client */
  const grouped = new Map<number, KwRecord[]>();
  for (const kw of filteredKws) {
    const cid = kw.clientId as number;
    if (!grouped.has(cid)) grouped.set(cid, []);
    grouped.get(cid)!.push(kw);
  }

  /* Stats */
  const all     = keywords ?? [] as KwRecord[];
  const total   = all.length;
  const active  = all.filter((k: KwRecord) => k.isActive).length;
  const type1   = all.filter((k: KwRecord) => k.keywordType === 1).length;
  const type2   = all.filter((k: KwRecord) => k.keywordType === 2).length;

  /* Exports */
  const stamp        = format(new Date(), "yyyy-MM-dd");
  const exportAllCSV = () => exportCSV(filteredKws, clientsMap, `aeo-keywords-${stamp}.csv`);
  const exportAllPDF = () => exportPDF(filteredKws, clientsMap, `aeo-keywords-${stamp}.pdf`, `All businesses · ${filteredKws.length} keywords`);
  const exportBizCSV = (clientId: number, kws: KwRecord[]) =>
    exportCSV(kws, clientsMap, `${(clientsMap.get(clientId) ?? "business").replace(/\s+/g, "-").toLowerCase()}-keywords-${stamp}.csv`);
  const exportBizPDF = (clientId: number, kws: KwRecord[]) => {
    const name = clientsMap.get(clientId) ?? `Business #${clientId}`;
    exportPDF(kws, clientsMap, `${name.replace(/\s+/g, "-").toLowerCase()}-keywords-${stamp}.pdf`, `${name} · ${kws.length} keywords`);
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AEO Keywords</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage keywords and associated links per business</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 border-border/50 text-muted-foreground hover:text-foreground"
            onClick={exportAllCSV} disabled={filteredKws.length === 0}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 border-rose-500/30 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/50"
            onClick={exportAllPDF} disabled={filteredKws.length === 0}>
            <FileDown className="w-3.5 h-3.5" /> PDF
          </Button>
          <Button size="sm" className="gap-2"
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.3)" }}
            onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" /> Add Keyword
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Keywords", value: total,  dot: "",              color: "text-foreground" },
          { label: "Active",          value: active, dot: "bg-emerald-400", color: "text-emerald-400" },
          { label: "Type 1 – Geo",   value: type1,  dot: "bg-primary",    color: "text-primary" },
          { label: "Type 2 – Link",  value: type2,  dot: "bg-amber-400",  color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {s.dot && <span className={`w-2 h-2 rounded-full ${s.dot}`} />}
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <span className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input type="search" placeholder="Search business or keyword…"
            className="pl-9 bg-card/60 border-border/50 h-9"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground/50" />
          {[{ id: "all", label: "All" }, { id: "1", label: "Type 1 – Geo" }, { id: "2", label: "Type 2 – Backlink" }].map((t) => (
            <button key={t.id} onClick={() => setTypeFilter(t.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                typeFilter === t.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        {(search || typeFilter !== "all") && (
          <button onClick={() => { setSearch(""); setTypeFilter("all"); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground/40">{filteredKws.length} keyword{filteredKws.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}
        </div>
      ) : grouped.size === 0 ? (
        <div className="flex flex-col items-center justify-center h-52 rounded-xl border border-dashed border-border/40 bg-card/30 text-muted-foreground gap-3">
          <Key className="w-10 h-10 opacity-15" />
          <p className="text-sm">No keywords found</p>
          <Button size="sm" className="gap-1.5"
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))" }}
            onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add first keyword
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([clientId, kws]) => {
            const client   = clients?.find((c) => c.id === clientId);
            const isOpen   = expanded.has(clientId);
            const initials = (client?.businessName ?? "?").split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
            const activeCount = kws.filter((k) => k.isActive).length;

            return (
              <div key={clientId} className="rounded-xl border border-border/50 overflow-hidden">

                {/* Business header */}
                <div className={`flex items-center gap-0 transition-colors ${isOpen ? "bg-[hsl(222,47%,12%)] border-b border-primary/20" : "bg-card/60 hover:bg-card/80"}`}>
                  <button
                    onClick={() => setExpanded((p) => { const n = new Set(p); n.has(clientId) ? n.delete(clientId) : n.add(clientId); return n; })}
                    className={`flex items-center gap-3 px-4 py-3.5 flex-1 min-w-0 text-left border-r border-border/40 transition-colors ${isOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${isOpen ? "bg-primary/20 text-primary" : "bg-gradient-to-br from-primary/30 to-primary/10 text-primary"}`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm truncate text-foreground">{client?.businessName ?? `Business #${clientId}`}</p>
                        {(client as Record<string, unknown>)?.city && <span className="text-[11px] text-muted-foreground/50 hidden sm:inline">{(client as Record<string, unknown>).city as string}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{kws.length} keyword{kws.length !== 1 ? "s" : ""}</span>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="text-[10px] text-emerald-400">{activeCount} active</span>
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? "rotate-180 text-primary" : ""}`} />
                  </button>

                  {/* Export + profile buttons */}
                  <div className="flex items-center gap-1 px-3">
                    <button onClick={() => exportBizCSV(clientId, kws)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/40 hover:border-border/70 rounded-lg px-2 py-1.5 bg-muted/10 hover:bg-muted/20 transition-all">
                      <Download className="w-3 h-3" /> CSV
                    </button>
                    <button onClick={() => exportBizPDF(clientId, kws)}
                      className="flex items-center gap-1.5 text-xs text-rose-400/70 hover:text-rose-400 border border-rose-500/20 hover:border-rose-500/50 rounded-lg px-2 py-1.5 bg-rose-500/5 hover:bg-rose-500/10 transition-all">
                      <FileDown className="w-3 h-3" /> PDF
                    </button>
                    <Link href={`/clients/${clientId}`}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary border border-border/40 hover:border-primary/30 rounded-lg px-2.5 py-1.5 bg-muted/10 hover:bg-primary/5 transition-all">
                      <Building2 className="w-3 h-3" /> Profile
                    </Link>
                  </div>
                </div>

                {/* Keywords list */}
                {isOpen && (
                  <div className="p-3 space-y-3 bg-[hsl(222,47%,10%)]">
                    {kws.map((kw) => (
                      <KeywordCard
                        key={kw.id as number}
                        kw={kw}
                        onEdit={() => setEditKw({ ...kw })}
                        onDelete={() => deleteKeyword(kw.id as number)}
                        onToggleActive={(v) => toggleActive(kw, v)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add keyword dialog */}
      <KeywordDialog
        open={addOpen} onOpenChange={setAddOpen}
        title="Add Keyword" saving={saving}
        clients={clients}
        onSave={(data) => saveKeyword(null, data)}
      />

      {/* Edit keyword dialog */}
      {editKw && (
        <KeywordDialog
          open onOpenChange={(o) => { if (!o) setEditKw(null); }}
          title="Edit Keyword" saving={saving}
          initial={editKw}
          onSave={(data) => saveKeyword(editKw.id as number, data)}
        />
      )}
    </div>
  );
}
