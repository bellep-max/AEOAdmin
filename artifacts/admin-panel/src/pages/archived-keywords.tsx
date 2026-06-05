import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive, RotateCcw, Trash2, Search, Calendar,
  AlertCircle, ChevronRight, Loader2, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const h: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) h["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers: h });
}

interface ArchivedKw {
  id: number;
  keywordText: string;
  clientId: number;
  businessId: number | null;
  status: string | null;
  archivedAt: string;
  archiveReason: string | null;
  replacementSuggestion: string | null;
  joinedClientName: string | null;
  joinedBusinessName: string | null;
}

export default function ArchivedKeywords() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("all");
  const [search, setSearch] = useState("");

  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const r = await rawFetch("/api/clients?status=active&limit=200");
      const b = await r.json(); return (b.data ?? b) as { id: number; businessName: string }[];
    },
  });

  const { data: keywords = [], isLoading } = useQuery({
    queryKey: ["archived-keywords", clientId],
    queryFn: async () => {
      const params = new URLSearchParams({ includeArchived: "true" });
      if (clientId !== "all") params.set("clientId", clientId);
      const r = await rawFetch(`/api/keywords?${params}`);
      const b = await r.json();
      const all = (b.data ?? b) as ArchivedKw[];
      // Archived = inactive (archivedAt set) but NOT "won" — locked/won keywords
      // live on their own Locked Keywords page (status='locked').
      return all.filter((k) => k.archivedAt && k.status !== "locked");
    },
  });

  const restore = useMutation({
    mutationFn: async (id: number) => {
      const r = await rawFetch(`/api/keywords/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true, archivedAt: null, archiveReason: null }),
      });
      if (!r.ok) throw new Error("Failed to restore");
      return r.json();
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["archived-keywords"] });
      qc.invalidateQueries({ queryKey: ["kw-rotation"] });
      toast({ title: "Keyword restored", description: "Keyword moved back to active rotation." });
    },
    onError: () => toast({ title: "Failed to restore", variant: "destructive" }),
  });

  const filtered = keywords.filter((k) =>
    k.keywordText.toLowerCase().includes(search.toLowerCase()) ||
    (k.joinedClientName ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Archive className="w-6 h-6 text-muted-foreground" />
            Archived Keywords
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Keywords removed from rotation — manually archived or stalled with no ranking
            improvement. Won keywords (Top-3 locks) live under{" "}
            <span className="font-medium">Locked Keywords</span>. Restore or delete them here.
          </p>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          {keywords.length} archived
        </Badge>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search keywords…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            {clientsLoading ? <Skeleton className="h-9 w-48" /> : (
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="w-52 h-9">
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.businessName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <CheckCircle2 className="w-12 h-12 opacity-20" />
          <p className="text-base font-medium">No archived keywords</p>
          <p className="text-sm opacity-60">
            Keywords show up here after being manually archived or stalling without improvement. Won keywords are under Locked Keywords.
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Archived Keywords</CardTitle>
            <CardDescription>
              {filtered.length} keyword{filtered.length !== 1 ? "s" : ""} · sorted by archive date
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {/* Column headers */}
            <div className="flex items-center gap-4 px-6 py-2 border-b bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              <div className="flex-1">Keyword</div>
              <div className="w-36 flex-shrink-0">Client / Business</div>
              <div className="w-32 flex-shrink-0">Archived</div>
              <div className="w-48 flex-shrink-0">Reason</div>
              <div className="w-28 flex-shrink-0">Replacement</div>
              <div className="w-24 flex-shrink-0 text-right">Actions</div>
            </div>

            <div className="divide-y">
              {filtered
                .sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime())
                .map((kw) => (
                  <div key={kw.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/20 transition-colors">
                    {/* Keyword */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Archive className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="font-medium text-sm truncate">{kw.keywordText}</span>
                      </div>
                      {kw.replacementSuggestion && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <ChevronRight className="w-3 h-3" />
                          <span className="italic">Replaced by: </span>
                          <span className="font-medium text-foreground">{kw.replacementSuggestion}</span>
                        </div>
                      )}
                    </div>

                    {/* Client */}
                    <div className="w-36 flex-shrink-0">
                      <p className="text-xs font-medium truncate">{kw.joinedClientName ?? "—"}</p>
                      {kw.joinedBusinessName && (
                        <p className="text-xs text-muted-foreground truncate">{kw.joinedBusinessName}</p>
                      )}
                    </div>

                    {/* Archived date */}
                    <div className="w-32 flex-shrink-0">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {kw.archivedAt
                          ? format(new Date(kw.archivedAt), "MMM d, yyyy")
                          : "—"}
                      </div>
                    </div>

                    {/* Reason */}
                    <div className="w-48 flex-shrink-0">
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {kw.archiveReason ?? "No reason recorded"}
                      </p>
                    </div>

                    {/* Replacement suggestion */}
                    <div className="w-28 flex-shrink-0">
                      {kw.replacementSuggestion ? (
                        <Badge variant="outline" className="text-[10px] max-w-full truncate">
                          {kw.replacementSuggestion}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="w-24 flex-shrink-0 flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        onClick={() => restore.mutate(kw.id)}
                        disabled={restore.isPending}
                      >
                        {restore.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        Restore
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
