import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Ban,
  RotateCcw,
  Search,
  Loader2,
  CheckCircle2,
  Building2,
  MapPin,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const h: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (BASE.includes("ngrok")) h["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { credentials: "include", ...init, headers: h });
}

/** One cancellation. A "campaign" row is a canceled campaign; a "client" row
 *  is an archived client that has no canceled campaign of its own (archived
 *  straight from the Clients page, or has no campaigns at all). */
interface CancellationRow {
  kind: "campaign" | "client";
  rowKey: string;
  clientId: number;
  clientName: string;
  city: string | null;
  state: string | null;
  campaignId: number | null;
  campaignName: string | null;
  planType: string | null;
  businessId: number | null;
  businessName: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  keywordCount: number;
  clientArchived: boolean;
}

export default function Cancelled() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [restoringKey, setRestoringKey] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["cancellations"],
    queryFn: async () => {
      const r = await rawFetch("/api/cancellations");
      if (!r.ok) throw new Error("Failed to load cancellations");
      return (await r.json()) as CancellationRow[];
    },
  });

  const restore = useMutation({
    mutationFn: async (row: CancellationRow) => {
      const path =
        row.kind === "campaign"
          ? `/api/clients/${row.clientId}/aeo-plans/${row.campaignId}/restore`
          : `/api/clients/${row.clientId}/restore`;
      const r = await rawFetch(path, { method: "POST" });
      if (!r.ok) throw new Error("Failed to restore");
      return r.json();
    },
    onMutate: (row) => setRestoringKey(row.rowKey),
    onSettled: () => setRestoringKey(null),
    onSuccess: (_data, row) => {
      // Invalidate every cached list the row can hop back into.
      qc.invalidateQueries({ queryKey: ["cancellations"] });
      qc.invalidateQueries({ queryKey: ["archived-clients"] });
      qc.invalidateQueries({ queryKey: ["locked-clients"] });
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      qc.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({
        title:
          row.kind === "campaign" ? "Campaign restored" : "Client restored",
        description: "Keywords are running again.",
      });
    },
    onError: () =>
      toast({ title: "Failed to restore", variant: "destructive" }),
  });

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    return (
      (r.clientName ?? "").toLowerCase().includes(q) ||
      (r.campaignName ?? "").toLowerCase().includes(q) ||
      (r.businessName ?? "").toLowerCase().includes(q) ||
      (r.city ?? "").toLowerCase().includes(q) ||
      (r.state ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Ban className="w-6 h-6 text-muted-foreground" />
            Cancelled
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Campaigns cancelled from the campaign page, plus clients archived
            from the Clients page. Sessions, audits, and ranking history are
            preserved — restoring puts the keywords back into rotation.
          </p>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          {rows.length} cancelled
        </Badge>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by client, campaign, city, or state…"
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
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <CheckCircle2 className="w-12 h-12 opacity-20" />
          <p className="text-base font-medium">Nothing cancelled</p>
          <p className="text-sm opacity-60">
            Campaigns show up here after being cancelled from the campaign page.
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cancelled Campaigns</CardTitle>
            <CardDescription>
              {filtered.length} row{filtered.length !== 1 ? "s" : ""} · sorted
              by cancellation date
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-6 py-2 border-b bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              <div className="flex-1">Campaign</div>
              <div className="w-40 flex-shrink-0">Client</div>
              <div className="w-28 flex-shrink-0">Location</div>
              <div className="w-28 flex-shrink-0">Cancelled</div>
              <div className="w-20 flex-shrink-0">Keywords</div>
              <div className="w-24 flex-shrink-0 text-right">Actions</div>
            </div>

            <div className="divide-y">
              {filtered.map((r) => (
                <div
                  key={r.rowKey}
                  className="flex items-start gap-4 px-6 py-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      {r.kind === "campaign" ? (
                        <Link
                          href={`/clients/${r.clientId}/businesses/${r.businessId}/campaigns/${r.campaignId}`}
                          className="font-medium text-sm truncate min-w-0 hover:text-primary"
                        >
                          {r.campaignName}
                        </Link>
                      ) : (
                        <span className="font-medium text-sm truncate min-w-0 italic text-muted-foreground">
                          Whole client archived
                        </span>
                      )}
                      {/* Redundant on a client row — that row IS the client. */}
                      {r.kind === "campaign" && r.clientArchived && (
                        <Badge
                          variant="outline"
                          className="text-[10px] flex-shrink-0 whitespace-nowrap border-rose-400 text-rose-700"
                        >
                          Client cancelled
                        </Badge>
                      )}
                    </div>
                    {/* Wraps instead of squeezing — in a narrow column three
                        truncating children shrink each other to one letter. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 min-w-0 text-xs text-muted-foreground">
                      {r.businessName && (
                        <span className="truncate max-w-full">
                          {r.businessName}
                        </span>
                      )}
                      {r.planType && (
                        <Badge
                          variant="outline"
                          className="text-[10px] flex-shrink-0 whitespace-nowrap"
                        >
                          {r.planType}
                        </Badge>
                      )}
                      {r.cancelReason && (
                        <span className="italic truncate max-w-full">
                          {r.cancelReason}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="w-40 flex-shrink-0 min-w-0 overflow-hidden">
                    <Link
                      href={`/clients/${r.clientId}`}
                      className="text-sm truncate hover:text-primary block"
                    >
                      {r.clientName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      ID #{r.clientId}
                    </span>
                  </div>

                  <div className="w-28 flex-shrink-0">
                    {r.city || r.state ? (
                      <div className="flex items-center gap-1 text-xs">
                        <MapPin className="w-3 h-3 text-muted-foreground" />
                        <span className="truncate">
                          {[r.city, r.state].filter(Boolean).join(", ")}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>

                  <div className="w-28 flex-shrink-0">
                    {r.canceledAt ? (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {format(
                          new Date(`${r.canceledAt}T00:00:00`),
                          "MMM d, yyyy",
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>

                  <div className="w-20 flex-shrink-0 text-xs text-muted-foreground">
                    {r.keywordCount} keyword{r.keywordCount !== 1 ? "s" : ""}
                  </div>

                  <div className="w-24 flex-shrink-0 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                      onClick={() => restore.mutate(r)}
                      disabled={restore.isPending}
                    >
                      {restoringKey === r.rowKey ? (
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
