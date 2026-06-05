import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Unlock, Search, Calendar, ChevronRight, Loader2, Trophy } from "lucide-react";
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
  return fetch(BASE + path, { credentials: "include", ...init, headers: h });
}

interface LockedKw {
  id: number;
  keywordText: string;
  clientId: number;
  status: string | null;
  archivedAt: string;
  archiveReason: string | null;
  replacementSuggestion: string | null;
  joinedClientName: string | null;
  joinedBusinessName: string | null;
}

/** Parse "locked (won): top-3 on perplexity (#2) — auto-rotation" → {platform, position}. */
function parseTrigger(reason: string | null): { platform: string; position: number } | null {
  if (!reason) return null;
  const m = /top-3 on (\w+) \(#(\d+)\)/i.exec(reason);
  return m ? { platform: m[1], position: Number(m[2]) } : null;
}

const PLATFORM_COLOR: Record<string, string> = {
  chatgpt: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  gemini: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  perplexity: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export default function LockedKeywords() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("all");
  const [search, setSearch] = useState("");

  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const r = await rawFetch("/api/clients?status=active&limit=200");
      const b = await r.json();
      return (b.data ?? b) as { id: number; businessName: string }[];
    },
  });

  const { data: keywords = [], isLoading } = useQuery({
    queryKey: ["locked-keywords", clientId],
    queryFn: async () => {
      const params = new URLSearchParams({ includeArchived: "true" });
      if (clientId !== "all") params.set("clientId", clientId);
      const r = await rawFetch(`/api/keywords?${params}`);
      const b = await r.json();
      const all = (b.data ?? b) as LockedKw[];
      // Only "won" keywords — locked via rotation (status='locked'), not manual archives.
      return all.filter((k) => k.status === "locked" && k.archivedAt);
    },
  });

  const unlock = useMutation({
    mutationFn: async (id: number) => {
      const r = await rawFetch(`/api/keywords/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true, archivedAt: null, archiveReason: null, status: "active" }),
      });
      if (!r.ok) throw new Error("Failed to unlock");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["locked-keywords"] });
      qc.invalidateQueries({ queryKey: ["kw-rotation"] });
      qc.invalidateQueries({ queryKey: ["archived-keywords"] });
      toast({ title: "Keyword unlocked", description: "Moved back into active rotation." });
    },
    onError: () => toast({ title: "Failed to unlock", variant: "destructive" }),
  });

  const filtered = keywords.filter((k) =>
    k.keywordText.toLowerCase().includes(search.toLowerCase()) ||
    (k.joinedClientName ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="w-6 h-6 text-emerald-500" />
            Locked Keywords
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Keywords that <span className="font-medium">won</span> — locked after reaching Top-3 on a platform and rotated out, each replaced by an AI keyword. Unlock to put one back into rotation.
          </p>
        </div>
        <Badge className="text-sm px-3 py-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0">
          {keywords.length} locked
        </Badge>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search keywords…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
            </div>
            {clientsLoading ? <Skeleton className="h-9 w-48" /> : (
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="w-52 h-9"><SelectValue placeholder="All clients" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.businessName}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <Lock className="w-12 h-12 opacity-20" />
          <p className="text-base font-medium">No locked keywords yet</p>
          <p className="text-sm opacity-60">
            Keywords lock automatically when a scan records Top-3 on any platform — or run a rotation to lock current winners.
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Locked Keywords</CardTitle>
            <CardDescription>{filtered.length} won keyword{filtered.length !== 1 ? "s" : ""} · most recent first</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-6 py-2 border-b bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              <div className="flex-1">Keyword</div>
              <div className="w-36 flex-shrink-0">Client / Business</div>
              <div className="w-28 flex-shrink-0">Won at</div>
              <div className="w-32 flex-shrink-0">Locked</div>
              <div className="w-24 flex-shrink-0 text-right">Actions</div>
            </div>
            <div className="divide-y">
              {filtered
                .sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime())
                .map((kw) => {
                  const trig = parseTrigger(kw.archiveReason);
                  return (
                    <div key={kw.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Trophy className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                          <span className="font-medium text-sm truncate">{kw.keywordText}</span>
                        </div>
                        {kw.replacementSuggestion && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                            <ChevronRight className="w-3 h-3" />
                            <span className="italic">Replaced by:</span>
                            <span className="font-medium text-foreground truncate">{kw.replacementSuggestion}</span>
                          </div>
                        )}
                      </div>
                      <div className="w-36 flex-shrink-0">
                        <p className="text-xs font-medium truncate">{kw.joinedClientName ?? "—"}</p>
                        {kw.joinedBusinessName && <p className="text-xs text-muted-foreground truncate">{kw.joinedBusinessName}</p>}
                      </div>
                      <div className="w-28 flex-shrink-0">
                        {trig ? (
                          <Badge className={`text-[10px] border-0 capitalize ${PLATFORM_COLOR[trig.platform.toLowerCase()] ?? "bg-muted text-muted-foreground"}`}>
                            {trig.platform} #{trig.position}
                          </Badge>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                      <div className="w-32 flex-shrink-0">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {kw.archivedAt ? format(new Date(kw.archivedAt), "MMM d, yyyy") : "—"}
                        </div>
                      </div>
                      <div className="w-24 flex-shrink-0 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                          onClick={() => unlock.mutate(kw.id)}
                          disabled={unlock.isPending}
                        >
                          {unlock.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlock className="w-3 h-3" />}
                          Unlock
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
