import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import {
  Key,
  Search,
  ChevronLeft,
  ChevronRight,
  Building2,
} from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { format } from "date-fns";

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active:          { label: "Active",          cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  inactive:        { label: "Inactive",        cls: "bg-slate-500/10 text-slate-500 border-slate-500/30" },
  needs_improved:  { label: "Needs improved",  cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  new:             { label: "New",             cls: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
};

const STATUS_OPTIONS = Object.entries(STATUS_MAP).map(([value, { label }]) => ({ value, label }));

interface KeywordRow {
  id: number;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  keywordText: string;
  keywordType: number;
  isActive: boolean;
  isPrimary: number;
  status: string | null;
  notes: string | null;
  implementedBy: string | null;
  lastRunAt: string | null;
  dateAdded: string | null;
  clientName: string | null;
  businessName: string | null;
  campaignName: string | null;
  links?: { id: number; linkUrl: string; linkTypeLabel: string; linkActive: boolean; embeddedUrl: string | null }[];
}

interface ClientRow {
  id: number;
  businessName: string;
}
interface BusinessRow {
  id: number;
  clientId: number;
  name: string;
}
interface PlanRow {
  id: number;
  clientId: number | null;
  businessId: number | null;
  name: string | null;
  planType: string;
}

const PAGE_SIZE = 20;

export default function KeywordsAll() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(
    null,
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(
    null,
  );

  const { data: allClients } = useQuery<ClientRow[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await rawFetch("/api/clients");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const { data: allBusinesses } = useQuery<BusinessRow[]>({
    queryKey: ["/api/businesses"],
    queryFn: async () => {
      const res = await rawFetch("/api/businesses");
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

  // Lazy-load: keywords load only after a client is selected (the full list is
  // large and laggy). Server-side scoping by client/business/campaign.
  const clientChosen = selectedClientId !== null;
  const { data: keywords, isLoading } = useQuery<KeywordRow[]>({
    queryKey: [
      "/api/keywords",
      {
        clientId: selectedClientId,
        businessId: selectedBusinessId,
        aeoPlanId: selectedCampaignId,
      },
    ],
    enabled: clientChosen,
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (selectedClientId !== null)
        qs.set("clientId", String(selectedClientId));
      if (selectedBusinessId !== null)
        qs.set("businessId", String(selectedBusinessId));
      if (selectedCampaignId !== null)
        qs.set("aeoPlanId", String(selectedCampaignId));
      const res = await rawFetch(
        `/api/keywords${qs.toString() ? `?${qs}` : ""}`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const byName = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });

  const clientsSorted = [...(allClients ?? [])].sort((a, b) =>
    byName(a.businessName, b.businessName),
  );
  const bizScope = (allBusinesses ?? [])
    .filter((b) => selectedClientId === null || b.clientId === selectedClientId)
    .sort((a, b) => byName(a.name, b.name));
  const planScope = (allPlans ?? [])
    .filter(
      (p) =>
        (selectedClientId === null || p.clientId === selectedClientId) &&
        (selectedBusinessId === null || p.businessId === selectedBusinessId),
    )
    .sort((a, b) => byName(a.name ?? a.planType, b.name ?? b.planType));

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
    return list.sort((a, b) => a.keywordText.toLowerCase().localeCompare(b.keywordText.toLowerCase()));
  }, [keywords, search, statusFilter]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

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

      {/* Scope filter (client → business → campaign) */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3">
        <Building2 className="w-5 h-5 text-slate-600 dark:text-slate-400 flex-shrink-0 ml-1" />
        <Select
          value={selectedClientId !== null ? String(selectedClientId) : "all"}
          onValueChange={(v) => {
            const next = v === "all" ? null : Number(v);
            setSelectedClientId(next);
            setSelectedBusinessId(null);
            setSelectedCampaignId(null);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-56 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 h-10 text-sm font-semibold">
            <SelectValue placeholder="Select a client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Select a client</SelectItem>
            {clientsSorted.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.businessName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-slate-400">›</span>
        <Select
          value={selectedBusinessId !== null ? String(selectedBusinessId) : "all"}
          onValueChange={(v) => {
            const next = v === "all" ? null : Number(v);
            setSelectedBusinessId(next);
            setSelectedCampaignId(null);
            setPage(0);
          }}
          disabled={bizScope.length === 0}
        >
          <SelectTrigger className="w-56 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 h-10 text-sm font-semibold">
            <SelectValue placeholder="All Businesses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Businesses</SelectItem>
            {bizScope.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-slate-400">›</span>
        <Select
          value={selectedCampaignId !== null ? String(selectedCampaignId) : "all"}
          onValueChange={(v) => {
            setSelectedCampaignId(v === "all" ? null : Number(v));
            setPage(0);
          }}
          disabled={planScope.length === 0}
        >
          <SelectTrigger className="w-64 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 h-10 text-sm font-semibold">
            <SelectValue placeholder="All Campaigns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Campaigns</SelectItem>
            {planScope.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name ?? p.planType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search keywords, clients, businesses…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
            disabled={!clientChosen}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }} disabled={!clientChosen}>
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
      </div>

      {!clientChosen ? (
        <Card className="border-border/50 border-dashed">
          <CardContent className="py-16 text-center">
            <Building2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm font-medium">Select a client to view keywords</p>
            <p className="text-xs text-muted-foreground mt-1">
              Keywords load per client to keep the page fast — pick a client
              above to begin.
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
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
                paged.map((kw) => {
                  const s = STATUS_MAP[kw.status ?? "new"] ?? STATUS_MAP.new;
                  const hasCampaign = kw.clientId != null && kw.businessId != null && kw.aeoPlanId != null;
                  const detailUrl = hasCampaign
                    ? `/clients/${kw.clientId}/businesses/${kw.businessId}/campaigns/${kw.aeoPlanId}/keywords/${kw.id}`
                    : "#";
                  return (
                    <TableRow key={kw.id}>
                      <TableCell className="font-medium text-sm">
                        {hasCampaign ? (
                          <Link href={detailUrl} className="text-primary hover:underline font-semibold">
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
                        <Badge className={`text-[11px] border ${s.cls}`} variant="outline">
                          {s.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {kw.lastRunAt ? format(new Date(kw.lastRunAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{kw.implementedBy ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={kw.notes ?? ""}>
                        {kw.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {clientChosen && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <span className="text-sm font-medium">Page {page + 1} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
