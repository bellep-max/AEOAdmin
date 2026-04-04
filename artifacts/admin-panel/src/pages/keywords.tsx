import React, { useState } from "react";
import { useGetKeywords, useUpdateKeyword, useGetClients, useGetInitialVsCurrentRankings } from "@workspace/api-client-react";
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
  Building2, ExternalLink, Pencil, Trash2, Calendar, ChevronDown,
  Download, FileText, ChevronRight, FileDown,
} from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const LINK_TYPES = ["GBP snippet", "Client website blog post", "External article", "Other"];

type KwRecord = Record<string, unknown>;

type RankMap = Map<number, { initialPosition: number | null; currentPosition: number | null; positionChange: number | null }>;

/* ── CSV export helper ── */
function exportCSV(rows: KwRecord[], clientsMap: Map<number, string>, filename: string, kwRankMap?: RankMap) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = [
    "Business", "Keyword", "Keyword Type", "Primary (1st)", "Active",
    "Date Added",
    "Initial Rank Position", "Current Rank Position", "Position Change",
    "Initial Search Count (30 Days)", "Follow-up Search Count (30 Days)",
    "Initial Search Count (Lifetime)", "Follow-up Search Count (Lifetime)",
    "Link Type Label", "Link Active",
    "Initial Rank Report Link", "Current Rank Report Link",
  ];
  const lines = rows.map((kw) => {
    const type  = kw.keywordType === 2 ? "Type 2 – Backlink" : "Type 1 – Geo Specific";
    const date  = kw.dateAdded ? format(new Date(kw.dateAdded as string), "yyyy-MM-dd") : "";
    const biz   = clientsMap.get(kw.clientId as number) ?? "";
    const rank  = kwRankMap?.get(kw.id as number);
    const initPos = rank?.initialPosition ?? null;
    const currPos = rank?.currentPosition ?? null;
    const chg     = rank?.positionChange  ?? null;
    return [
      esc(biz), esc(kw.keywordText), esc(type),
      esc(kw.isPrimary ? "Yes" : "No"),
      esc(kw.isActive  ? "Active" : "Inactive"),
      esc(date),
      esc(initPos != null ? `#${initPos}` : ""),
      esc(currPos != null ? `#${currPos}` : ""),
      esc(chg     != null ? (chg > 0 ? `+${chg}` : String(chg)) : ""),
      kw.initialSearchCount30Days  ?? 0,
      kw.followupSearchCount30Days ?? 0,
      kw.initialSearchCountLife    ?? 0,
      kw.followupSearchCountLife   ?? 0,
      esc(kw.linkTypeLabel ?? ""),
      esc((kw.linkActive as boolean) !== false ? "Active" : "Inactive"),
      esc(kw.initialRankReportLink  ?? ""),
      esc(kw.currentRankReportLink  ?? ""),
    ].join(",");
  });
  const csv  = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ── PDF export helper ── */
function exportPDF(
  rows: KwRecord[],
  clientsMap: Map<number, string>,
  filename: string,
  title: string,
  kwRankMap?: RankMap,
) {
  const doc    = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();

  /* ── Cover header ── */
  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageW, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Signal AEO — Keyword Performance Report", 10, 11);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text(title, 10, 18);
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}`, pageW - 10, 18, { align: "right" });

  /* ── Group by business ── */
  const grouped = new Map<string, KwRecord[]>();
  for (const kw of rows) {
    const biz = clientsMap.get(kw.clientId as number) ?? `Business #${kw.clientId}`;
    if (!grouped.has(biz)) grouped.set(biz, []);
    grouped.get(biz)!.push(kw);
  }

  let startY = 30;

  grouped.forEach((kws, bizName) => {
    /* ── Business section heading ── */
    if (startY > pageH - 40) { doc.addPage(); startY = 15; }
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 100, 220);
    doc.text(`${bizName}`, 10, startY);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 130, 150);
    doc.text(`${kws.length} keyword${kws.length !== 1 ? "s" : ""}`, 10, startY + 4);
    startY += 8;

    const tableRows = kws.map((kw) => {
      const type    = kw.keywordType === 2 ? "Type 2 – Backlink" : "Type 1 – Geo Specific";
      const date    = kw.dateAdded ? format(new Date(kw.dateAdded as string), "MMM d, yyyy") : "—";
      const primary = kw.isPrimary ? "Yes (Primary)" : "No";
      const active  = kw.isActive  ? "Active" : "Inactive";
      const lActive = (kw.linkActive as boolean) !== false ? "Active" : "Inactive";
      const rank    = kwRankMap?.get(kw.id as number);
      const initPos = rank?.initialPosition ?? null;
      const currPos = rank?.currentPosition ?? null;
      const chg     = rank?.positionChange  ?? null;
      return [
        kw.keywordText as string,
        type,
        primary,
        active,
        date,
        initPos != null ? `#${initPos}` : "—",
        currPos != null ? `#${currPos}` : "—",
        chg     != null ? (chg > 0 ? `+${chg}` : String(chg)) : "—",
        String(kw.initialSearchCount30Days  ?? 0),
        String(kw.followupSearchCount30Days ?? 0),
        String(kw.initialSearchCountLife    ?? 0),
        String(kw.followupSearchCountLife   ?? 0),
        (kw.linkTypeLabel as string) || "—",
        lActive,
        (kw.initialRankReportLink  as string) || "—",
        (kw.currentRankReportLink  as string) || "—",
      ];
    });

    autoTable(doc, {
      startY,
      head: [[
        "Keyword",
        "Keyword Type",
        "Primary (1st)",
        "Active",
        "Date Added",
        "Initial Rank",
        "Current Rank",
        "Position Change",
        "Initial Search (30 Days)",
        "Follow-up Search (30 Days)",
        "Initial Search (Lifetime)",
        "Follow-up Search (Lifetime)",
        "Link Type Label",
        "Link Active",
        "Initial Rank Report Link",
        "Current Rank Report Link",
      ]],
      body: tableRows,
      theme: "striped",
      headStyles: {
        fillColor: [17, 24, 39],
        textColor: [180, 200, 230],
        fontSize: 6.5,
        fontStyle: "bold",
        cellPadding: 2,
      },
      bodyStyles: {
        fontSize: 6.5,
        cellPadding: 1.8,
        textColor: [30, 30, 50],
      },
      alternateRowStyles: { fillColor: [245, 247, 252] },
      columnStyles: {
        0:  { cellWidth: 38 },                        // Keyword
        1:  { cellWidth: 26 },                        // Keyword Type
        2:  { cellWidth: 18, halign: "center" },      // Primary
        3:  { cellWidth: 14, halign: "center" },      // Active
        4:  { cellWidth: 20, halign: "center" },      // Date Added
        5:  { cellWidth: 15, halign: "center" },      // Initial Rank
        6:  { cellWidth: 15, halign: "center" },      // Current Rank
        7:  { cellWidth: 16, halign: "center" },      // Position Change
        8:  { cellWidth: 16, halign: "right" },       // Init 30d
        9:  { cellWidth: 16, halign: "right" },       // F/U 30d
        10: { cellWidth: 16, halign: "right" },       // Init Life
        11: { cellWidth: 16, halign: "right" },       // F/U Life
        12: { cellWidth: 22 },                        // Link Type
        13: { cellWidth: 14, halign: "center" },      // Link Active
        14: { cellWidth: "auto", overflow: "ellipsize" }, // Initial report link
        15: { cellWidth: "auto", overflow: "ellipsize" }, // Current report link
      },
      margin: { left: 10, right: 10 },
      didParseCell: (data) => {
        /* colour Position Change column */
        if (data.section === "body" && data.column.index === 7) {
          const v = String(data.cell.raw ?? "");
          if (v.startsWith("+")) data.cell.styles.textColor = [22, 163, 74];
          else if (v.startsWith("-")) data.cell.styles.textColor = [220, 38, 38];
        }
      },
      didDrawPage: (data) => {
        const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(
          `Signal AEO Admin Panel  ·  Confidential  ·  Page ${data.pageNumber} of ${pageCount}`,
          pageW / 2, pageH - 5, { align: "center" },
        );
      },
    });

    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

    /* page break between businesses if not enough room */
    if (startY > 185 && grouped.size > 1) {
      doc.addPage();
      startY = 15;
    }
  });

  doc.save(filename);
}

/* ──────────────────────────────────────── */
/* Keyword add / edit dialog               */
/* ──────────────────────────────────────── */
function KeywordDialog({
  open, onOpenChange, title, saving, initial, clients, onSave,
}: {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  title:        string;
  saving:       boolean;
  initial?:     KwRecord;
  clients?:     { id: number; businessName: string; city?: string | null; state?: string | null }[];
  onSave:       (data: KwRecord) => void;
}) {
  const blank: KwRecord = {
    clientId: "", keywordText: "", keywordType: "1", isPrimary: "0", isActive: true,
    linkTypeLabel: "", linkActive: true, initialRankReportLink: "", currentRankReportLink: "",
    initialSearchCount30Days: 0, followupSearchCount30Days: 0,
    initialSearchCountLife:   0, followupSearchCountLife:   0,
  };

  const [vals, setVals] = useState<KwRecord>(initial ?? blank);
  function set(k: string, v: unknown) { setVals((p) => ({ ...p, [k]: v })); }
  const isEdit = !!initial;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setVals(initial ?? blank); }}>
      <DialogContent className="w-screen h-screen max-w-full max-h-screen rounded-none border-0 bg-[hsl(222,47%,9%)] flex flex-col p-0 gap-0">
        {/* ── Full-screen header ── */}
        <DialogHeader className="shrink-0 border-b border-border/40 bg-[hsl(222,47%,8%)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Fill in all fields and save when done</p>
            </div>
          </div>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl w-full mx-auto">

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

          {/* Keyword type */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase text-muted-foreground/60 tracking-wide">Keyword Type <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "1", label: "Type 1 — Geo Specific",  desc: "60% budget · 100% search rate",  icon: MapPin, accent: "border-primary/50 bg-primary/10 text-primary" },
                { value: "2", label: "Type 2 — Backlink",       desc: "10% budget · 1st keyword only",  icon: Link2,  accent: "border-amber-400/50 bg-amber-500/10 text-amber-400" },
              ].map((opt) => {
                const Icon = opt.icon;
                const sel  = String(vals.keywordType) === opt.value;
                return (
                  <button key={opt.value} type="button" onClick={() => set("keywordType", opt.value)}
                    className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-all ${
                      sel ? opt.accent : "border-border/50 bg-muted/20 text-muted-foreground hover:border-border/80"
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

          {/* Primary + Active toggles */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: "isPrimary", label: "Primary (1st)", sub: "Mark as primary keyword",
                checked: vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true,
                onChange: (v: boolean) => set("isPrimary", v ? "1" : "0"), cls: "data-[state=checked]:bg-amber-500" },
              { k: "isActive", label: "Active", sub: "Enable for campaigns",
                checked: vals.isActive !== false,
                onChange: (v: boolean) => set("isActive", v), cls: "data-[state=checked]:bg-emerald-500" },
            ].map((row) => (
              <div key={row.k} className="flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg p-3">
                <div className="flex-1">
                  <p className="text-xs font-medium">{row.label}</p>
                  <p className="text-[10px] text-muted-foreground">{row.sub}</p>
                </div>
                <Switch checked={row.checked} onCheckedChange={row.onChange} className={row.cls} />
              </div>
            ))}
          </div>

          {/* Search counts */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 mb-2">Search Counts</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { k: "initialSearchCount30Days",  label: "Initial · 30d" },
                { k: "followupSearchCount30Days", label: "Follow-up · 30d" },
                { k: "initialSearchCountLife",    label: "Initial · Life" },
                { k: "followupSearchCountLife",   label: "Follow-up · Life" },
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
          <div className="border border-border/40 rounded-xl p-4 space-y-3 bg-muted/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">Associated Links</p>
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
                <Switch checked={vals.linkActive !== false} onCheckedChange={(v) => set("linkActive", v)}
                  className="data-[state=checked]:bg-emerald-500 scale-75" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { k: "initialRankReportLink",  label: "Initial Rank Report Link" },
                { k: "currentRankReportLink",  label: "Current Rank Report Link" },
              ].map(({ k, label }) => (
                <div key={k} className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60 flex items-center gap-1">
                    <Link2 className="w-3 h-3" /> {label}
                  </Label>
                  <Input className="bg-muted/30 border-border/60 h-9 text-xs font-mono"
                    placeholder="https://…"
                    value={(vals[k] as string) || ""}
                    onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        </div>{/* end scrollable body */}

        {/* ── Sticky footer ── */}
        <div className="shrink-0 border-t border-border/40 bg-[hsl(222,47%,8%)] px-6 py-4">
          <div className="flex gap-3 max-w-3xl mx-auto">
            <Button variant="outline" className="flex-1 border-border/50"
              onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1 gap-2"
              disabled={saving || !(vals.keywordText as string)?.trim() || (!isEdit && !vals.clientId)}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────────────── */
/* Link sub-row (expandable)               */
/* ──────────────────────────────────────── */
function LinkRow({ kw, onToggle }: { kw: KwRecord; onToggle: (v: boolean) => void }) {
  const linkActive = (kw.linkActive as boolean) !== false;
  const links = [
    { label: "Initial Rank Report",  url: kw.initialRankReportLink as string },
    { label: "Current Rank Report",  url: kw.currentRankReportLink as string },
  ];
  return (
    <tr className="bg-[hsl(222,47%,9%)]">
      <td colSpan={11} className="px-4 py-3">
        <div className="flex flex-wrap items-start gap-6 pl-2">
          <div className="flex items-center gap-2 flex-shrink-0">
            <FileText className="w-3.5 h-3.5 text-violet-400" />
            {(kw.linkTypeLabel as string) ? (
              <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/20">
                {kw.linkTypeLabel as string}
              </Badge>
            ) : (
              <span className="text-[11px] text-muted-foreground/40 italic">No link type</span>
            )}
            <span className="text-muted-foreground/30 text-xs">|</span>
            <span className="text-[11px] text-muted-foreground">Link:</span>
            <Switch checked={linkActive} onCheckedChange={onToggle}
              className="data-[state=checked]:bg-emerald-500 scale-75" />
            <span className={`text-[10px] font-medium ${linkActive ? "text-emerald-400" : "text-muted-foreground/40"}`}>
              {linkActive ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 flex-1">
            {links.map(({ label, url }) => (
              <div key={label} className="min-w-0">
                <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wide mb-0.5">{label}</p>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 max-w-[280px]">
                    <Link2 className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{url}</span>
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
                  </a>
                ) : (
                  <span className="text-[11px] text-muted-foreground/30 italic">Not set</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

/* ──────────────────────────────────────── */
/* Main page                               */
/* ──────────────────────────────────────── */
export default function Keywords() {
  const [search,       setSearch]       = useState("");
  const [typeFilter,   setTypeFilter]   = useState<string>("all");
  const [expanded,     setExpanded]     = useState<Set<number>>(new Set());
  const [linkExpanded, setLinkExpanded] = useState<Set<number>>(new Set());
  const [addOpen,      setAddOpen]      = useState(false);
  const [editKw,       setEditKw]       = useState<null | KwRecord>(null);
  const [saving,       setSaving]       = useState(false);

  const { data: keywords, isLoading } = useGetKeywords();
  const { data: clients }             = useGetClients();
  const { data: rankingData }         = useGetInitialVsCurrentRankings();
  const updateKeyword                 = useUpdateKeyword();
  const { toast }                     = useToast();
  const queryClient                   = useQueryClient();

  /* ── Clients map ── */
  const clientsMap = new Map<number, string>(
    (clients ?? []).map((c) => [c.id, c.businessName]),
  );

  /* ── Rankings map: keywordId → { initialPosition, currentPosition, positionChange } ── */
  type RankEntry = { initialPosition: number | null; currentPosition: number | null; positionChange: number | null };
  const kwRankMap = new Map<number, RankEntry>();
  for (const r of (rankingData ?? []) as { keywordId: number; initialPosition: number | null; currentPosition: number | null; positionChange: number | null }[]) {
    kwRankMap.set(r.keywordId, {
      initialPosition: r.initialPosition ?? null,
      currentPosition: r.currentPosition ?? null,
      positionChange:  r.positionChange  ?? null,
    });
  }

  /* ── Save ── */
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
    } catch (err: unknown) {
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

  function toggleExpand(clientId: number) {
    setExpanded((p) => { const n = new Set(p); n.has(clientId) ? n.delete(clientId) : n.add(clientId); return n; });
  }
  function toggleLink(kwId: number) {
    setLinkExpanded((p) => { const n = new Set(p); n.has(kwId) ? n.delete(kwId) : n.add(kwId); return n; });
  }

  /* ── Filter ── */
  const searchLower = search.toLowerCase();
  const filteredKws = (keywords ?? [] as KwRecord[]).filter((k: KwRecord) => {
    const matchText   = (k.keywordText as string).toLowerCase().includes(searchLower);
    const client      = clients?.find((c) => c.id === k.clientId);
    const matchClient = client ? (client.businessName ?? "").toLowerCase().includes(searchLower) : true;
    const matchType   = typeFilter === "all" || String(k.keywordType) === typeFilter;
    return (matchText || matchClient) && matchType;
  });

  /* ── Group by client ── */
  const grouped = new Map<number, KwRecord[]>();
  for (const kw of filteredKws) {
    const cid = kw.clientId as number;
    if (!grouped.has(cid)) grouped.set(cid, []);
    grouped.get(cid)!.push(kw);
  }

  /* ── Stats ── */
  const allKws     = keywords ?? [] as KwRecord[];
  const totalKws   = allKws.length;
  const activeKws  = allKws.filter((k: KwRecord) => k.isActive).length;
  const type1Count = allKws.filter((k: KwRecord) => k.keywordType === 1).length;
  const type2Count = allKws.filter((k: KwRecord) => k.keywordType === 2).length;

  /* ── Export helpers ── */
  const dateStamp = format(new Date(), "yyyy-MM-dd");

  function exportAllCSV() {
    exportCSV(filteredKws as KwRecord[], clientsMap, `aeo-keywords-${dateStamp}.csv`, kwRankMap);
  }
  function exportAllPDF() {
    exportPDF(
      filteredKws as KwRecord[], clientsMap,
      `aeo-keywords-${dateStamp}.pdf`,
      `All businesses · ${filteredKws.length} keywords`,
      kwRankMap,
    );
  }
  function exportBizCSV(clientId: number, kws: KwRecord[]) {
    const name = (clientsMap.get(clientId) ?? `business-${clientId}`).replace(/\s+/g, "-").toLowerCase();
    exportCSV(kws, clientsMap, `${name}-keywords-${dateStamp}.csv`, kwRankMap);
  }
  function exportBizPDF(clientId: number, kws: KwRecord[]) {
    const bizName = clientsMap.get(clientId) ?? `Business #${clientId}`;
    const slug    = bizName.replace(/\s+/g, "-").toLowerCase();
    exportPDF(kws, clientsMap, `${slug}-keywords-${dateStamp}.pdf`, `${bizName} · ${kws.length} keywords`, kwRankMap);
  }

  /* ── Column header ── */
  const TH = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <th className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 whitespace-nowrap ${className}`}>
      {children}
    </th>
  );

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">AEO Keywords</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage keywords per business — expand a row to view details and links</p>
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
          <Button size="sm" className="gap-2 shadow-sm"
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.3)" }}
            onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" /> Add Keyword
          </Button>
        </div>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Keywords", value: totalKws,   color: "text-foreground",   dot: "" },
          { label: "Active",          value: activeKws,  color: "text-emerald-400",  dot: "bg-emerald-400" },
          { label: "Type 1 – Geo",   value: type1Count, color: "text-primary",       dot: "bg-primary" },
          { label: "Type 2 – Link",  value: type2Count, color: "text-amber-400",    dot: "bg-amber-400" },
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

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input type="search" placeholder="Search business or keyword…"
            className="pl-9 bg-card/60 border-border/50 h-9"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground/50" />
          {[{ id: "all", label: "All Types" }, { id: "1", label: "Type 1 – Geo" }, { id: "2", label: "Type 2 – Backlink" }].map((t) => (
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
        <span className="ml-auto text-xs text-muted-foreground/40">{filteredKws.length} keyword{filteredKws.length !== 1 ? "s" : ""}</span>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
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
        <div className="flex flex-col items-center justify-center h-52 rounded-xl border border-dashed border-border/40 bg-card/30 text-muted-foreground gap-3">
          <Key className="w-10 h-10 opacity-15" />
          <p className="text-sm">No keywords found</p>
          <Button size="sm" className="gap-1.5 mt-1"
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))" }}
            onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add first keyword
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {Array.from(grouped.entries()).map(([clientId, kws]) => {
            const client   = clients?.find((c) => c.id === clientId);
            const isOpen   = expanded.has(clientId);
            const initials = (client?.businessName ?? "?").split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
            const activeCount = kws.filter((k) => k.isActive).length;
            const type1 = kws.filter((k) => k.keywordType === 1).length;
            const type2 = kws.filter((k) => k.keywordType === 2).length;

            return (
              <div key={clientId} className="rounded-xl border border-border/50 overflow-hidden">

                {/* ══ Business header row ══ */}
                <div className={`flex items-center gap-0 transition-colors ${
                  isOpen ? "bg-primary/8 border-b border-primary/20" : "bg-card/50 hover:bg-card/70"
                }`}>
                  <button onClick={() => toggleExpand(clientId)}
                    className={`flex items-center gap-3 px-4 py-3.5 border-r border-border/40 flex-1 min-w-0 text-left transition-colors ${
                      isOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                      isOpen ? "bg-primary/20 text-primary" : "bg-gradient-to-br from-primary/30 to-primary/10 text-primary"
                    }`}>{initials}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm leading-tight truncate">
                          {client?.businessName ?? `Business #${clientId}`}
                        </p>
                        {client?.city && (
                          <span className="text-[11px] text-muted-foreground/60 hidden sm:inline">
                            {client.city}{client.state ? `, ${client.state}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{kws.length} keyword{kws.length !== 1 ? "s" : ""}</span>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="text-[10px] text-emerald-400">{activeCount} active</span>
                        {type1 > 0 && <><span className="text-muted-foreground/30">·</span><span className="text-[10px] text-primary">{type1} T1</span></>}
                        {type2 > 0 && <><span className="text-muted-foreground/30">·</span><span className="text-[10px] text-amber-400">{type2} T2</span></>}
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>

                  {/* Right: actions */}
                  <div className="flex items-center gap-1 px-3 flex-shrink-0">
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

                {/* ══ Keywords table ══ */}
                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border/30 bg-muted/10">
                        <tr>
                          <TH className="text-left pl-4 w-8"></TH>
                          <TH className="text-left pl-2">Keyword</TH>
                          <TH className="text-center">Type</TH>
                          <TH className="text-center">1st</TH>
                          <TH className="text-center">Active</TH>
                          <TH className="text-center">Date Added</TH>
                          <TH className="text-center border-l border-border/20">Init Rank</TH>
                          <TH className="text-center">Curr Rank</TH>
                          <TH className="text-center border-l border-border/20">Init 30d</TH>
                          <TH className="text-center">F/U 30d</TH>
                          <TH className="text-center border-l border-border/20">Init Life</TH>
                          <TH className="text-center">F/U Life</TH>
                          <TH className="text-right pr-4 border-l border-border/20">Actions</TH>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {kws.map((kw) => {
                          const isType2   = kw.keywordType === 2;
                          const isPrimary = !!kw.isPrimary;
                          const linkExp   = linkExpanded.has(kw.id as number);
                          const hasLinks  = !!(kw.initialRankReportLink || kw.currentRankReportLink || kw.linkTypeLabel);

                          return (
                            <React.Fragment key={kw.id as number}>
                              <tr className="hover:bg-muted/10 transition-colors group">
                                {/* Link toggle */}
                                <td className="pl-4 py-3 w-8 align-middle">
                                  <button onClick={() => toggleLink(kw.id as number)}
                                    className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                                      hasLinks
                                        ? linkExp
                                          ? "text-violet-400 bg-violet-500/10"
                                          : "text-muted-foreground/40 hover:text-violet-400 hover:bg-violet-500/10"
                                        : "text-muted-foreground/20 cursor-default"
                                    }`}
                                    title={hasLinks ? "Toggle link details" : "No links set"}>
                                    <ChevronRight className={`w-3 h-3 transition-transform ${linkExp ? "rotate-90" : ""}`} />
                                  </button>
                                </td>

                                {/* Keyword */}
                                <td className="pl-2 pr-3 py-3 align-middle">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {isPrimary && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
                                    <span className="font-medium text-foreground text-sm leading-snug">{kw.keywordText as string}</span>
                                  </div>
                                </td>

                                {/* Type badge */}
                                <td className="px-3 py-3 text-center align-middle">
                                  <Badge variant="outline" className={`text-[10px] whitespace-nowrap ${
                                    isType2
                                      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                      : "bg-primary/10 text-primary border-primary/20"
                                  }`}>
                                    {isType2 ? "T2 – Backlink" : "T1 – Geo"}
                                  </Badge>
                                </td>

                                {/* Primary */}
                                <td className="px-3 py-3 text-center align-middle">
                                  {isPrimary
                                    ? <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">1st</Badge>
                                    : <span className="text-muted-foreground/20 text-xs">—</span>
                                  }
                                </td>

                                {/* Active toggle */}
                                <td className="px-3 py-3 text-center align-middle">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <Switch checked={kw.isActive as boolean}
                                      onCheckedChange={(v) => updateKeyword.mutate(
                                        { id: kw.id as number, data: { isActive: v } },
                                        { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/keywords"] }) },
                                      )}
                                      className="data-[state=checked]:bg-emerald-500 scale-75" />
                                    <span className={`text-[10px] ${kw.isActive ? "text-emerald-400" : "text-muted-foreground/40"}`}>
                                      {kw.isActive ? "Active" : "Off"}
                                    </span>
                                  </div>
                                </td>

                                {/* Date added */}
                                <td className="px-3 py-3 text-center align-middle">
                                  {(kw.dateAdded as string) ? (
                                    <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground/60">
                                      <Calendar className="w-3 h-3" />
                                      {format(new Date(kw.dateAdded as string), "MMM d, yyyy")}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground/20 text-xs">—</span>
                                  )}
                                </td>

                                {/* Init Rank / Curr Rank — from ranking_reports */}
                                {(() => {
                                  const rank = kwRankMap.get(kw.id as number);
                                  const initPos = rank?.initialPosition ?? null;
                                  const currPos = rank?.currentPosition ?? null;
                                  const chg     = rank?.positionChange  ?? null;
                                  const RankPip = ({ pos }: { pos: number | null }) => {
                                    if (pos == null) return <span className="text-muted-foreground/25 text-xs">—</span>;
                                    const cls = pos <= 3 ? "bg-amber-400/90 text-amber-950 font-bold" : pos <= 7 ? "bg-slate-300/90 text-slate-900" : pos <= 10 ? "bg-amber-700/80 text-white" : "bg-muted/40 text-muted-foreground border border-border/40";
                                    return <span className={`inline-flex items-center justify-center text-[10px] font-semibold rounded px-1.5 py-0.5 ${cls}`}>#{pos}</span>;
                                  };
                                  return (
                                    <>
                                      <td className="px-3 py-3 text-center align-middle border-l border-border/20">
                                        <RankPip pos={initPos} />
                                      </td>
                                      <td className="px-3 py-3 text-center align-middle">
                                        <div className="flex flex-col items-center gap-0.5">
                                          <RankPip pos={currPos} />
                                          {chg != null && (
                                            <span className={`text-[9px] font-semibold leading-none ${chg > 0 ? "text-emerald-400" : chg < 0 ? "text-red-400" : "text-amber-400"}`}>
                                              {chg > 0 ? `+${chg}` : chg === 0 ? "=" : String(chg)}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                    </>
                                  );
                                })()}

                                {/* Search counts — 30 day */}
                                <td className="px-3 py-3 text-center align-middle border-l border-border/20">
                                  <span className="font-mono text-sm font-semibold text-foreground/80">
                                    {(kw.initialSearchCount30Days as number) ?? 0}
                                  </span>
                                </td>
                                <td className="px-3 py-3 text-center align-middle">
                                  <span className="font-mono text-sm font-semibold text-foreground/80">
                                    {(kw.followupSearchCount30Days as number) ?? 0}
                                  </span>
                                </td>

                                {/* Search counts — lifetime */}
                                <td className="px-3 py-3 text-center align-middle border-l border-border/20">
                                  <span className="font-mono text-sm font-semibold text-foreground/80">
                                    {(kw.initialSearchCountLife as number) ?? 0}
                                  </span>
                                </td>
                                <td className="px-3 py-3 text-center align-middle">
                                  <span className="font-mono text-sm font-semibold text-foreground/80">
                                    {(kw.followupSearchCountLife as number) ?? 0}
                                  </span>
                                </td>

                                {/* Actions */}
                                <td className="pr-4 py-3 text-right align-middle border-l border-border/20">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                                      onClick={() => setEditKw({ ...kw, id: kw.id })}>
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive text-muted-foreground/40"
                                      onClick={() => deleteKeyword(kw.id as number)}>
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>

                              {/* Link detail sub-row */}
                              {linkExp && (
                                <LinkRow kw={kw} onToggle={(v) =>
                                  updateKeyword.mutate(
                                    { id: kw.id as number, data: { linkActive: v } },
                                    { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/keywords"] }) },
                                  )
                                } />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Add keyword shortcut */}
                    <div className="px-4 py-2.5 border-t border-border/20 bg-muted/5">
                      <button onClick={() => setAddOpen(true)}
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

      {/* ── Dialogs ── */}
      <KeywordDialog
        open={addOpen} onOpenChange={setAddOpen}
        title="Add AEO Keyword" saving={saving}
        clients={clients}
        onSave={(data) => saveKeyword(null, data)}
      />
      {editKw && (
        <KeywordDialog
          open onOpenChange={(o) => { if (!o) setEditKw(null); }}
          title="Edit Keyword" saving={saving}
          initial={editKw} clients={clients}
          onSave={(data) => saveKeyword(editKw.id as number, data)}
        />
      )}
    </div>
  );
}
