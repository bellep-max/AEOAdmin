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
  Download, ChevronDown, FileDown, Link2, FileText,
} from "lucide-react";
import { format } from "date-fns";
import jsPDF       from "jspdf";
import autoTable   from "jspdf-autotable";

import { apiFetch, apiJson } from "@/lib/api";
const LINK_TYPES = ["GBP snippet", "Client website blog post", "External article"];

type KwRecord = Record<string, unknown>;

// Helper function to get keyword type label
function getKeywordTypeLabel(type: number | string, short = false): string {
  const t = Number(type);
  if (short) {
    switch (t) {
      case 3: return "Keyword";
      case 4: return "w/ Backlinks";
      default: return "Keyword";
    }
  }
  switch (t) {
    case 3: return "Keywords";
    case 4: return "Keywords with Backlinks";
    default: return "Keywords";
  }
}

interface KeywordLink {
  id: number; keywordId: number;
  linkUrl: string | null;
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
    const type = getKeywordTypeLabel(kw.keywordType as number);
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
      const type = getKeywordTypeLabel(kw.keywordType as number, true);
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
        0: { cellWidth: 55, overflow: "linebreak" }, 1: { cellWidth: 20 }, 2: { cellWidth: 9, halign: "center" },
        3: { cellWidth: 13, halign: "center" }, 4: { cellWidth: 18, halign: "center" },
        5: { cellWidth: 11, halign: "right" }, 6: { cellWidth: 11, halign: "right" },
        7: { cellWidth: 11, halign: "right" }, 8: { cellWidth: 11, halign: "right" },
        9: { cellWidth: 26 }, 10: { cellWidth: 13, halign: "center" },
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
  const blank = { linkUrl: "", linkTypeLabel: "", linkActive: true, initialRankReportLink: "", currentRankReportLink: "" };
  const [vals, setVals] = useState<Partial<KeywordLink>>(blank);
  function set(k: keyof KeywordLink, v: unknown) { setVals((p) => ({ ...p, [k]: v })); }

  useEffect(() => { if (open) setVals(initial ?? blank); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <Link2 className="w-4 h-4 text-violet-600" />
            </div>
            <DialogTitle className="text-lg font-bold text-black dark:text-white">{initial?.id ? "Edit Link" : "Add Associated Link"}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">Associated link form</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Link Type Label</Label>
              <Select value={(vals.linkTypeLabel as string) || ""} onValueChange={(v) => set("linkTypeLabel", v)}>
                <SelectTrigger className="bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {LINK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 h-11">
              <p className="text-base flex-1 text-black dark:text-white font-bold">Active</p>
              <Switch
                checked={vals.linkActive !== false}
                onCheckedChange={(v) => set("linkActive", v)}
                className="data-[state=checked]:bg-emerald-500 scale-75"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Link URL</Label>
            <Input
              className="bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base font-mono text-black dark:text-white"
              placeholder="https://…"
              value={(vals.linkUrl as string) || ""}
              onChange={(e) => set("linkUrl", e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <Button variant="outline" className="flex-1 border-slate-300 dark:border-slate-600 text-black dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 text-base font-bold h-11" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1 gap-2 text-base font-bold h-11" disabled={saving} onClick={() => onSave(vals)}
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))" }}>
            {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : (initial?.id ? "Save Changes" : "Add Link")}
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
  open, onOpenChange, title, saving, initial, clients, onSave, defaultClientId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  title: string; saving: boolean;
  initial?: KwRecord;
  defaultClientId?: number;
  clients?: { id: number; businessName: string; city?: string | null; searchAddress?: string | null; publishedAddress?: string | null }[];
  onSave: (data: KwRecord) => void;
}) {
  const blank: KwRecord = {
    clientId: "", keywordText: "", keywordType: "3", isPrimary: "0", isActive: true,
    initialSearchCount30Days: 0, followupSearchCount30Days: 0,
    initialSearchCountLife: 0,  followupSearchCountLife: 0,
    initialRankReportCount: 0,  currentRankReportCount: 0,
    linkUrl: "", linkTypeLabel: "", linkActive: true,
    initialRankReportLink: "", currentRankReportLink: "",
  };
  const [vals, setVals] = useState<KwRecord>(blank);
  function set(k: string, v: unknown) { setVals((p) => ({ ...p, [k]: v })); }
  const isEdit = !!initial;

  useEffect(() => { if (open) setVals(initial ?? (defaultClientId ? { ...blank, clientId: String(defaultClientId) } : blank)); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-full max-h-screen rounded-none border-0 bg-white dark:bg-slate-900 flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0">
              <Key className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-black dark:text-white">{title}</DialogTitle>
              <p className="text-base text-slate-600 dark:text-slate-400 mt-0.5">Fill in all fields, then save</p>
            </div>
          </div>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl w-full mx-auto space-y-5">
          {/* Business + Keyword */}
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <div className="space-y-1.5">
                <Label className="text-sm uppercase tracking-widest text-black font-bold">Business <span className="text-red-600">*</span></Label>
                <Select value={vals.clientId as string} onValueChange={(v) => set("clientId", v)}>
                  <SelectTrigger className="bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 h-11 text-base text-black dark:text-white"><SelectValue placeholder="Select business…" /></SelectTrigger>
                  <SelectContent>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        <div className="flex flex-col gap-0">
                          <span className="font-bold text-base">{c.businessName}</span>
                          {c.searchAddress && <span className="text-xs text-slate-500">Search: {c.searchAddress}</span>}
                          {c.publishedAddress && <span className="text-xs text-slate-500">GMB: {c.publishedAddress}</span>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={!isEdit ? "" : "col-span-2"}>
              <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Keyword <span className="text-red-600">*</span></Label>
              <Input className="bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 h-11 text-base mt-1.5 text-black dark:text-white"
                placeholder="e.g. best plumber in Manchester"
                value={vals.keywordText as string}
                onChange={(e) => set("keywordText", e.target.value)} />
            </div>
          </div>

          {/* Keyword type */}
          <div className="space-y-1.5">
            <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Keyword Types <span className="text-red-600">*</span></Label>
            <Select value={String(vals.keywordType)} onValueChange={(v) => set("keywordType", v)}>
              <SelectTrigger className="bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white">
                <SelectValue placeholder="Select keyword type…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Keywords</SelectItem>
                <SelectItem value="4">Keywords with Backlinks</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Type 4 — full link form */}
          {String(vals.keywordType) === "4" && (
            <div className="space-y-3 pt-3 pb-4 px-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800/50">
              <div className="flex items-center gap-2 mb-1">
                <Link2 className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Backlink Details</p>
              </div>

              {/* Link URL */}
              <div className="space-y-1.5">
                <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Link URL</Label>
                <Input
                  className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white font-mono"
                  placeholder="https://…"
                  value={(vals.linkUrl as string) || ""}
                  onChange={(e) => set("linkUrl", e.target.value)}
                />
              </div>

              {/* Link Type + Active */}
              <div className="grid grid-cols-3 gap-3 items-end">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Link Type Label</Label>
                  <Select value={(vals.linkTypeLabel as string) || ""} onValueChange={(v) => set("linkTypeLabel", v)}>
                    <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white">
                      <SelectValue placeholder="Select link type…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GBP snippet">GBP snippet</SelectItem>
                      <SelectItem value="Client website blog post">Client website blog post</SelectItem>
                      <SelectItem value="External article">External article</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 h-11">
                  <p className="text-base flex-1 text-black dark:text-white font-bold">Active</p>
                  <Switch
                    checked={vals.linkActive !== false}
                    onCheckedChange={(v) => set("linkActive", v)}
                    className="data-[state=checked]:bg-emerald-500 scale-75"
                  />
                </div>
              </div>

            </div>
          )}

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
              <div key={row.k} className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-4">
                <div className="flex-1"><p className="text-base font-bold text-black dark:text-white">{row.label}</p><p className="text-sm text-slate-600 dark:text-slate-400">{row.sub}</p></div>
                <Switch checked={row.checked} onCheckedChange={row.onChange} className={row.cls} />
              </div>
            ))}
          </div>

          {/* Search counts */}
          <div>
            <p className="text-sm uppercase tracking-widest text-black dark:text-white font-bold mb-3">Search Counts</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                { k: "initialSearchCount30Days",  label: "Initial Search Count" },
                { k: "followupSearchCount30Days", label: "Follow-up Search Count" },
                { k: "initialRankReportCount",    label: "Initial Rank Report" },
                { k: "currentRankReportCount",    label: "Current Rank Report" },
              ].map(({ k, label }) => (
                <div key={k} className="space-y-1.5">
                  <Label className="text-sm text-black dark:text-white font-medium">{label}</Label>
                  <Input type="number" min={0}
                    className="bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base font-mono text-black dark:text-white"
                    value={vals[k] as number}
                    onChange={(e) => set(k, parseInt(e.target.value) || 0)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-5">
          <div className="flex gap-3 max-w-3xl mx-auto">
            <Button variant="outline" className="flex-1 border-slate-300 dark:border-slate-600 text-black dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 text-base font-bold h-12" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1 gap-2 text-base font-bold h-12"
              disabled={saving || !(vals.keywordText as string)?.trim() || (!isEdit && !vals.clientId)}
              onClick={() => onSave({
                ...vals,
                keywordType:               Number(vals.keywordType),
                isPrimary:                 (vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true) ? 1 : 0,
                initialSearchCount30Days:  Number(vals.initialSearchCount30Days)  || 0,
                followupSearchCount30Days: Number(vals.followupSearchCount30Days) || 0,
                initialSearchCountLife:    Number(vals.initialSearchCountLife)    || 0,
                followupSearchCountLife:   Number(vals.followupSearchCountLife)   || 0,
                initialRankReportCount:    Number(vals.initialRankReportCount)    || 0,
                currentRankReportCount:    Number(vals.currentRankReportCount)    || 0,
              })}
              style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}>
              {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : isEdit ? "Save Changes" : "Add Keyword"}
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
      const data = await apiJson<KeywordLink[]>(`/api/keywords/${kw.id}/links`);
      setLinks(data);
    } catch { setLinks([]); }
    finally { setLoading(false); }
  }, [kw.id]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  async function addLink(data: Partial<KeywordLink>) {
    setSaving(true);
    try {
      await apiJson(`/api/keywords/${kw.id}/links`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      toast({ title: "Link added" });
      setAddOpen(false); fetchLinks();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function updateLink(id: number, data: Partial<KeywordLink>) {
    setSaving(true);
    try {
      await apiJson(`/api/keywords/${kw.id}/links/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      toast({ title: "Saved" });
      setEditLink(null); fetchLinks();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteLink(id: number) {
    try {
      await apiFetch(`/api/keywords/${kw.id}/links/${id}`, { method: "DELETE" });
      toast({ title: "Link deleted" }); fetchLinks();
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  const isType4    = Number(kw.keywordType) === 4;
  const hasLinks   = (links?.length ?? 0) > 0;
  const showAsBacklinks = isType4 || hasLinks;
  const isPrimary  = !!kw.isPrimary;
  const isActive   = kw.isActive !== false;  // treat undefined (old rows) as true

  return (
    <div className={`rounded-xl border-2 transition-all ${isActive ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm" : "border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shadow-sm"}` }>

      {/* ── Top row: keyword + type + meta ── */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          {isPrimary && <Star className="w-3.5 h-3.5 text-amber-600 fill-amber-600 flex-shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className="font-bold text-lg text-black dark:text-white leading-snug break-words">{kw.keywordText as string}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className={`text-sm h-6 px-2.5 ${
                showAsBacklinks ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                                : "bg-violet-100 text-violet-700 border-violet-300"
              }`}>
                {showAsBacklinks ? "w/ Backlinks" : "Keyword"}
              </Badge>
              {isPrimary && (
                <Badge variant="outline" className="text-sm h-6 px-2.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/50">1st</Badge>
              )}
              {!!(kw.dateAdded) && (
                <span className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                  <Calendar className="w-4 h-4" />
                  {format(new Date(kw.dateAdded as string), "MMM d, yyyy")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Active toggle + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {showAsBacklinks ? (
            /* Button pair for keywords with backlinks */
            <div className="flex items-center gap-1 border border-slate-300 dark:border-slate-600 rounded-lg p-1">
              <button
                onClick={() => !isActive && onToggleActive(true)}
                className={`px-3 py-1.5 rounded text-sm font-bold transition-all ${isActive ? "bg-emerald-500 text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700"}`}
              >
                Active
              </button>
              <button
                onClick={() => isActive && onToggleActive(false)}
                className={`px-3 py-1.5 rounded text-sm font-bold transition-all ${!isActive ? "bg-slate-500 text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700"}`}
              >
                Inactive
              </button>
            </div>
          ) : (
            /* Switch toggle for keywords without backlinks */
            <div className="flex items-center gap-2 border border-slate-300 dark:border-slate-600 rounded-lg px-3.5 py-2">
              <Switch
                checked={isActive}
                onCheckedChange={onToggleActive}
                className="data-[state=checked]:bg-emerald-500"
              />
              <span className={`text-sm font-bold ${isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`}>
                {isActive ? "Active" : "Inactive"}
              </span>
            </div>
          )}
          <button onClick={onEdit}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:text-blue-600 hover:bg-blue-100 transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:text-red-600 hover:bg-red-100 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Search counts ── */}
      {!isActive ? (
        <div className="px-4 pb-3 border-t border-slate-200 pt-3">
          <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 py-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 dark:bg-slate-700 px-4 py-1.5 text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">
              Inactive
            </span>
          </div>
        </div>
      ) : (
      <div className="px-4 pb-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
        {[
          { label: "Initial Search Count",   value: kw.initialSearchCount30Days  ?? 0 },
          { label: "Follow-up Search Count", value: kw.followupSearchCount30Days ?? 0 },
          { label: "Initial Rank Report",    value: kw.initialRankReportCount    ?? 0 },
          { label: "Current Rank Report",    value: kw.currentRankReportCount    ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg px-3.5 py-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-800/50">
            <p className="text-xs uppercase tracking-widest text-slate-700 dark:text-slate-400 leading-tight mb-1.5">{label}</p>
            <p className="text-2xl font-bold tabular-nums text-black dark:text-white leading-none">{(value as number).toLocaleString()}</p>
          </div>
        ))}
      </div>
      )}

      {/* ── Associated Links ── */}
      {isActive && (
      <div className="border-t border-slate-200 px-4 pt-3 pb-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-bold uppercase tracking-widest text-violet-600">Associated Links</span>
            {links != null && links.length > 0 && (
              <Badge variant="outline" className="text-xs text-violet-600 border-violet-300 bg-violet-50 h-5 px-2">
                {links.length}
              </Badge>
            )}
          </div>
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-1 text-base text-violet-600 hover:text-violet-700 border border-violet-300 hover:border-violet-400 rounded-lg px-3 py-1.5 bg-violet-50 hover:bg-violet-100 transition-all font-bold\">
            <Plus className="w-4 h-4" /> Add Link
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-[72px] rounded-lg w-full" />
          </div>
        ) : links?.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-3">
            <Link2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            <p className="text-sm text-slate-600 dark:text-slate-400 italic">No links yet — click Add Link</p>
          </div>
        ) : (
          <div className="space-y-2">
            {links?.map((link) => (
              <div key={link.id} className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 overflow-hidden">
                {/* Link header: type + active */}
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-violet-600 flex-shrink-0" />
                    {link.linkTypeLabel ? (
                      <span className="text-base font-bold text-black dark:text-white">{link.linkTypeLabel}</span>
                    ) : (
                      <span className="text-base text-slate-600 dark:text-slate-400 italic">No type set</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditLink(link)}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-blue-100 hover:text-blue-600 text-slate-600 transition-colors">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => deleteLink(link.id)}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-100 hover:text-red-600 text-slate-600 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Link URLs */}
                <div className="divide-y divide-slate-200 dark:divide-slate-700">
                  {[
                    { label: "Link URL",                  url: link.linkUrl },
                    { label: "Initial Rank Report Link",  url: link.initialRankReportLink },
                    { label: "Current Rank Report Link",  url: link.currentRankReportLink },
                  ].map(({ label, url }) => (
                    <div key={label} className="px-3 py-2.5">
                      <p className="text-xs uppercase tracking-widest text-slate-700 dark:text-slate-400 mb-2">{label}</p>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-blue-600 hover:underline max-w-full font-medium">
                          <Link2 className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">{url}</span>
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-sm text-slate-600 dark:text-slate-400 italic">Not set</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

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
  const [search,         setSearch]         = useState("");
  const [typeFilter,     setTypeFilter]     = useState<string>("all");
  const [businessFilter, setBusinessFilter] = useState<string>("all");
  const [bizTypeFilters, setBizTypeFilters] = useState<Map<number, string>>(new Map());
  const [expanded,       setExpanded]       = useState<Set<number>>(new Set());
  const [addOpen,        setAddOpen]        = useState(false);
  const [editKw,         setEditKw]         = useState<KwRecord | null>(null);
  const [addForClient,   setAddForClient]   = useState<number | null>(null);
  const [saving,         setSaving]         = useState(false);

  function getBizTypeFilter(cid: number) { return bizTypeFilters.get(cid) ?? "all"; }
  function setBizTypeFilter(cid: number, v: string) {
    setBizTypeFilters((p) => { const n = new Map(p); n.set(cid, v); return n; });
  }

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
        const { linkUrl, linkTypeLabel, linkActive, initialRankReportLink, currentRankReportLink, ...kwData } = data;
        const newKw = await apiJson<KwRecord>(`/api/keywords`, {
          method: "POST",
          body: JSON.stringify({ ...kwData, clientId: Number(kwData.clientId) }),
        });
        // If type 4, always create a link row so it shows in Associated Links
        if (Number(kwData.keywordType) === 4) {
          await apiJson(`/api/keywords/${newKw.id}/links`, {
            method: "POST",
            body: JSON.stringify({ linkUrl: linkUrl || null, linkTypeLabel: linkTypeLabel || null, linkActive, initialRankReportLink: initialRankReportLink || null, currentRankReportLink: currentRankReportLink || null }),
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: id ? "Keyword updated" : "Keyword added" });
      setEditKw(null); setAddOpen(false); setAddForClient(null);
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteKeyword(id: number) {
    try {
      await apiFetch(`/api/keywords/${id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: "Keyword deleted" });
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  function toggleActive(kw: KwRecord, v: boolean) {
    // Optimistic update — update cache immediately so the UI doesn't snap back
    queryClient.setQueryData<KwRecord[]>(
      ["/api/keywords"],
      (old) => old ? old.map((k) => k.id === kw.id ? { ...k, isActive: v } : k) : old,
    );
    updateKeyword.mutate(
      { id: kw.id as number, data: { isActive: v } },
      {
        onError: () => {
          // Revert on failure
          queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
          toast({ title: "Failed to update active status", variant: "destructive" });
        },
      },
    );
  }

  /* Filter */
  const searchLower  = search.toLowerCase();
  const filteredKws  = ((keywords ?? []) as unknown as KwRecord[]).filter((k: KwRecord) => {
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
  const all      = keywords ?? [] as KwRecord[];
  const total    = all.length;
  const active   = all.filter((k: KwRecord) => k.isActive !== false).length;
  const type3    = all.filter((k: KwRecord) => Number(k.keywordType) === 3).length;
  const type4    = all.filter((k: KwRecord) => Number(k.keywordType) === 4).length;

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
    <div className="space-y-6 bg-white dark:bg-slate-950 min-h-screen p-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">AEO Keywords</h1>
          <p className="text-slate-700 dark:text-slate-300 text-lg mt-0.5">Manage keywords and associated links per business</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:text-black dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={exportAllCSV} disabled={filteredKws.length === 0}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 border-red-300 text-red-600 hover:text-red-700 hover:bg-red-50 hover:border-red-400"
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
          { label: "Total Keywords",          value: total,  dot: "",              color: "text-slate-900 dark:text-white" },
          { label: "Active",                   value: active, dot: "bg-emerald-400", color: "text-emerald-600" },
          { label: "Keywords",                 value: type3,  dot: "bg-violet-400",  color: "text-violet-600" },
          { label: "Keywords with Backlinks",  value: type4,  dot: "bg-emerald-500", color: "text-emerald-600" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              {s.dot && <span className={`w-2 h-2 rounded-full ${s.dot}`} />}
              <span className="text-base font-bold text-slate-700 dark:text-slate-300">{s.label}</span>
            </div>
            <span className={`text-4xl font-bold tabular-nums ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-600 pointer-events-none" />
          <Input type="search" placeholder="Search business or keyword…"
            className="pl-11 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 h-12 text-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-700 dark:placeholder:text-slate-500"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-slate-700 dark:text-slate-300" />
          {[
            { id: "all", label: "All" },
            { id: "3",   label: "Keywords" },
            { id: "4",   label: "Keywords with Backlinks" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTypeFilter(t.id)}
              className={`px-4 py-2.5 rounded-full text-base font-bold border-2 transition-all ${
                typeFilter === t.id
                  ? (t.id === "4" ? "bg-emerald-600 text-white border-emerald-600" : "bg-blue-600 text-white border-blue-600")
                  : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        {/* Business filter */}
        <Select value={businessFilter} onValueChange={setBusinessFilter}>
          <SelectTrigger className="w-56 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 h-12 text-base text-slate-900 dark:text-slate-100">
            <SelectValue placeholder="All businesses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All businesses</SelectItem>
            {Array.from(grouped.entries()).map(([cid]) => {
              const c = clients?.find((x) => x.id === cid);
              return (
                <SelectItem key={cid} value={String(cid)}>
                  <div className="flex flex-col gap-0">
                    <span className="font-bold">{c?.businessName ?? `Business #${cid}`}</span>
                    {c?.searchAddress && <span className="text-xs text-slate-500">Search: {c.searchAddress}</span>}
                    {c?.publishedAddress && <span className="text-xs text-slate-500">GMB: {c.publishedAddress}</span>}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {(search || typeFilter !== "all" || businessFilter !== "all") && (
          <button onClick={() => { setSearch(""); setTypeFilter("all"); setBusinessFilter("all"); }}
            className="flex items-center gap-1.5 text-base text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-bold">
            <X className="w-5 h-5" /> Clear
          </button>
        )}
        <span className="ml-auto text-base text-slate-800 dark:text-slate-200 font-bold">{filteredKws.length} keyword{filteredKws.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-base text-muted-foreground font-medium">Loading keywords…</p>
        </div>
      ) : grouped.size === 0 ? (
        <div className="flex flex-col items-center justify-center h-52 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 gap-3">
          <Key className="w-12 h-12 opacity-100" />
          <p className="text-xl font-semibold">No keywords found</p>
          <Button size="lg" className="gap-2 bg-blue-600 hover:bg-blue-700 text-white text-lg px-6 py-4 font-bold"
            onClick={() => setAddOpen(true)}>
            <Plus className="w-5 h-5" /> Add first keyword
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries())
            .filter(([cid]) => businessFilter === "all" || String(cid) === businessFilter)
            .map(([clientId, kws]) => {
            const client      = clients?.find((c) => c.id === clientId);
            const isOpen      = expanded.has(clientId);
            const initials    = (client?.businessName ?? "?").split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
            const activeCount = kws.filter((k) => k.isActive !== false).length;
            const bizFilter   = getBizTypeFilter(clientId);
            const displayedKws = bizFilter === "all" ? kws : kws.filter((k) => String(k.keywordType) === bizFilter);

            return (
              <div key={clientId} className="rounded-xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900 shadow-md">

                {/* Business header */}
                <div className={`flex items-center gap-0 transition-colors ${isOpen ? "bg-slate-50 dark:bg-slate-800 border-b border-blue-300 dark:border-blue-700" : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"}`}>
                  <button
                    onClick={() => setExpanded((p) => { const n = new Set(p); n.has(clientId) ? n.delete(clientId) : n.add(clientId); return n; })}
                    className={`flex items-center gap-3 px-4 py-4 flex-1 min-w-0 text-left border-r border-slate-300 dark:border-slate-700 transition-colors ${isOpen ? "text-blue-600 font-bold" : "text-slate-700 dark:text-slate-300 hover:text-black dark:hover:text-white"}`}>
                    <div className={`w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${isOpen ? "bg-blue-100 text-blue-600" : "bg-blue-50 text-blue-600"}`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col gap-0.5">
                        <p className="font-bold text-base text-black dark:text-white">{client?.businessName ?? `Business #${clientId}`}</p>
                        {client?.searchAddress && <span className="text-xs text-slate-500 dark:text-slate-400"><span className="font-bold uppercase tracking-wide">Search:</span> {client.searchAddress}</span>}
                        {client?.publishedAddress && <span className="text-xs text-slate-500 dark:text-slate-400"><span className="font-bold uppercase tracking-wide">GMB:</span> {client.publishedAddress}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-base text-slate-600 dark:text-slate-400">{displayedKws.length}{displayedKws.length !== kws.length ? `/${kws.length}` : ""} keyword{kws.length !== 1 ? "s" : ""}</span>
                        <span className="text-slate-400 dark:text-slate-600">·</span>
                        {client?.status === "inactive" ? (
                          <span className="inline-flex items-center rounded-full bg-slate-200 dark:bg-slate-700 px-2.5 py-0.5 text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Client inactive</span>
                        ) : activeCount === 0 ? (
                          <span className="text-base text-slate-500 font-bold">0 active</span>
                        ) : (
                          <span className="text-base text-emerald-600 font-bold">{activeCount} active</span>
                        )}
                      </div>
                    </div>
                    <ChevronDown className={`w-5 h-5 flex-shrink-0 transition-transform ${isOpen ? "rotate-180 text-blue-600" : "text-slate-600 dark:text-slate-400"}`} />
                  </button>

                  {/* Export + profile buttons */}
                  <div className="flex items-center gap-2 px-4">
                    <button onClick={() => exportBizCSV(clientId, kws)}
                      className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-bold border-2 border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 rounded-lg px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all">
                      <Download className="w-5 h-5" /> CSV
                    </button>
                    <button onClick={() => exportBizPDF(clientId, kws)}
                      className="flex items-center gap-2 text-base text-red-600 hover:text-red-700 font-bold border-2 border-red-300 hover:border-red-400 rounded-lg px-4 py-2 hover:bg-red-50 transition-all">
                      <FileDown className="w-5 h-5" /> PDF
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setAddForClient(clientId); }}
                      className="flex items-center gap-2 text-base text-emerald-600 hover:text-emerald-700 font-bold border-2 border-emerald-300 hover:border-emerald-400 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-all">
                      <Plus className="w-5 h-5" /> Add Keyword
                    </button>
                    <Link href={`/clients/${clientId}`}
                      className="flex items-center gap-2 text-base text-blue-600 hover:text-blue-700 font-bold border-2 border-blue-300 hover:border-blue-400 rounded-lg px-4 py-2 hover:bg-blue-50 transition-all">
                      <Building2 className="w-5 h-5" /> Profile
                    </Link>
                  </div>
                </div>

                {/* Keywords list */}
                {isOpen && (
                  <div className="bg-white dark:bg-slate-950 border-t-2 border-slate-200 dark:border-slate-700">
                    {/* Per-business type filter */}
                    <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                      <Filter className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                      {[
                        { id: "all", label: "All" },
                        { id: "3",   label: "Keywords" },
                        { id: "4",   label: "w/ Backlinks" },
                      ].map((t) => (
                        <button key={t.id} onClick={() => setBizTypeFilter(clientId, t.id)}
                          className={`px-3 py-1.5 rounded-full text-sm font-bold border-2 transition-all ${
                            bizFilter === t.id
                              ? (t.id === "4" ? "bg-emerald-600 text-white border-emerald-600" : "bg-blue-600 text-white border-blue-600")
                              : "border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900"
                          }`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <div className="p-4 space-y-4">
                    {displayedKws.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-3">
                        <Key className="w-4 h-4 text-slate-500" />
                        <p className="text-sm text-slate-500 italic">No keywords match this filter</p>
                      </div>
                    ) : displayedKws.map((kw) => (
                      <KeywordCard
                        key={kw.id as number}
                        kw={kw}
                        onEdit={() => setEditKw({ ...kw })}
                        onDelete={() => deleteKeyword(kw.id as number)}
                        onToggleActive={(v) => toggleActive(kw, v)}
                      />
                    ))}
                    </div>
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

      {/* Add keyword for specific business */}
      {addForClient !== null && (
        <KeywordDialog
          open onOpenChange={(o) => { if (!o) setAddForClient(null); }}
          title="Add Keyword" saving={saving}
          clients={clients}
          defaultClientId={addForClient}
          onSave={(data) => saveKeyword(null, data)}
        />
      )}
    </div>
  );
}
