import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Building2 } from "lucide-react";
import {
  SearchableSelect,
  type ComboOption,
} from "@/components/SearchableSelect";
import { rawFetch } from "@/lib/period-comparison";

interface BusinessRow {
  id: number;
  clientId: number;
  name: string;
  category: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  websiteUrl: string | null;
  status: string;
  keywordCount: number;
  campaignCount: number;
}

interface ClientRow {
  id: number;
  businessName: string;
}

const slugify = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export default function Businesses() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const [businessFilter, setBusinessFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: businesses, isLoading } = useQuery<BusinessRow[]>({
    queryKey: ["/api/businesses"],
    queryFn: async () => {
      const res = await rawFetch("/api/businesses");
      if (!res.ok) throw new Error("Failed to load businesses");
      return res.json();
    },
  });

  const { data: clients } = useQuery<ClientRow[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await rawFetch("/api/clients");
      if (!res.ok) throw new Error("Failed to load clients");
      return res.json();
    },
  });

  const clientName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of clients ?? []) m.set(c.id, c.businessName);
    return m;
  }, [clients]);

  const clientOptions = useMemo<ComboOption[]>(
    () =>
      [...(clients ?? [])]
        .sort((a, b) =>
          (a.businessName ?? "").localeCompare(b.businessName ?? ""),
        )
        .map((c) => ({ value: String(c.id), label: c.businessName })),
    [clients],
  );

  const businessOptions = useMemo<ComboOption[]>(
    () =>
      [...(businesses ?? [])]
        .filter(
          (b) => clientFilter == null || String(b.clientId) === clientFilter,
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({
          value: String(b.id),
          label: b.name,
          sublabel: clientName.get(b.clientId),
        })),
    [businesses, clientFilter, clientName],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (businesses ?? [])
      .filter((b) => {
        if (businessFilter != null && String(b.id) !== businessFilter)
          return false;
        if (clientFilter != null && String(b.clientId) !== clientFilter)
          return false;
        if (statusFilter !== "all" && b.status !== statusFilter) return false;
        if (!q) return true;
        const hay = [
          b.name,
          b.category,
          b.city,
          b.state,
          clientName.get(b.clientId),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    businesses,
    search,
    businessFilter,
    clientFilter,
    statusFilter,
    clientName,
  ]);

  const locationOf = (b: BusinessRow) =>
    [b.city, b.state].filter(Boolean).join(", ") || "—";

  const businessHref = (b: BusinessRow) => {
    const cSlug = slugify(clientName.get(b.clientId) ?? "");
    const bSlug = slugify(b.name);
    return `/clients/${b.clientId}${cSlug ? `-${cSlug}` : ""}/businesses/${b.id}${bSlug ? `-${bSlug}` : ""}`;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Businesses</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading…"
              : `${filtered.length} of ${businesses?.length ?? 0} businesses`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search name, category, city, client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <SearchableSelect
          value={businessFilter}
          onChange={setBusinessFilter}
          options={businessOptions}
          placeholder="All businesses"
          allLabel="All businesses"
          width="w-64"
        />
        <SearchableSelect
          value={clientFilter}
          onChange={(v) => {
            setClientFilter(v);
            setBusinessFilter(null);
          }}
          options={clientOptions}
          placeholder="All clients"
          allLabel="All clients"
          width="w-56"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Keywords</TableHead>
                <TableHead className="text-right">Campaigns</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
                  >
                    No businesses match your filters.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((b) => (
                <TableRow
                  key={b.id}
                  onClick={() => navigate(businessHref(b))}
                  className="hover:bg-muted/40 cursor-pointer"
                >
                  <TableCell className="font-medium text-primary">
                    {b.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <Link
                      href={`/clients/${b.clientId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-primary hover:underline"
                    >
                      {clientName.get(b.clientId) ?? `Client ${b.clientId}`}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.category || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {locationOf(b)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.keywordCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.campaignCount}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        b.status === "active"
                          ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                          : "border-slate-300 text-slate-600 bg-slate-50"
                      }
                    >
                      {b.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
