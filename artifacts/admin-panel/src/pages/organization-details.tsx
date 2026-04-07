import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Search, Mail, CreditCard, CalendarDays, User,
  FileText, ExternalLink, StickyNote, CheckCircle2, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import { getPlanMeta } from "@/lib/plan-meta";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers });
}

interface OrgClient {
  id: number;
  businessName: string;
  accountType: string | null;
  accountEmail: string | null;
  accountUserName: string | null;
  contactEmail: string | null;
  billingEmail: string | null;
  planName: string | null;
  subscriptionId: string | null;
  lastFourCard: string | null;
  startDate: string | null;
  status: string;
  createdAt: string;
  createdBy: string | null;
  notes: string | null;
}

/* ── Notes popover (inline edit) ─────────────────────────────── */
function NotesCell({ client, onSaved }: { client: OrgClient; onSaved: (id: number, notes: string) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(client.notes ?? "");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    setSaving(true);
    try {
      const r = await rawFetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: draft.trim() || null }),
      });
      if (!r.ok) throw new Error();
      onSaved(client.id, draft.trim());
      toast({ title: "Notes saved" });
      setOpen(false);
    } catch {
      toast({ title: "Failed to save notes", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setDraft(client.notes ?? ""); setOpen(true); }}
        className={`group flex items-start gap-1.5 text-left max-w-[220px] ${client.notes ? "text-foreground" : "text-slate-400 italic"} hover:text-primary transition-colors`}
      >
        <StickyNote className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${client.notes ? "text-amber-500" : "text-slate-300 group-hover:text-primary"}`} />
        <span className="text-xs line-clamp-2">
          {client.notes ? client.notes : "Add note…"}
        </span>
      </button>

      <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) setOpen(false); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <StickyNote className="w-4 h-4 text-amber-600" />
              </div>
              <DialogTitle className="text-base font-bold">Notes — {client.businessName}</DialogTitle>
            </div>
            <DialogDescription>Add any important notes about this organisation.</DialogDescription>
          </DialogHeader>
          <Textarea
            ref={textareaRef}
            className="min-h-[140px] text-sm resize-none mt-2"
            placeholder="Type notes here…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 mt-1">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1 gap-1.5" onClick={save} disabled={saving}>
              <CheckCircle2 className="w-4 h-4" />
              {saving ? "Saving…" : "Save Notes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */
export default function OrganizationDetails() {
  const { toast } = useToast();
  const [clients, setClients]     = useState<OrgClient[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [sortKey, setSortKey]     = useState<keyof OrgClient>("createdAt");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("desc");
  const [selectedId, setSelected] = useState<number | null>(null);

  async function fetchClients() {
    setLoading(true);
    try {
      const r = await rawFetch("/api/clients");
      if (r.ok) setClients(await r.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchClients(); }, []);

  function handleNoteSaved(id: number, notes: string) {
    setClients((prev) => prev.map((c) => c.id === id ? { ...c, notes } : c));
  }

  function toggleSort(key: keyof OrgClient) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const filtered = clients
    .filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        c.businessName.toLowerCase().includes(q) ||
        (c.accountEmail ?? "").toLowerCase().includes(q) ||
        (c.accountUserName ?? "").toLowerCase().includes(q) ||
        (c.contactEmail ?? "").toLowerCase().includes(q) ||
        (c.planName     ?? "").toLowerCase().includes(q) ||
        (c.subscriptionId ?? "").toLowerCase().includes(q) ||
        (c.createdBy    ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  const selectedClient = clients.find((c) => c.id === selectedId) ?? null;

  function SortIcon({ col }: { col: keyof OrgClient }) {
    if (sortKey !== col) return <ChevronDown className="w-3 h-3 opacity-30 inline ml-0.5" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 text-primary inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 text-primary inline ml-0.5" />;
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Organisation Details</h1>
            <p className="text-sm text-muted-foreground">
              Overview of all business accounts — subscriptions, contacts, creation history &amp; notes
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="hidden md:flex gap-4">
          {[
            { label: "Total",    value: clients.length,                                   color: "text-foreground" },
            { label: "Active",   value: clients.filter((c) => c.status === "active").length,   color: "text-emerald-600" },
            { label: "Inactive", value: clients.filter((c) => c.status === "inactive").length, color: "text-slate-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center px-4 py-2 rounded-xl bg-muted/50 border min-w-[72px]">
              <p className={`text-2xl font-extrabold ${color}`}>{loading ? "—" : value}</p>
              <p className="text-xs text-muted-foreground font-medium">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9 h-10"
          placeholder="Search by name, email, plan, creator…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table card */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {([
                { key: "businessName", label: "Business Name" },
                { key: "accountType",  label: "User Type" },
                { key: "accountEmail", label: "Account Email" },
                { key: "accountUserName", label: "Account Name" },
                { key: "contactEmail", label: "Contact Email" },
                { key: "planName",     label: "Business Info / Plan" },
                { key: "subscriptionId", label: "Subscription ID" },
                { key: "lastFourCard", label: "Type of Payment" },
                { key: "createdAt",    label: "Date Created" },
                { key: "createdBy",    label: "Created By" },
                { key: "notes",        label: "Notes" },
              ] as { key: keyof OrgClient; label: string }[]).map(({ key, label }) => (
                <TableHead
                  key={key}
                  className="font-semibold text-xs uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
                  onClick={() => key !== "notes" && toggleSort(key)}
                >
                  {label}
                  {key !== "notes" && <SortIcon col={key} />}
                </TableHead>
              ))}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 12 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full rounded" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-16 text-center text-muted-foreground">
                  <Building2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="font-medium">No organisations found</p>
                  {search && <p className="text-xs mt-1">Try adjusting your search</p>}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c, i) => {
                const plan = c.planName ? getPlanMeta(c.planName) : null;
                return (
                  <TableRow
                    key={c.id}
                    className={`${i % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-primary/5 transition-colors`}
                  >
                    {/* Business Name */}
                    <TableCell className="align-top py-3 min-w-[160px]">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.status === "active" ? "bg-emerald-500" : "bg-slate-300"}`} />
                        <span className="font-semibold text-sm text-foreground">{c.businessName}</span>
                      </div>
                    </TableCell>

                    {/* User Type / Account Type */}
                    <TableCell className="align-top py-3 whitespace-nowrap">
                      {c.accountType ? (
                        <Badge variant="outline" className="capitalize text-xs font-semibold">
                          {c.accountType}
                        </Badge>
                      ) : <span className="text-xs text-slate-400 italic">—</span>}
                    </TableCell>

                    {/* Account Email */}
                    <TableCell className="align-top py-3 min-w-[160px]">
                      {c.accountEmail ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="truncate max-w-[160px]" title={c.accountEmail}>{c.accountEmail}</span>
                        </div>
                      ) : <span className="text-xs text-slate-400 italic">—</span>}
                    </TableCell>

                    {/* Account Name */}
                    <TableCell className="align-top py-3 whitespace-nowrap">
                      {c.accountUserName ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="font-medium">{c.accountUserName}</span>
                        </div>
                      ) : <span className="text-xs text-slate-400 italic">—</span>}
                    </TableCell>

                    {/* Contact Email */}
                    <TableCell className="align-top py-3 min-w-[160px]">
                      {c.contactEmail ?? c.billingEmail ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="truncate max-w-[160px]" title={c.contactEmail ?? c.billingEmail ?? ""}>
                            {c.contactEmail ?? c.billingEmail}
                          </span>
                        </div>
                      ) : <span className="text-xs text-slate-400 italic">—</span>}
                    </TableCell>

                    {/* Business Info / Plan */}
                    <TableCell className="align-top py-3">
                      {plan ? (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${plan.badgeClass} whitespace-nowrap`}>
                          {c.planName}
                        </span>
                      ) : <span className="text-xs text-slate-400 italic">No plan</span>}
                    </TableCell>

                    {/* Subscription ID */}
                    <TableCell className="align-top py-3">
                      {c.subscriptionId ? (
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                          {c.subscriptionId}
                        </code>
                      ) : <span className="text-xs text-slate-400 italic">—</span>}
                    </TableCell>

                    {/* Type of Payment */}
                    <TableCell className="align-top py-3 whitespace-nowrap">
                      {c.lastFourCard ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                          <span>•••• {c.lastFourCard}</span>
                        </div>
                      ) : <span className="text-xs text-slate-400 italic">—</span>}
                    </TableCell>

                    {/* Date Created */}
                    <TableCell className="align-top py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
                        {format(new Date(c.createdAt), "MMM d, yyyy")}
                      </div>
                    </TableCell>

                    {/* Created By */}
                    <TableCell className="align-top py-3 whitespace-nowrap">
                      {c.createdBy ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-medium">{c.createdBy}</span>
                        </div>
                      ) : <span className="text-xs text-slate-400 italic">—</span>}
                    </TableCell>

                    {/* Notes */}
                    <TableCell className="align-top py-3 min-w-[200px]">
                      <NotesCell client={c} onSaved={handleNoteSaved} />
                    </TableCell>

                    {/* Link to client detail */}
                    <TableCell className="align-top py-3 text-right">
                      <Link href={`/clients/${c.id}`}>
                        <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors" title="View client">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer count */}
      <p className="text-xs text-muted-foreground px-1">
        {filtered.length} of {clients.length} organisation{clients.length !== 1 ? "s" : ""}
        {search && ` matching "${search}"`}
      </p>
    </div>
  );
}
