import React, { useState, useEffect, useCallback } from "react";
import {
  useUpdateKeyword, useGetClients,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Badge }    from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch }   from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast }  from "@/hooks/use-toast";
import { Link }      from "wouter";
import {
  Search, Plus, Key, Loader2, Star, Filter, X,
  Building2, ExternalLink, Pencil, Trash2, Calendar,
  Download, ChevronDown, FileDown, Link2, FileText, Bookmark,
} from "lucide-react";
import { format } from "date-fns";
import jsPDF       from "jspdf";
import autoTable   from "jspdf-autotable";
import { KeywordDialog } from "@/components/KeywordDialog";

const BASE       = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers });
}
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
   RANKING HELPERS
═══════════════════════════════════════════════════════════ */
interface RankCell { current: number | null; previous: number | null }
type RankMap = Map<number, Partial<Record<string, RankCell>>>;

function fmtRank(c: RankCell | undefined): string {
  if (!c || c.current == null) return "—";
  return `#${c.current}`;
}

/* ═══════════════════════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════════════════════ */
function exportCSV(
  rows: KwRecord[],
  businessesMap: Map<number, { name: string; clientId: number }>,
  clientsMap: Map<number, string>,
  plansMap: Map<number, { name: string | null; planType: string }>,
  rankMap: RankMap,
  filename: string,
) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = [
    "Client", "Business", "Campaign", "Keyword", "Keyword Type", "Primary (1st)", "Active", "Date Added",
    "ChatGPT Rank", "Gemini Rank", "Perplexity Rank",
    "Search (30d)", "Follow-up Search (30d)",
    "Search (Life)", "Follow-up Search (Life)",
    "Link Type", "Link Active", "Initial Rank Report", "Current Rank Report",
  ];
  const lines = rows.map((kw) => {
    const type = getKeywordTypeLabel(kw.keywordType as number);
    const date = kw.dateAdded ? format(new Date(kw.dateAdded as string), "yyyy-MM-dd") : "";
    const biz  = businessesMap.get(kw.businessId as number);
    const plan = kw.aeoPlanId != null ? plansMap.get(kw.aeoPlanId as number) : undefined;
    const campaign = plan ? (plan.name ?? plan.planType) : "";
    const ranks = rankMap.get(kw.id as number) ?? {};
    return [
      esc(clientsMap.get(kw.clientId as number) ?? ""),
      esc(biz?.name ?? ""),
      esc(campaign),
      esc(kw.keywordText), esc(type),
      esc(kw.isPrimary ? "Yes" : "No"),
      esc(kw.isActive  ? "Active" : "Inactive"),
      esc(date),
      esc(fmtRank(ranks.chatgpt)),
      esc(fmtRank(ranks.gemini)),
      esc(fmtRank(ranks.perplexity)),
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
function exportPDF(
  rows: KwRecord[],
  businessesMap: Map<number, { name: string; clientId: number }>,
  clientsMap: Map<number, string>,
  plansMap: Map<number, { name: string | null; planType: string }>,
  rankMap: RankMap,
  filename: string,
  title: string,
) {
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
    const bizRec = businessesMap.get(kw.businessId as number);
    const clientName = clientsMap.get(kw.clientId as number) ?? `Client #${kw.clientId}`;
    const label = bizRec ? `${clientName} — ${bizRec.name}` : `${clientName} — (Unassigned)`;
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(kw);
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
      const plan = kw.aeoPlanId != null ? plansMap.get(kw.aeoPlanId as number) : undefined;
      const campaign = plan ? (plan.name ?? plan.planType) : "—";
      const ranks = rankMap.get(kw.id as number) ?? {};
      return [
        campaign,
        kw.keywordText as string, type,
        kw.isPrimary ? "Yes" : "No",
        kw.isActive  ? "Active" : "Inactive",
        date,
        fmtRank(ranks.chatgpt),
        fmtRank(ranks.gemini),
        fmtRank(ranks.perplexity),
        String(kw.initialSearchCount30Days  ?? 0),
        String(kw.followupSearchCount30Days ?? 0),
        String(kw.initialSearchCountLife    ?? 0),
        String(kw.followupSearchCountLife   ?? 0),
        (kw.linkTypeLabel as string) || "—",
        (kw.linkActive as boolean) !== false ? "Active" : "Inactive",
      ];
    });

    autoTable(doc, {
      startY,
      head: [["Campaign","Keyword","Type","1st","Active","Date","ChatGPT","Gemini","Perplexity","Init 30d","F/U 30d","Init Life","F/U Life","Link Type","Link Active"]],
      body: bodyRows,
      theme: "striped",
      headStyles: { fillColor: [17, 24, 39], textColor: [180, 200, 230], fontSize: 7, fontStyle: "bold", cellPadding: 2.5 },
      bodyStyles: { fontSize: 7, cellPadding: 2, textColor: [30, 30, 50] },
      alternateRowStyles: { fillColor: [245, 247, 252] },
      columnStyles: {
        0: { cellWidth: 32, overflow: "linebreak" },
        1: { cellWidth: 42, overflow: "linebreak" },
        2: { cellWidth: 18 },
        3: { cellWidth: 9, halign: "center" },
        4: { cellWidth: 13, halign: "center" },
        5: { cellWidth: 17, halign: "center" },
        6: { cellWidth: 13, halign: "center" },
        7: { cellWidth: 13, halign: "center" },
        8: { cellWidth: 15, halign: "center" },
        9: { cellWidth: 11, halign: "right" },
        10: { cellWidth: 11, halign: "right" },
        11: { cellWidth: 11, halign: "right" },
        12: { cellWidth: 11, halign: "right" },
        13: { cellWidth: 22 },
        14: { cellWidth: 13, halign: "center" },
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

function KeywordCard({
  kw, onEdit, onDelete, onToggleActive, ranks,
}: {
  kw: KwRecord;
  onEdit: () => void;
  onDelete: () => void;
  ranks?: Partial<Record<string, RankCell>>;
  onToggleActive: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const initialLinks = ((kw as unknown as { links?: KeywordLink[] }).links ?? null);
  const [links, setLinks]       = useState<KeywordLink[] | null>(initialLinks);
  const [loading, setLoading]   = useState(initialLinks == null);
  const [saving, setSaving]     = useState(false);
  const [addOpen, setAddOpen]   = useState(false);
  const [editLink, setEditLink] = useState<KeywordLink | null>(null);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const r = await rawFetch(`/api/keywords/${kw.id}/links`, { credentials: "include" });
      setLinks(await r.json());
    } catch { setLinks([]); }
    finally { setLoading(false); }
  }, [kw.id]);

  useEffect(() => {
    if (initialLinks == null) fetchLinks();
  }, [fetchLinks, initialLinks]);

  async function addLink(data: Partial<KeywordLink>) {
    setSaving(true);
    try {
      const r = await rawFetch(`/api/keywords/${kw.id}/links`, {
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
      const r = await rawFetch(`/api/keywords/${kw.id}/links/${id}`, {
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
      await rawFetch(`/api/keywords/${kw.id}/links/${id}`, { method: "DELETE", credentials: "include" });
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
            {kw.clientId != null && kw.businessId != null && kw.aeoPlanId != null ? (
              <Link
                href={`/clients/${kw.clientId}/businesses/${kw.businessId}/campaigns/${kw.aeoPlanId}`}
                className="font-bold text-lg text-primary hover:underline leading-snug break-words"
              >
                {kw.keywordText as string}
              </Link>
            ) : (
              <p className="font-bold text-lg text-black dark:text-white leading-snug break-words">{kw.keywordText as string}</p>
            )}
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
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:text-blue-600 hover:bg-blue-100 transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
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
      <div className="px-4 pb-3 border-t border-slate-200 pt-3 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Search Count",           value: kw.initialSearchCount30Days  ?? 0 },
            { label: "Follow-up Search Count", value: kw.followupSearchCount30Days ?? 0 },
            { label: "Backlinks Click",        value: (kw as { backlinkClickCount30Days?: number | null }).backlinkClickCount30Days ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg px-3.5 py-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-800/50">
              <p className="text-xs uppercase tracking-widest text-slate-700 dark:text-slate-400 leading-tight mb-1.5">{label}</p>
              <p className="text-2xl font-bold tabular-nums text-black dark:text-white leading-none">{(value as number).toLocaleString()}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["chatgpt", "gemini", "perplexity"] as const).map((platform) => {
            const cell = ranks?.[platform];
            const hasPrev = cell?.previous != null;
            const curr = cell?.current;
            const prev = cell?.previous;
            const improved = hasPrev && curr != null && prev != null && curr < prev;
            const declined = hasPrev && curr != null && prev != null && curr > prev;

            const platformStyles: Record<string, { header: string; label: string }> = {
              chatgpt:    { header: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60", label: "text-emerald-700 dark:text-emerald-400" },
              gemini:     { header: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60",           label: "text-blue-700 dark:text-blue-400" },
              perplexity: { header: "bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800/60",   label: "text-violet-700 dark:text-violet-400" },
            };
            const ps = platformStyles[platform];

            const rankTierClass = (n: number | null | undefined): string => {
              if (n == null) return "text-slate-300 dark:text-slate-600";
              if (n <= 3)    return "text-emerald-600 dark:text-emerald-400";
              if (n <= 10)   return "text-blue-600 dark:text-blue-400";
              if (n <= 20)   return "text-amber-600 dark:text-amber-400";
              return "text-red-600 dark:text-red-400";
            };

            return (
              <div key={platform} className="rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800/50 overflow-hidden">
                <div className={`px-3 py-1.5 border-b ${ps.header}`}>
                  <p className={`text-[10px] uppercase tracking-widest font-bold capitalize ${ps.label}`}>{platform}</p>
                </div>
                <div className="px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[8px] uppercase tracking-wider text-slate-400 leading-tight mb-0.5">Current</p>
                    <div className="flex items-center gap-1.5">
                      <p className={`text-xl font-extrabold tabular-nums leading-none ${rankTierClass(curr)}`}>
                        {fmtRank(cell)}
                      </p>
                      {improved && <span className="text-emerald-500 text-xs font-bold">↑</span>}
                      {declined && <span className="text-red-500 text-xs font-bold">↓</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] uppercase tracking-wider text-slate-400 leading-tight mb-0.5">Initial</p>
                    <p className="text-xs tabular-nums text-slate-400 font-medium">{hasPrev ? `#${prev}` : "—"}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
                    { label: "Link URL", url: link.linkUrl },
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

/* ── Searchable combobox ────────────────────────────────── */
type ComboOption = { value: string; label: string; sublabel?: string };
function SearchableSelect({
  value, onChange, options, placeholder, allLabel, disabled, width = "w-56",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: ComboOption[];
  placeholder: string;
  allLabel: string;
  disabled?: boolean;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? options.find((o) => o.value === value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`${width} h-11 inline-flex items-center justify-between gap-2 px-3 text-sm font-bold rounded-md bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className="truncate text-left">
            {selected ? selected.label : <span className="text-slate-500">{placeholder}</span>}
          </span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" style={{ width: "var(--radix-popover-trigger-width)" }}>
        <Command>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`__all__ ${allLabel}`}
                onSelect={() => { onChange(null); setOpen(false); }}
              >
                <Check className={cn("mr-2 h-4 w-4", value == null ? "opacity-100" : "opacity-0")} />
                <span className="font-bold">{allLabel}</span>
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.sublabel ?? ""}`}
                  onSelect={() => { onChange(o.value); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="font-bold truncate">{o.label}</span>
                  {o.sublabel && <span className="text-slate-500 ml-1 truncate">· {o.sublabel}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════ */
export default function Keywords() {
  const [search,             setSearch]             = useState("");
  const [typeFilter,         setTypeFilter]         = useState<string>("all");
  const [selectedClientId,   setSelectedClientId]   = useState<number | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [bizTypeFilters,   setBizTypeFilters]   = useState<Map<number, string>>(new Map());
  const [expanded,         setExpanded]         = useState<Set<number>>(new Set());
  const [addOpen,          setAddOpen]          = useState(false);
  const [editKw,           setEditKw]           = useState<KwRecord | null>(null);
  const [confirmDeleteKw,  setConfirmDeleteKw]  = useState<KwRecord | null>(null);
  const [pendingCreate,    setPendingCreate]    = useState<KwRecord | null>(null);
  const [addForBusiness,   setAddForBusiness]   = useState<{ clientId: number; businessId: number } | null>(null);
  const [saving,           setSaving]           = useState(false);
  const [allPlans,         setAllPlans]         = useState<{ id: number; clientId: number; businessId: number | null; name: string | null; planType: string; searchAddress: string | null }[]>([]);
  const [businesses,       setBusinesses]       = useState<{ id: number; clientId: number; name: string; category: string | null; publishedAddress: string | null; status: string }[]>([]);

  useEffect(() => {
    rawFetch("/api/aeo-plans", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setAllPlans(Array.isArray(data) ? data : []))
      .catch(() => { /* silent */ });
    rawFetch("/api/businesses", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setBusinesses(Array.isArray(data) ? data : []))
      .catch(() => { /* silent */ });
  }, []);

  const plansMap = new Map(allPlans.map((p) => [p.id, p]));
  const businessesMap = new Map(businesses.map((b) => [b.id, b]));

  const { data: lifetimeRanks } = useQuery<{ rows: Array<{ keywordId: number; platform: string; currentPosition: number | null; previousPosition: number | null }> }>({
    queryKey: ["/api/ranking-reports/period-comparison", "weekly"],
    queryFn: async () => {
      const r = await rawFetch("/api/ranking-reports/period-comparison?period=weekly", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });
  const rankMap: RankMap = new Map();
  for (const row of lifetimeRanks?.rows ?? []) {
    let bucket = rankMap.get(row.keywordId);
    if (!bucket) { bucket = {}; rankMap.set(row.keywordId, bucket); }
    bucket[row.platform] = { current: row.currentPosition, previous: row.previousPosition };
  }

  function getBizTypeFilter(cid: number) { return bizTypeFilters.get(cid) ?? "all"; }
  function setBizTypeFilter(cid: number, v: string) {
    setBizTypeFilters((p) => { const n = new Map(p); n.set(cid, v); return n; });
  }

  const [targetKeywordId] = useState<number | null>(() => {
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const v = q.get("keywordId");
    return v ? Number(v) : null;
  });

  const { data: keywords, isLoading } = useQuery<KwRecord[]>({
    queryKey: ["/api/keywords", { clientId: selectedClientId, businessId: selectedBusinessId, aeoPlanId: selectedCampaignId }],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (selectedClientId   !== null) qs.set("clientId",   String(selectedClientId));
      if (selectedBusinessId !== null) qs.set("businessId", String(selectedBusinessId));
      if (selectedCampaignId !== null) qs.set("aeoPlanId",  String(selectedCampaignId));
      const r = await rawFetch(`/api/keywords${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });
  const { data: clients }             = useGetClients();
  const updateKeyword                 = useUpdateKeyword();
  const { toast }                     = useToast();
  const queryClient                   = useQueryClient();

  const clientsMap = new Map<number, string>((clients ?? []).map((c) => [c.id, c.businessName]));

  useEffect(() => {
    if (!targetKeywordId || !keywords) return;
    const kw = keywords.find((k) => k.id === targetKeywordId);
    if (!kw) return;
    const bizId = (kw.businessId as number | null) ?? -1;
    setExpanded((prev) => {
      if (prev.has(bizId)) return prev;
      const next = new Set(prev);
      next.add(bizId);
      return next;
    });
    requestAnimationFrame(() => {
      const el = document.getElementById(`kw-${targetKeywordId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [targetKeywordId, keywords]);

  async function saveKeyword(id: number | null, data: KwRecord) {
    setSaving(true);
    try {
      if (id) {
        const { linkUrl, linkTypeLabel, linkActive, initialRankReportLink, currentRankReportLink, links, ...kwFields } = data;
        await new Promise<void>((res, rej) =>
          updateKeyword.mutate({ id, data: kwFields }, { onSuccess: () => res(), onError: (e) => rej(e) }),
        );
        if (Number(kwFields.keywordType) === 4) {
          const existingLinks = Array.isArray(links) ? links as Array<{ id: number }> : [];
          const linkPayload = { linkUrl: linkUrl || null, linkTypeLabel: linkTypeLabel || null, linkActive: linkActive !== false, initialRankReportLink: initialRankReportLink || null, currentRankReportLink: currentRankReportLink || null };
          if (existingLinks.length > 0) {
            await rawFetch(`/api/keywords/${id}/links/${existingLinks[0].id}`, {
              method: "PATCH", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(linkPayload),
            });
          } else {
            await rawFetch(`/api/keywords/${id}/links`, {
              method: "POST", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(linkPayload),
            });
          }
        }
      } else {
        const { linkUrl, linkTypeLabel, linkActive, initialRankReportLink, currentRankReportLink, ...kwData } = data;
        const r = await rawFetch(`/api/keywords`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...kwData,
            clientId:   Number(kwData.clientId),
            businessId: kwData.businessId != null && kwData.businessId !== "" ? Number(kwData.businessId) : null,
            aeoPlanId:  kwData.aeoPlanId  != null && kwData.aeoPlanId  !== "" ? Number(kwData.aeoPlanId)  : null,
          }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
        const newKw = await r.json();
        // If type 4, always create a link row so it shows in Associated Links
        if (Number(kwData.keywordType) === 4) {
          const lr = await rawFetch(`/api/keywords/${newKw.id}/links`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ linkUrl: linkUrl || null, linkTypeLabel: linkTypeLabel || null, linkActive, initialRankReportLink: initialRankReportLink || null, currentRankReportLink: currentRankReportLink || null }),
          });
          if (!lr.ok) throw new Error((await lr.json()).error ?? "Failed to save link");
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: id ? "Keyword updated" : "Keyword added" });
      setEditKw(null); setAddOpen(false); setAddForBusiness(null);
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteKeyword(id: number) {
    try {
      await rawFetch(`/api/keywords/${id}`, { method: "DELETE", credentials: "include" });
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: "Keyword deleted" });
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  function requestCreate(data: KwRecord) {
    setPendingCreate(data);
  }
  async function confirmCreate() {
    const data = pendingCreate;
    if (!data) return;
    setPendingCreate(null);
    await saveKeyword(null, data);
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
  const searchLower  = search.trim().toLowerCase();
  const planById     = new Map(allPlans.map((p) => [p.id, p]));
  const bizById      = new Map(businesses.map((b) => [b.id, b]));
  const filteredKws  = ((keywords ?? []) as unknown as KwRecord[]).filter((k: KwRecord) => {
    const matchType = typeFilter === "all" || String(k.keywordType) === typeFilter;
    if (!matchType) return false;
    if (!searchLower) return true;
    const clientName   = clientsMap.get(k.clientId as number) ?? "";
    const businessName = k.businessId != null ? bizById.get(k.businessId as number)?.name ?? "" : "";
    const planRow      = k.aeoPlanId != null ? planById.get(k.aeoPlanId as number) : undefined;
    const campaignName = planRow ? (planRow.name ?? planRow.planType ?? "") : "";
    const haystack = `${k.keywordText ?? ""} ${clientName} ${businessName} ${campaignName}`.toLowerCase();
    return haystack.includes(searchLower);
  });

  // Auto-expand business cards that contain matches whenever the search has a query
  useEffect(() => {
    if (!searchLower) return;
    const bids = new Set<number>();
    for (const k of filteredKws) bids.add((k.businessId as number | null) ?? 0);
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      bids.forEach((b) => { if (!next.has(b)) { next.add(b); changed = true; } });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLower, keywords]);

  /* Group by business (null → "Unassigned" bucket keyed as 0) */
  const UNASSIGNED_BID = 0;
  const grouped = new Map<number, KwRecord[]>();
  for (const kw of filteredKws) {
    const bid = (kw.businessId as number | null) ?? UNASSIGNED_BID;
    if (!grouped.has(bid)) grouped.set(bid, []);
    grouped.get(bid)!.push(kw);
  }

  /* Stats */
  const all      = keywords ?? [] as KwRecord[];
  const total    = all.length;
  const active   = all.filter((k: KwRecord) => k.isActive !== false).length;
  const type3    = all.filter((k: KwRecord) => Number(k.keywordType) === 3).length;
  const type4    = all.filter((k: KwRecord) => Number(k.keywordType) === 4).length;

  /* Exports — now keyed by business, not client */
  const stamp        = format(new Date(), "yyyy-MM-dd");
  const exportAllCSV = () => exportCSV(filteredKws, businessesMap, clientsMap, plansMap, rankMap, `aeo-keywords-${stamp}.csv`);
  const exportAllPDF = () => exportPDF(filteredKws, businessesMap, clientsMap, plansMap, rankMap, `aeo-keywords-${stamp}.pdf`, `All businesses · ${filteredKws.length} keywords`);
  const exportBizCSV = (businessId: number, kws: KwRecord[]) => {
    const name = businessesMap.get(businessId)?.name ?? "business";
    exportCSV(kws, businessesMap, clientsMap, plansMap, rankMap, `${name.replace(/\s+/g, "-").toLowerCase()}-keywords-${stamp}.csv`);
  };
  const exportBizPDF = (businessId: number, kws: KwRecord[]) => {
    const name = businessesMap.get(businessId)?.name ?? `Business #${businessId}`;
    exportPDF(kws, businessesMap, clientsMap, plansMap, rankMap, `${name.replace(/\s+/g, "-").toLowerCase()}-keywords-${stamp}.pdf`, `${name} · ${kws.length} keywords`);
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

      {/* Cascade filter: Client → Business → Campaign */}
      {(() => {
        const bizInScope  = businesses.filter((b) => selectedClientId === null || b.clientId === selectedClientId);
        const planInScope = allPlans.filter((p) =>
          (selectedClientId === null   || p.clientId   === selectedClientId) &&
          (selectedBusinessId === null || p.businessId === selectedBusinessId),
        );
        return (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3">
            <Building2 className="w-5 h-5 text-slate-600 dark:text-slate-400 flex-shrink-0 ml-1" />

            <SearchableSelect
              value={selectedClientId !== null ? String(selectedClientId) : null}
              onChange={(v) => {
                const next = v == null ? null : Number(v);
                setSelectedClientId(next);
                setSelectedBusinessId(null);
                setSelectedCampaignId(null);
                setExpanded(new Set());
              }}
              options={(clients ?? []).map((c) => ({ value: String(c.id), label: c.businessName }))}
              placeholder="All Clients"
              allLabel="All Clients"
            />

            <span className="text-slate-400">›</span>

            <SearchableSelect
              value={selectedBusinessId !== null ? String(selectedBusinessId) : null}
              onChange={(v) => {
                const next = v == null ? null : Number(v);
                setSelectedBusinessId(next);
                setSelectedCampaignId(null);
                if (next !== null) setExpanded(new Set([next]));
              }}
              options={bizInScope.map((b) => ({ value: String(b.id), label: b.name }))}
              placeholder="All Businesses"
              allLabel="All Businesses"
              disabled={bizInScope.length === 0}
            />

            <span className="text-slate-400">›</span>

            <SearchableSelect
              value={selectedCampaignId !== null ? String(selectedCampaignId) : null}
              onChange={(v) => setSelectedCampaignId(v == null ? null : Number(v))}
              options={planInScope.map((p) => ({ value: String(p.id), label: p.name ?? p.planType, sublabel: p.planType }))}
              placeholder="All Campaigns"
              allLabel="All Campaigns"
              disabled={planInScope.length === 0}
              width="w-64"
            />

            {(selectedClientId !== null || selectedBusinessId !== null || selectedCampaignId !== null) && (
              <button
                onClick={() => { setSelectedClientId(null); setSelectedBusinessId(null); setSelectedCampaignId(null); setExpanded(new Set()); }}
                className="flex items-center gap-1.5 ml-auto text-sm text-slate-600 hover:text-slate-900 dark:hover:text-white font-bold"
              >
                <X className="w-4 h-4" /> Clear filters
              </button>
            )}
          </div>
        );
      })()}

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
          <Input type="search" placeholder="Search keyword…"
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
        {(search || typeFilter !== "all") && (
          <button onClick={() => { setSearch(""); setTypeFilter("all"); }}
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
          {(() => {
            const sortedEntries = Array.from(grouped.entries()).sort(([aBid, aKws], [bBid, bKws]) => {
              const aBiz = aBid === UNASSIGNED_BID ? null : businessesMap.get(aBid);
              const bBiz = bBid === UNASSIGNED_BID ? null : businessesMap.get(bBid);
              const aCid = aBiz?.clientId ?? (aKws[0]?.clientId as number);
              const bCid = bBiz?.clientId ?? (bKws[0]?.clientId as number);
              const aCName = clients?.find((c) => c.id === aCid)?.businessName ?? `Client #${aCid}`;
              const bCName = clients?.find((c) => c.id === bCid)?.businessName ?? `Client #${bCid}`;
              return aCName.localeCompare(bCName) || (aBiz?.name ?? "").localeCompare(bBiz?.name ?? "");
            });
            const showClientDividers = selectedClientId === null && sortedEntries.length > 0;
            let lastClientId: number | null = null;
            return sortedEntries.flatMap(([businessId, kws]) => {
            const biz          = businessId === UNASSIGNED_BID ? null : businessesMap.get(businessId);
            const clientId     = biz?.clientId ?? (kws[0]?.clientId as number);
            const client       = clients?.find((c) => c.id === clientId);
            const displayName  = biz?.name ?? (businessId === UNASSIGNED_BID ? "Unassigned" : `Business #${businessId}`);
            const clientName   = client?.businessName ?? `Client #${clientId}`;
            const needDivider  = showClientDividers && clientId !== lastClientId;
            lastClientId = clientId;
            const clientBizCount = sortedEntries.filter(([bid, bkws]) => {
              const b = bid === UNASSIGNED_BID ? null : businessesMap.get(bid);
              return (b?.clientId ?? (bkws[0]?.clientId as number)) === clientId;
            }).length;
            const isOpen       = expanded.has(businessId);
            const initials     = displayName.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
            const activeCount  = kws.filter((k) => k.isActive !== false).length;
            const bizFilter    = getBizTypeFilter(businessId);
            const displayedKws = bizFilter === "all" ? kws : kws.filter((k) => String(k.keywordType) === bizFilter);

            const nodes: React.ReactNode[] = [];
            if (needDivider) {
              nodes.push(
                <div key={`client-${clientId}`} className="flex items-center gap-3 pt-2 first:pt-0">
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                  <Link
                    href={`/clients/${clientId}`}
                    className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    <Building2 className="w-4 h-4" />
                    {clientName}
                    <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-200 normal-case tracking-normal">
                      {clientBizCount} {clientBizCount === 1 ? "business" : "businesses"}
                    </span>
                  </Link>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                </div>,
              );
            }
            nodes.push(
              <div key={businessId} className="rounded-xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900 shadow-md">

                {/* Business header */}
                <div className={`flex items-center gap-0 transition-colors ${isOpen ? "bg-slate-50 dark:bg-slate-800 border-b border-blue-300 dark:border-blue-700" : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"}`}>
                  <button
                    onClick={() => setExpanded((p) => { const n = new Set(p); n.has(businessId) ? n.delete(businessId) : n.add(businessId); return n; })}
                    className={`flex items-center gap-3 px-4 py-4 flex-1 min-w-0 text-left border-r border-slate-300 dark:border-slate-700 transition-colors ${isOpen ? "text-blue-600 font-bold" : "text-slate-700 dark:text-slate-300 hover:text-black dark:hover:text-white"}`}>
                    <div className={`w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${isOpen ? "bg-blue-100 text-blue-600" : "bg-blue-50 text-blue-600"}`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col gap-0.5">
                        {biz ? (
                          <Link
                            href={`/clients/${clientId}/businesses/${businessId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-bold text-base text-primary hover:underline w-fit"
                          >
                            {displayName}
                          </Link>
                        ) : (
                          <span className="font-bold text-base text-slate-500 italic">{displayName}</span>
                        )}
                        <Link
                          href={`/clients/${clientId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-slate-500 dark:text-slate-400 hover:underline w-fit"
                        >
                          <span className="font-bold uppercase tracking-wide">Client:</span> {clientName}
                        </Link>
                        {biz?.publishedAddress && <span className="text-xs text-slate-500 dark:text-slate-400"><span className="font-bold uppercase tracking-wide">GMB address:</span> {biz.publishedAddress}</span>}
                        {(() => {
                          const addrs = Array.from(new Set(
                            allPlans
                              .filter((p) => p.businessId === businessId && p.searchAddress && p.searchAddress.trim())
                              .map((p) => p.searchAddress as string)
                          ));
                          if (addrs.length === 0) return null;
                          return (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-bold uppercase tracking-wide">Search address:</span> {addrs.join(", ")}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-base text-slate-600 dark:text-slate-400">{displayedKws.length}{displayedKws.length !== kws.length ? `/${kws.length}` : ""} keyword{kws.length !== 1 ? "s" : ""}</span>
                        <span className="text-slate-400 dark:text-slate-600">·</span>
                        {biz?.status === "inactive" ? (
                          <span className="inline-flex items-center rounded-full bg-slate-200 dark:bg-slate-700 px-2.5 py-0.5 text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Business inactive</span>
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
                    <button onClick={() => exportBizCSV(businessId, kws)}
                      className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-bold border-2 border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 rounded-lg px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all">
                      <Download className="w-5 h-5" /> CSV
                    </button>
                    <button onClick={() => exportBizPDF(businessId, kws)}
                      className="flex items-center gap-2 text-base text-red-600 hover:text-red-700 font-bold border-2 border-red-300 hover:border-red-400 rounded-lg px-4 py-2 hover:bg-red-50 transition-all">
                      <FileDown className="w-5 h-5" /> PDF
                    </button>
                    {biz && (
                      <button onClick={(e) => { e.stopPropagation(); setAddForBusiness({ clientId, businessId }); }}
                        className="flex items-center gap-2 text-base text-emerald-600 hover:text-emerald-700 font-bold border-2 border-emerald-300 hover:border-emerald-400 rounded-lg px-4 py-2 hover:bg-emerald-50 transition-all">
                        <Plus className="w-5 h-5" /> Add Keyword
                      </button>
                    )}
                    {biz && (
                      <Link href={`/clients/${clientId}/businesses/${businessId}`}
                        className="flex items-center gap-2 text-base text-blue-600 hover:text-blue-700 font-bold border-2 border-blue-300 hover:border-blue-400 rounded-lg px-4 py-2 hover:bg-blue-50 transition-all">
                        <Building2 className="w-5 h-5" /> Profile
                      </Link>
                    )}
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
                        <button key={t.id} onClick={() => setBizTypeFilter(businessId, t.id)}
                          className={`px-3 py-1.5 rounded-full text-sm font-bold border-2 transition-all ${
                            bizFilter === t.id
                              ? (t.id === "4" ? "bg-emerald-600 text-white border-emerald-600" : "bg-blue-600 text-white border-blue-600")
                              : "border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-400 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900"
                          }`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {displayedKws.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-3 m-4">
                        <Key className="w-4 h-4 text-slate-500" />
                        <p className="text-sm text-slate-500 italic">No keywords match this filter</p>
                      </div>
                    ) : (() => {
                      /* Group keywords by campaign (aeoPlanId) */
                      const byCampaign = new Map<number | null, KwRecord[]>();
                      for (const kw of displayedKws) {
                        const pid = (kw.aeoPlanId as number | null) ?? null;
                        if (!byCampaign.has(pid)) byCampaign.set(pid, []);
                        byCampaign.get(pid)!.push(kw);
                      }
                      /* Sort: named campaigns first (ascending id), then null */
                      const entries = Array.from(byCampaign.entries()).sort(([a], [b]) => {
                        if (a === null) return 1;
                        if (b === null) return -1;
                        return (a as number) - (b as number);
                      });
                      return entries.map(([planId, planKws]) => {
                        const plan = planId != null ? plansMap.get(planId) : null;
                        return (
                          <div key={planId ?? "unassigned"} className="border-t border-slate-200 dark:border-slate-700 first:border-t-0">
                            {/* Campaign sub-header */}
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60">
                              <Bookmark className={`w-3.5 h-3.5 flex-shrink-0 ${plan ? "text-blue-500" : "text-slate-400"}`} />
                              {plan && biz ? (
                                <>
                                  <Link href={`/clients/${clientId}/businesses/${businessId}/campaigns/${plan.id}`} className="text-sm font-bold text-blue-700 dark:text-blue-400 hover:underline">
                                    {plan.name ?? plan.planType}
                                  </Link>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">· {plan.planType}</span>
                                </>
                              ) : (
                                <span className="text-sm text-slate-500 dark:text-slate-400 italic">No campaign assigned</span>
                              )}
                              <span className="ml-auto text-xs font-bold text-slate-500 dark:text-slate-400">{planKws.length} keyword{planKws.length !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="p-4 space-y-4">
                              {planKws.map((kw) => (
                                <div
                                  key={kw.id as number}
                                  id={`kw-${kw.id}`}
                                  className={targetKeywordId === kw.id ? "ring-2 ring-primary rounded-lg" : ""}
                                >
                                  <KeywordCard
                                    kw={kw}
                                    ranks={rankMap.get(kw.id as number)}
                                    onEdit={() => setEditKw({ ...kw })}
                                    onDelete={() => setConfirmDeleteKw(kw)}
                                    onToggleActive={(v) => toggleActive(kw, v)}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>,
            );
            return nodes;
          });
          })()}
        </div>
      )}

      {/* Add keyword dialog */}
      <KeywordDialog
        open={addOpen} onOpenChange={setAddOpen}
        title="Add Keyword" saving={saving}
        clients={clients}
        businesses={businesses}
        plans={allPlans}
        defaultClientId={selectedClientId ?? undefined}
        onSave={(data) => requestCreate(data)}
      />

      {/* Edit keyword dialog */}
      {editKw && (
        <KeywordDialog
          open onOpenChange={(o) => { if (!o) setEditKw(null); }}
          title="Edit Keyword" saving={saving}
          initial={editKw}
          clients={clients}
          businesses={businesses}
          plans={allPlans}
          onSave={(data) => saveKeyword(editKw.id as number, data)}
        />
      )}

      {/* Add keyword for a specific business */}
      {addForBusiness !== null && (
        <KeywordDialog
          open onOpenChange={(o) => { if (!o) setAddForBusiness(null); }}
          title="Add Keyword" saving={saving}
          clients={clients}
          businesses={businesses}
          plans={allPlans}
          defaultClientId={addForBusiness.clientId}
          defaultBusinessId={addForBusiness.businessId}
          onSave={(data) => requestCreate(data)}
        />
      )}

      {/* Confirm create */}
      <AlertDialog open={!!pendingCreate} onOpenChange={(o) => { if (!o) setPendingCreate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create this keyword?</AlertDialogTitle>
            <AlertDialogDescription>
              Add <strong>"{pendingCreate?.keywordText as string}"</strong> as a new keyword? You can edit or delete it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingCreate(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmCreate()}>Yes, create</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete */}
      <AlertDialog open={!!confirmDeleteKw} onOpenChange={(o) => { if (!o) setConfirmDeleteKw(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this keyword?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>"{confirmDeleteKw?.keywordText as string}"</strong> and any associated links. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeleteKw(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDeleteKw) {
                  const id = confirmDeleteKw.id as number;
                  setConfirmDeleteKw(null);
                  deleteKeyword(id);
                }
              }}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
