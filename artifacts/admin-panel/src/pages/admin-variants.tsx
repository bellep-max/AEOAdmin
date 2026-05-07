import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sparkles, Loader2, RefreshCw, AlertTriangle, Search, ExternalLink,
} from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { format } from "date-fns";

interface VariantRow {
  keywordId: number;
  keywordText: string;
  clientId: number | null;
  clientName: string | null;
  businessId: number | null;
  businessName: string | null;
  aeoPlanId: number | null;
  campaignName: string | null;
  isActive: boolean;
  activeVariants: number;
  totalVariants: number;
  lastGeneratedAt: string | null;
  lastUsedAt: string | null;
}

interface VariantsOverviewResponse {
  rows: VariantRow[];
  total: number;
}

const TOKEN = import.meta.env.VITE_EXECUTOR_TOKEN ?? "";
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export default function AdminVariants() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [rowPending, setRowPending] = useState<Record<number, boolean>>({});

  const { data, isLoading, error } = useQuery<VariantsOverviewResponse>({
    queryKey: ["/api/llm/variants-overview"],
    queryFn: async () => {
      const res = await rawFetch("/api/llm/variants-overview");
      if (!res.ok) throw new Error(`Failed to load variants overview (${res.status})`);
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) =>
      r.keywordText.toLowerCase().includes(q) ||
      (r.clientName ?? "").toLowerCase().includes(q) ||
      (r.businessName ?? "").toLowerCase().includes(q) ||
      (r.campaignName ?? "").toLowerCase().includes(q),
    );
  }, [data?.rows, filter]);

  const stats = useMemo(() => {
    const rows = data?.rows ?? [];
    const total = rows.length;
    const empty = rows.filter((r) => r.activeVariants === 0).length;
    const stale = rows.filter((r) => {
      if (!r.lastGeneratedAt) return true;
      const days = (Date.now() - new Date(r.lastGeneratedAt).getTime()) / 86_400_000;
      return days > 30;
    }).length;
    return { total, empty, stale };
  }, [data?.rows]);

  const regenerateOne = async (keywordId: number) => {
    setRowPending((p) => ({ ...p, [keywordId]: true }));
    try {
      const res = await fetch(`${BASE}/api/keywords/${keywordId}/variants/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
      }
      qc.invalidateQueries({ queryKey: ["/api/llm/variants-overview"] });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Regen failed");
    } finally {
      setRowPending((p) => ({ ...p, [keywordId]: false }));
    }
  };

  const regenerateAll = async () => {
    if (!confirm(`Regenerate variants for all ${stats.total} active keywords? This takes ~30s per keyword.`)) return;
    setBulkPending(true);
    setBulkSummary(null);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (TOKEN) headers["X-Executor-Token"] = TOKEN;
    try {
      const res = await fetch(`${BASE}/api/llm/variants/regenerate-all`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
      }
      const json = await res.json();
      setBulkSummary(`Done: ${json.succeeded}/${json.total} ok, ${json.failed} failed`);
      qc.invalidateQueries({ queryKey: ["/api/llm/variants-overview"] });
    } catch (err) {
      setBulkSummary(err instanceof Error ? err.message : "Bulk regen failed");
    } finally {
      setBulkPending(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Search Variants</h1>
          <p className="text-sm text-muted-foreground">
            DeepSeek-generated phrases the executor randomly substitutes into search prompts.
          </p>
        </div>
        <div className="ml-auto flex gap-2 items-center">
          {bulkSummary ? <span className="text-xs text-muted-foreground">{bulkSummary}</span> : null}
          <Button size="sm" onClick={regenerateAll} disabled={bulkPending}>
            {bulkPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            Regenerate all
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Active keywords</p>
            <p className="text-2xl font-bold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">No variants</p>
            <p className="text-2xl font-bold mt-1 text-amber-600">{stats.empty}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Stale (&gt;30d)</p>
            <p className="text-2xl font-bold mt-1">{stats.stale}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter keyword, client, business, campaign…"
          className="pl-8"
        />
      </div>

      {/* Table */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Keywords ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="px-4 py-3 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {(error as Error).message}
            </div>
          ) : isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : !filtered.length ? (
            <div className="p-6 text-sm text-muted-foreground">No keywords match.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">KID</TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Client / Business</TableHead>
                  <TableHead className="w-20">Active</TableHead>
                  <TableHead className="w-20">Total</TableHead>
                  <TableHead className="w-36">Last generated</TableHead>
                  <TableHead className="w-36">Last used</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const detailHref = r.clientId && r.businessId && r.aeoPlanId
                    ? `/clients/${r.clientId}/businesses/${r.businessId}/campaigns/${r.aeoPlanId}/keywords/${r.keywordId}`
                    : null;
                  const empty = r.activeVariants === 0;
                  return (
                    <TableRow key={r.keywordId}>
                      <TableCell className="text-xs font-mono">{r.keywordId}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{r.keywordText}</div>
                        {r.campaignName ? (
                          <div className="text-[11px] text-muted-foreground mt-0.5">{r.campaignName}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>{r.clientName ?? "—"}</div>
                        <div>{r.businessName ?? "—"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[11px] ${empty ? "border-amber-500/30 text-amber-600" : ""}`}>
                          {r.activeVariants}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.totalVariants}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.lastGeneratedAt ? format(new Date(r.lastGeneratedAt), "MMM d, h:mm a") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.lastUsedAt ? format(new Date(r.lastUsedAt), "MMM d, h:mm a") : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => regenerateOne(r.keywordId)}
                            disabled={!!rowPending[r.keywordId]}
                          >
                            {rowPending[r.keywordId] ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3 h-3" />
                            )}
                          </Button>
                          {detailHref ? (
                            <Link href={detailHref}>
                              <Button size="sm" variant="ghost" className="h-7 px-2">
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </Link>
                          ) : null}
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
