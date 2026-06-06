import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive, RotateCcw, Search,
  ChevronRight, Loader2, CheckCircle2, Building2, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const h: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) h["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers: h });
}

interface ArchivedClient {
  id: number;
  businessName: string;
  city: string | null;
  state: string | null;
  planName: string | null;
  status: string | null;
  keywordCount: number;
  businessCount: number;
  campaignCount: number;
}

export default function ArchivedClients() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["archived-clients"],
    queryFn: async () => {
      const r = await rawFetch("/api/clients?status=inactive");
      if (!r.ok) throw new Error("Failed to load archived clients");
      const b = await r.json();
      return (b.data ?? b) as ArchivedClient[];
    },
  });

  const restore = useMutation({
    mutationFn: async (id: number) => {
      const r = await rawFetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!r.ok) throw new Error("Failed to restore");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["archived-clients"] });
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      qc.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({
        title: "Client restored",
        description: "Client and all its keywords have been reactivated.",
      });
    },
    onError: () => toast({ title: "Failed to restore", variant: "destructive" }),
  });

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.businessName ?? "").toLowerCase().includes(q) ||
      (c.city ?? "").toLowerCase().includes(q) ||
      (c.state ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Archive className="w-6 h-6 text-muted-foreground" />
            Archived Clients
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Clients removed from the active list. All sessions, ranking reports,
            and audit history are preserved — restoring brings the client and
            its keywords back into rotation.
          </p>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          {clients.length} archived
        </Badge>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, city, or state…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <CheckCircle2 className="w-12 h-12 opacity-20" />
          <p className="text-base font-medium">No archived clients</p>
          <p className="text-sm opacity-60">
            Clients show up here after being archived from the Clients page.
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Archived Clients</CardTitle>
            <CardDescription>
              {filtered.length} client{filtered.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-6 py-2 border-b bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              <div className="flex-1">Client</div>
              <div className="w-40 flex-shrink-0">Location</div>
              <div className="w-32 flex-shrink-0">Plan</div>
              <div className="w-44 flex-shrink-0">Inventory</div>
              <div className="w-24 flex-shrink-0 text-right">Actions</div>
            </div>

            <div className="divide-y">
              {filtered
                .sort((a, b) => (a.businessName ?? "").localeCompare(b.businessName ?? ""))
                .map((c) => (
                  <div key={c.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="font-medium text-sm truncate">{c.businessName}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <ChevronRight className="w-3 h-3" />
                        <span>ID #{c.id}</span>
                      </div>
                    </div>

                    <div className="w-40 flex-shrink-0">
                      {c.city || c.state ? (
                        <div className="flex items-center gap-1 text-xs">
                          <MapPin className="w-3 h-3 text-muted-foreground" />
                          <span className="truncate">
                            {[c.city, c.state].filter(Boolean).join(", ")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    <div className="w-32 flex-shrink-0">
                      {c.planName ? (
                        <Badge variant="outline" className="text-[10px]">
                          {c.planName}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    <div className="w-44 flex-shrink-0 text-xs text-muted-foreground space-y-0.5">
                      <div>{c.keywordCount ?? 0} keyword{(c.keywordCount ?? 0) !== 1 ? "s" : ""}</div>
                      <div>{c.businessCount ?? 0} business{(c.businessCount ?? 0) !== 1 ? "es" : ""} · {c.campaignCount ?? 0} campaign{(c.campaignCount ?? 0) !== 1 ? "s" : ""}</div>
                    </div>

                    <div className="w-24 flex-shrink-0 flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        onClick={() => restore.mutate(c.id)}
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
