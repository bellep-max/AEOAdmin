import { useMemo, useState } from "react";
import { Link } from "wouter";
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

export default function Businesses() {
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<string>("all");
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

  const clientOptions = useMemo(
    () =>
      [...(clients ?? [])].sort((a, b) =>
        (a.businessName ?? "").localeCompare(b.businessName ?? ""),
      ),
    [clients],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (businesses ?? [])
      .filter((b) => {
        if (clientFilter !== "all" && String(b.clientId) !== clientFilter)
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
  }, [businesses, search, clientFilter, statusFilter, clientName]);

  const location = (b: BusinessRow) =>
    [b.city, b.state].filter(Boolean).join(", ") || "—";

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
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clientOptions.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.businessName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                <TableRow key={b.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <Link
                      href={`/clients/${b.clientId}`}
                      className="hover:text-primary hover:underline"
                    >
                      {clientName.get(b.clientId) ?? `Client ${b.clientId}`}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.category || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {location(b)}
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
