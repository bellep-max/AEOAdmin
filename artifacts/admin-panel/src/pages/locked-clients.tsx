import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Trophy,
  Search,
  Calendar,
  ChevronRight,
  Building2,
  MapPin,
  Archive,
} from "lucide-react";
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
import { Link } from "wouter";
import { format } from "date-fns";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const h: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (BASE.includes("ngrok")) h["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers: h });
}

interface LockedClient {
  id: number;
  businessName: string;
  city: string | null;
  state: string | null;
  planName: string | null;
  status: string | null;
  archivedAt: string | null;
  lockedAt: string | null;
  keywordCount: number;
  businessCount: number;
  campaignCount: number;
}

export default function LockedClients() {
  const [search, setSearch] = useState("");

  // Locked = at least one keyword on this client hit top-3 in the past.
  // We show ALL locked clients (status filter passed through so archived
  // ones still appear with the Archived badge).
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["locked-clients"],
    queryFn: async () => {
      const r = await rawFetch(
        "/api/clients?locked=true&archived=all&status=all",
      );
      if (!r.ok) throw new Error("Failed to load locked clients");
      const b = await r.json();
      return (b.data ?? b) as LockedClient[];
    },
  });

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.businessName ?? "").toLowerCase().includes(q) ||
      (c.city ?? "").toLowerCase().includes(q) ||
      (c.state ?? "").toLowerCase().includes(q)
    );
  });

  const stillRunning = clients.filter((c) => !c.archivedAt).length;
  const alreadyArchived = clients.length - stillRunning;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            Locked / Won Clients
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Clients that have at least one keyword ranking top-3 on any
            platform. Set automatically by the rotation service the first time a
            keyword wins. Free-trial clients here are graduation candidates —
            archive them from the Clients page when you're ready to wind down
            the trial.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge
            variant="outline"
            className="text-sm px-3 py-1 border-amber-400 text-amber-700"
          >
            {clients.length} locked
          </Badge>
          <div className="text-xs text-muted-foreground">
            {stillRunning} running · {alreadyArchived} already archived
          </div>
        </div>
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
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <Trophy className="w-12 h-12 opacity-20" />
          <p className="text-base font-medium">No locked clients yet</p>
          <p className="text-sm opacity-60">
            Clients show up here the first time any of their keywords hits
            top-3.
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Locked Clients</CardTitle>
            <CardDescription>
              {filtered.length} client{filtered.length !== 1 ? "s" : ""} ·
              sorted by most recently won
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-6 py-2 border-b bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              <div className="flex-1">Client</div>
              <div className="w-36 flex-shrink-0">Location</div>
              <div className="w-28 flex-shrink-0">Plan</div>
              <div className="w-32 flex-shrink-0">First Won</div>
              <div className="w-40 flex-shrink-0">Inventory</div>
              <div className="w-24 flex-shrink-0 text-right">State</div>
            </div>

            <div className="divide-y">
              {filtered
                .sort((a, b) => {
                  const ad = a.lockedAt ? new Date(a.lockedAt).getTime() : 0;
                  const bd = b.lockedAt ? new Date(b.lockedAt).getTime() : 0;
                  return bd - ad;
                })
                .map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-4 px-6 py-4 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <Link href={`/clients/${c.id}`}>
                          <span className="font-medium text-sm truncate hover:underline cursor-pointer">
                            {c.businessName}
                          </span>
                        </Link>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <ChevronRight className="w-3 h-3" />
                        <span>ID #{c.id}</span>
                      </div>
                    </div>

                    <div className="w-36 flex-shrink-0">
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

                    <div className="w-28 flex-shrink-0">
                      {c.planName ? (
                        <Badge variant="outline" className="text-[10px]">
                          {c.planName}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    <div className="w-32 flex-shrink-0">
                      {c.lockedAt ? (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(c.lockedAt), "MMM d, yyyy")}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    <div className="w-40 flex-shrink-0 text-xs text-muted-foreground space-y-0.5">
                      <div>
                        {c.keywordCount ?? 0} keyword
                        {(c.keywordCount ?? 0) !== 1 ? "s" : ""}
                      </div>
                      <div>
                        {c.businessCount ?? 0} biz · {c.campaignCount ?? 0}{" "}
                        campaign{(c.campaignCount ?? 0) !== 1 ? "s" : ""}
                      </div>
                    </div>

                    <div className="w-24 flex-shrink-0 flex justify-end">
                      {c.archivedAt ? (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Archive className="w-2.5 h-2.5" />
                          Archived
                        </Badge>
                      ) : c.status === "inactive" ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-slate-600"
                        >
                          Paused
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-emerald-700 border-emerald-300"
                        >
                          Active
                        </Badge>
                      )}
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
