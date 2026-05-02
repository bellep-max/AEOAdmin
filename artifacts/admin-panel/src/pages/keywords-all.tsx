import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Key, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { format } from "date-fns";

const STATUS_OPTIONS = [
  { value: "active", label: "Active", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  { value: "inactive", label: "Inactive", cls: "bg-slate-500/10 text-slate-500 border-slate-500/30" },
  { value: "needs_improved", label: "Needs improved", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  { value: "new", label: "New", cls: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
] as const;

interface KeywordRow {
  id: number;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  keywordText: string;
  isActive: boolean;
  status: string | null;
  notes: string | null;
  implementedBy: string | null;
  lastRunAt: string | null;
  clientName: string | null;
  businessName: string | null;
  campaignName: string | null;
}

interface PlanRow {
  id: number;
  name: string | null;
  planType: string;
}

function StatusBadge({ status }: { status: string | null }) {
  const opt = STATUS_OPTIONS.find((o) => o.value === status);
  const label = opt?.label ?? status ?? "—";
  const cls = opt?.cls ?? "bg-slate-500/10 text-slate-500 border-slate-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function EditableCell({
  value,
  onSave,
  placeholder,
  type = "text",
}: {
  value: string | null;
  onSave: (v: string) => void;
  placeholder?: string;
  type?: "text" | "select";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const commit = () => {
    setEditing(false);
    if (draft !== (value ?? "")) onSave(draft);
  };

  if (editing) {
    if (type === "select") {
      return (
        <select
          value={draft}
          onChange={(e) => { setDraft(e.target.value); }}
          onBlur={commit}
          className="w-full text-xs border rounded px-1 py-0.5 bg-background"
          autoFocus
        >
          <option value="">—</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); } }}
        placeholder={placeholder}
        className="w-full text-xs border rounded px-1 py-0.5 bg-background"
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className="text-xs text-left w-full min-w-[60px] hover:bg-muted/50 rounded px-1 py-0.5 cursor-text"
    >
      {value || <span className="text-muted-foreground/40">{placeholder ?? "—"}</span>}
    </button>
  );
}

const PAGE_SIZE = 20;

export default function KeywordsAll() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");

  const { data: keywords, isLoading } = useQuery<KeywordRow[]>({
    queryKey: ["/api/keywords"],
    queryFn: async () => {
      const res = await rawFetch("/api/keywords");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: allPlans } = useQuery<PlanRow[]>({
    queryKey: ["/api/aeo-plans"],
    queryFn: async () => {
      const res = await rawFetch("/api/aeo-plans");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!keywords) return [];
    let list = keywords;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((k) =>
        k.keywordText.toLowerCase().includes(q) ||
        (k.clientName ?? "").toLowerCase().includes(q) ||
        (k.businessName ?? "").toLowerCase().includes(q) ||
        (k.campaignName ?? "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((k) => (k.status ?? "new") === statusFilter);
    }
    if (campaignFilter !== "all") {
      const cid = parseInt(campaignFilter);
      list = list.filter((k) => k.aeoPlanId === cid);
    }
    return list.sort((a, b) => a.keywordText.toLowerCase().localeCompare(b.keywordText.toLowerCase()));
  }, [keywords, search, statusFilter, campaignFilter]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const updateKeyword = async (id: number, field: string, value: string) => {
    const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
    await fetch(`${BASE}/api/keywords/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ [field]: value || null }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">All Keywords</h1>
            <p className="text-sm text-muted-foreground">
              {filtered.length} keyword{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search keywords, clients, businesses…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={campaignFilter} onValueChange={(v) => { setCampaignFilter(v); setPage(0); }}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All Campaigns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Campaigns</SelectItem>
            {(allPlans ?? []).map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name ?? p.planType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Keyword</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Implemented By</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                    No keywords found
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((kw) => (
                  <TableRow key={kw.id}>
                    <TableCell className="font-medium text-sm">
                      {kw.clientId != null && kw.businessId != null && kw.aeoPlanId != null ? (
                        <Link
                          href={`/clients/${kw.clientId}/businesses/${kw.businessId}/campaigns/${kw.aeoPlanId}`}
                          className="hover:text-primary hover:underline"
                        >
                          {kw.keywordText}
                        </Link>
                      ) : (
                        kw.keywordText
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{kw.clientName ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{kw.businessName ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{kw.campaignName ?? "—"}</TableCell>
                    <TableCell>
                      <EditableCell
                        type="select"
                        value={kw.status ?? "new"}
                        onSave={(v) => updateKeyword(kw.id, "status", v)}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {kw.lastRunAt ? format(new Date(kw.lastRunAt), "MMM d, yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={kw.implementedBy}
                        onSave={(v) => updateKeyword(kw.id, "implementedBy", v)}
                        placeholder="—"
                      />
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={kw.notes}
                        onSave={(v) => updateKeyword(kw.id, "notes", v)}
                        placeholder="Add note…"
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => handlePageChange(page - 1)}
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <span className="text-sm font-medium">Page {page + 1} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => handlePageChange(page + 1)}
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
