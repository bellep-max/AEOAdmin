import { useState, useRef, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useGetClient } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAllPlanNames } from "@/hooks/use-all-plan-names";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ExternalLink, Pencil, ChevronLeft, Building2, CreditCard, Loader2, Briefcase, StickyNote, CheckCircle2,
  Mail, User, CalendarDays,
} from "lucide-react";
import { format } from "date-fns";
import { getPlanMeta } from "@/lib/plan-meta";
import ClientAeoPlans from "@/components/ClientAeoPlans";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers });
}

/* ─── Read-only field ────────────────────────────────────────────────────── */
function Field({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      {value ? (
        href ? (
          <a
            href={href} target="_blank" rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1 break-all"
          >
            {value} <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        ) : (
          <p className="text-sm text-foreground break-all">{value}</p>
        )
      ) : (
        <p className="text-sm text-muted-foreground/40">—</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function ClientDetail() {
  const [, params]  = useRoute("/clients/:id");
  const clientId    = Number(params?.id);
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [editBizOpen,  setEditBizOpen]  = useState(false);
  const [editAccOpen,  setEditAccOpen]  = useState(false);
  const [notesOpen,    setNotesOpen]    = useState(false);
  const [notesDraft,   setNotesDraft]   = useState("");
  const [saving,       setSaving]       = useState(false);
  const [notesSaving,  setNotesSaving]  = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  async function saveNotes() {
    setNotesSaving(true);
    try {
      const res = await rawFetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft.trim() || null }),
      });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["getClient", clientId] });
      toast({ title: "Notes saved" });
      setNotesOpen(false);
    } catch {
      toast({ title: "Failed to save notes", variant: "destructive" });
    } finally {
      setNotesSaving(false);
    }
  }

  const { data: client, isLoading } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: ["getClient", clientId] },
  });

  /* ── PATCH helper — accepts a close callback so both dialogs can share it ── */
  async function patchClient(body: Record<string, string>, onSuccess: () => void) {
    setSaving(true);
    try {
      const res = await rawFetch(`/api/clients/${clientId}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await queryClient.invalidateQueries({ queryKey: ["getClient", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ 
        title: "✅ Changes saved successfully!",
        description: `Updated information for ${body.businessName || client?.businessName || "client"}.`
      });
      onSuccess();
    } catch (err: unknown) {
      toast({ title: "❌ Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ── Loading / not found ── */
  if (isLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid md:grid-cols-2 gap-6">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );

  if (!client) return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
      <Building2 className="w-12 h-12 opacity-20" />
      <p>Client not found</p>
      <Link href="/clients">
        <Button variant="outline" size="sm">Back to Clients</Button>
      </Link>
    </div>
  );

  const c        = client as unknown as Record<string, unknown>;
  const initials = client.businessName
    ? client.businessName.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase()
    : "?";

  return (
    <div className="space-y-6">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/clients" className="hover:text-foreground transition-colors flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Clients
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{client.businessName}</span>
      </div>

      {/* ── Hero ── */}
      <div className="rounded-xl border border-border/50 bg-card/60 p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-xl font-bold text-primary flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">{client.businessName}</h1>
            <Badge
              variant="outline"
              className={client.status === "active"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-muted text-muted-foreground"
              }
            >
              {client.status}
            </Badge>
            {client.planName && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                {client.planName}
              </Badge>
            )}
            {(c.accountType as string) && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs">
                {c.accountType as string}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ── Two-column cards ── */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* ── Business Details ── */}
        <Card className="border-border/50">
          <CardHeader className="pb-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              Business Details
            </CardTitle>
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setEditBizOpen(true)}
            >
              <Pencil className="w-3 h-3" /> Edit
            </Button>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <Field label="Business Name"                    value={client.businessName} />
              <Field label="Plan"                             value={client.planName} />
              <Field label="Search Address"                   value={client.searchAddress} />
              <Field label="GMB Address"                      value={client.publishedAddress} />
              <Field label="GMB Link"                         value={client.gmbUrl} href={client.gmbUrl ?? undefined} />
              <Field label="Website Published on GMB"         value={c.websitePublishedOnGmb as string} href={(c.websitePublishedOnGmb as string) ?? undefined} />
              <Field label="Website Linked to on GMB (if different)" value={c.websiteLinkedOnGmb as string} href={(c.websiteLinkedOnGmb as string) ?? undefined} />
              <Field label="Account User"                     value={c.accountUser as string} />
              <Field label="Start Date"                       value={c.startDate as string} />
              <Field label="Next Bill Date"                   value={c.nextBillDate as string} />
              <Field label="Subscription ID"                  value={c.subscriptionId as string} />
              {/* Last 4 with card icon */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Last 4 of Billing Credit Card
                </p>
                {(c.lastFourCard as string) ? (
                  <p className="text-sm text-foreground flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                    •••• {c.lastFourCard as string}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground/40">—</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Account Details ── */}
        <Card className="border-border/50">
          <CardHeader className="pb-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" />
              Account Details
            </CardTitle>
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setEditAccOpen(true)}
            >
              <Pencil className="w-3 h-3" /> Edit
            </Button>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <Field label="Account Type"              value={c.accountType as string} />
              <Field label="Account User Name"         value={c.accountUserName as string} />
              <Field label="Account Email"             value={c.accountEmail as string} />
              <Field label="Contact / Billing Email"   value={c.billingEmail as string} />
              <Field label="Plan"                      value={client.planName} />
              <Field label="Subscription ID"           value={c.subscriptionId as string} />
              <Field label="Business Name"             value={client.businessName} />
              <Field label="Search Address"            value={client.searchAddress} />
              <Field label="Start Date"                value={c.startDate as string} />
              <Field label="Next Bill Date"            value={c.nextBillDate as string} />
              {/* Last 4 with card icon */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Last 4 of Billing Credit Card
                </p>
                {(c.lastFourCard as string) ? (
                  <p className="text-sm text-foreground flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                    •••• {c.lastFourCard as string}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground/40">—</p>
                )}
              </div>
              <Field label="Created By" value={c.createdBy as string} />
              {/* Notes — inline edit */}
              <div className="space-y-1 col-span-full">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Notes</p>
                <button
                  onClick={() => { setNotesDraft((c.notes as string) ?? ""); setNotesOpen(true); }}
                  className="flex items-start gap-2 text-left w-full group"
                >
                  <StickyNote className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${(c.notes as string) ? "text-amber-500" : "text-muted-foreground/30 group-hover:text-primary"}`} />
                  <span className={`text-sm ${(c.notes as string) ? "text-foreground" : "text-muted-foreground/40 italic group-hover:text-primary"}`}>
                    {(c.notes as string) ? (c.notes as string) : "Add notes…"}
                  </span>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ AEO PLANS / CAMPAIGNS ═══ */}
      <ClientAeoPlans clientId={clientId} client={client} />

      {/* ═══ ORGANISATION DETAILS ═══ */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {/* Section header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-muted/30">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold tracking-tight">Organisation Details</h2>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Business Name</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">User Type</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Account Email</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Account Name</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Contact Email</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Plan</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Subscription ID</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Payment Type</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Date Created</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Created By</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-primary/5 transition-colors">
                {/* Business Name */}
                <TableCell className="align-top py-3 min-w-[160px]">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${client.status === "active" ? "bg-emerald-500" : "bg-slate-300"}`} />
                    <span className="font-semibold text-sm">{client.businessName}</span>
                  </div>
                </TableCell>

                {/* User Type */}
                <TableCell className="align-top py-3 whitespace-nowrap">
                  {(c.accountType as string) ? (
                    <Badge variant="outline" className="capitalize text-xs font-semibold">
                      {c.accountType as string}
                    </Badge>
                  ) : <span className="text-xs text-slate-400 italic">—</span>}
                </TableCell>

                {/* Account Email */}
                <TableCell className="align-top py-3 min-w-[160px]">
                  {(c.accountEmail as string) ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="truncate max-w-[160px]" title={c.accountEmail as string}>{c.accountEmail as string}</span>
                    </div>
                  ) : <span className="text-xs text-slate-400 italic">—</span>}
                </TableCell>

                {/* Account Username */}
                <TableCell className="align-top py-3 whitespace-nowrap">
                  {(c.accountUserName as string) ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="font-medium">{c.accountUserName as string}</span>
                    </div>
                  ) : <span className="text-xs text-slate-400 italic">—</span>}
                </TableCell>

                {/* Contact Email */}
                <TableCell className="align-top py-3 min-w-[160px]">
                  {(client.contactEmail ?? (c.billingEmail as string)) ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="truncate max-w-[160px]" title={client.contactEmail ?? (c.billingEmail as string) ?? ""}>
                        {client.contactEmail ?? (c.billingEmail as string)}
                      </span>
                    </div>
                  ) : <span className="text-xs text-slate-400 italic">—</span>}
                </TableCell>

                {/* Plan */}
                <TableCell className="align-top py-3">
                  {client.planName ? (() => {
                    const plan = getPlanMeta(client.planName!);
                    return (
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${plan.badgeClass} whitespace-nowrap`}>
                        {client.planName}
                      </span>
                    );
                  })() : <span className="text-xs text-slate-400 italic">No plan</span>}
                </TableCell>

                {/* Subscription ID */}
                <TableCell className="align-top py-3">
                  {(c.subscriptionId as string) ? (
                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      {c.subscriptionId as string}
                    </code>
                  ) : <span className="text-xs text-slate-400 italic">—</span>}
                </TableCell>

                {/* Payment Type */}
                <TableCell className="align-top py-3 whitespace-nowrap">
                  {(c.lastFourCard as string) ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                      <span>•••• {c.lastFourCard as string}</span>
                    </div>
                  ) : <span className="text-xs text-slate-400 italic">—</span>}
                </TableCell>

                {/* Date Created */}
                <TableCell className="align-top py-3 whitespace-nowrap">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
                    {format(new Date(client.createdAt), "MMM d, yyyy")}
                  </div>
                </TableCell>

                {/* Created By */}
                <TableCell className="align-top py-3 whitespace-nowrap">
                  {(c.createdBy as string) ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-medium">{c.createdBy as string}</span>
                    </div>
                  ) : <span className="text-xs text-slate-400 italic">—</span>}
                </TableCell>

                {/* Notes */}
                <TableCell className="align-top py-3 min-w-[200px]">
                  <button
                    onClick={() => { setNotesDraft((c.notes as string) ?? ""); setNotesOpen(true); }}
                    className={`group flex items-start gap-1.5 text-left max-w-[220px] ${
                      (c.notes as string) ? "text-foreground" : "text-slate-400 italic"
                    } hover:text-primary transition-colors`}
                  >
                    <StickyNote className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                      (c.notes as string) ? "text-amber-500" : "text-slate-300 group-hover:text-primary"
                    }`} />
                    <span className="text-xs line-clamp-2">
                      {(c.notes as string) ? (c.notes as string) : "Add note…"}
                    </span>
                  </button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ═══ NOTES DIALOG ═══ */}
      <Dialog open={notesOpen} onOpenChange={(o) => { if (!o && !notesSaving) setNotesOpen(false); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <StickyNote className="w-4 h-4 text-amber-600" />
              </div>
              <DialogTitle className="text-base font-bold">Notes — {client.businessName}</DialogTitle>
            </div>
            <DialogDescription>Add any important notes about this client.</DialogDescription>
          </DialogHeader>
          <Textarea
            ref={notesRef}
            className="min-h-[140px] text-sm resize-none mt-2"
            placeholder="Type notes here…"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 mt-1">
            <Button variant="outline" className="flex-1" onClick={() => setNotesOpen(false)} disabled={notesSaving}>Cancel</Button>
            <Button className="flex-1 gap-1.5" onClick={saveNotes} disabled={notesSaving}>
              <CheckCircle2 className="w-4 h-4" />
              {notesSaving ? "Saving…" : "Save Notes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ EDIT BUSINESS DETAILS DIALOG ═══ */}
      <EditBizDialog
        open={editBizOpen}
        onOpenChange={setEditBizOpen}
        saving={saving}
        onSave={(vals) => patchClient(vals, () => setEditBizOpen(false))}
        values={{
          businessName:          client.businessName                    ?? "",
          planName:              client.planName                        ?? "",
          searchAddress:         client.searchAddress                   ?? "",
          publishedAddress:      client.publishedAddress                ?? "",
          gmbUrl:                client.gmbUrl                          ?? "",
          websitePublishedOnGmb: (c.websitePublishedOnGmb as string)   ?? "",
          websiteLinkedOnGmb:    (c.websiteLinkedOnGmb    as string)   ?? "",
          accountUser:           (c.accountUser           as string)   ?? "",
          startDate:             (c.startDate             as string)   ?? "",
          nextBillDate:          (c.nextBillDate          as string)   ?? "",
          subscriptionId:        (c.subscriptionId        as string)   ?? "",
          lastFourCard:          (c.lastFourCard          as string)   ?? "",
        }}
      />

      {/* ═══ EDIT ACCOUNT DETAILS DIALOG ═══ */}
      <EditAccDialog
        open={editAccOpen}
        onOpenChange={setEditAccOpen}
        saving={saving}
        onSave={(vals) => patchClient(vals, () => setEditAccOpen(false))}
        values={{
          accountType:     (c.accountType     as string) ?? "",
          accountUserName: (c.accountUserName as string) ?? "",
          accountEmail:    (c.accountEmail    as string) ?? "",
          billingEmail:    (c.billingEmail    as string) ?? "",
          planName:        client.planName               ?? "",
          subscriptionId:  (c.subscriptionId  as string) ?? "",
          businessName:    client.businessName           ?? "",
          searchAddress:   client.searchAddress          ?? "",
          lastFourCard:    (c.lastFourCard    as string) ?? "",
          nextBillDate:    (c.nextBillDate    as string) ?? "",
          startDate:       (c.startDate       as string) ?? "",
          createdBy:       (c.createdBy       as string) ?? "",
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Shared full-screen dialog shell                             */
/* ─────────────────────────────────────────────────────────── */
function FullScreenDialog({
  open, onOpenChange, title, icon: Icon, saving, onSave, children,
}: {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  title:        string;
  icon:         React.ElementType;
  saving:       boolean;
  onSave:       () => void;
  children:     React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none max-h-none rounded-none border-0 bg-card overflow-y-auto flex flex-col">
        <DialogHeader className="px-8 pt-8 pb-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <DialogTitle className="text-xl">{title}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col items-center justify-center px-8 py-6">
          <div className="w-full max-w-3xl space-y-6">
            {children}

            <div className="flex gap-4 pt-6">
              <Button
                variant="outline" size="lg" className="flex-1 border-border/50 h-12"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="lg" className="flex-1 gap-2 h-12"
                disabled={saving}
                onClick={onSave}
                style={{
                  background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))",
                  boxShadow:  "0 4px 12px rgba(37,99,235,0.25)",
                }}
              >
                {saving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : "Save Changes"
                }
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Edit Business Details                                        */
/* ─────────────────────────────────────────────────────────── */
const BIZ_FIELDS: Array<{ key: string; label: string; placeholder?: string; maxLength?: number; wide?: boolean; type?: string; dropdown?: string[] }> = [
  { key: "businessName",          label: "Client Name", maxLength: 100 },
  { key: "planName",              label: "Plan" },
  { key: "searchAddress",         label: "Search Address", maxLength: 200, wide: true },
  { key: "publishedAddress",      label: "GMB Address", maxLength: 200, wide: true },
  { key: "gmbUrl",                label: "GMB Link", placeholder: "https://maps.google.com/…", maxLength: 500, wide: true, type: "url" },
  { key: "websitePublishedOnGmb", label: "Website Published on GMB", placeholder: "https://…", maxLength: 200, wide: true },
  { key: "websiteLinkedOnGmb",    label: "Website Linked to on GMB (if different)", placeholder: "https://…", maxLength: 200, wide: true },
  { key: "accountUser",           label: "Account User", maxLength: 50 },
  { key: "startDate",             label: "Start Date", placeholder: "YYYY-MM-DD", type: "date" },
  { key: "nextBillDate",          label: "Next Bill Date", placeholder: "YYYY-MM-DD", type: "date" },
  { key: "subscriptionId",        label: "Subscription ID", maxLength: 50 },
  { key: "lastFourCard",          label: "Last 4 of Billing Credit Card", placeholder: "e.g. 4242", maxLength: 4 },
];

function EditBizDialog({
  open, onOpenChange, saving, onSave, values: initValues,
}: {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  saving:       boolean;
  onSave:       (vals: Record<string, string>) => void;
  values:       Record<string, string>;
}) {
  const [vals, setVals] = useState<Record<string, string>>(initValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { toast } = useToast();
  const allPlanNames = useAllPlanNames();

  function handleOpenChange(v: boolean) {
    if (v) {
      setVals(initValues);
      setErrors({});
    } else {
      // Check if any data has changed
      const hasChanges = Object.keys(vals).some(key => vals[key] !== initValues[key]);
      if (hasChanges) {
        setConfirmCancel(true);
      } else {
        onOpenChange(false);
      }
    }
  }

  function validateFields(): boolean {
    const newErrors: Record<string, string> = {};

    // Required field: Client Name
    if (!vals.businessName?.trim()) {
      newErrors.businessName = "Client name is required";
    } else if (vals.businessName.length < 2) {
      newErrors.businessName = "Client name must be at least 2 characters";
    } else if (vals.businessName.length > 100) {
      newErrors.businessName = "Client name cannot exceed 100 characters";
    }

    // Plan Name validation (optional)
    if (vals.planName && vals.planName.trim()) {
      if (vals.planName.length > 100) {
        newErrors.planName = "Plan name cannot exceed 100 characters";
      }
    }

    // Search Address validation
    if (vals.searchAddress && vals.searchAddress.trim()) {
      if (vals.searchAddress.length > 200) {
        newErrors.searchAddress = "Search address cannot exceed 200 characters";
      }
    }

    // Published Address validation
    if (vals.publishedAddress && vals.publishedAddress.trim()) {
      if (vals.publishedAddress.length > 200) {
        newErrors.publishedAddress = "GMB address cannot exceed 200 characters";
      }
    }

    // GMB Link URL validation
    if (vals.gmbUrl && vals.gmbUrl.trim()) {
      try {
        new URL(vals.gmbUrl);
        if (vals.gmbUrl.length > 500) {
          newErrors.gmbUrl = "URL cannot exceed 500 characters";
        }
      } catch {
        newErrors.gmbUrl = "Please enter a valid URL (e.g., https://maps.google.com/...)";
      }
    }

    // Website Published on GMB validation
    if (vals.websitePublishedOnGmb && vals.websitePublishedOnGmb.trim()) {
      try {
        new URL(vals.websitePublishedOnGmb);
        if (vals.websitePublishedOnGmb.length > 200) {
          newErrors.websitePublishedOnGmb = "URL cannot exceed 200 characters";
        }
      } catch {
        newErrors.websitePublishedOnGmb = "Please enter a valid URL (e.g., https://example.com)";
      }
    }

    // Website Linked on GMB validation
    if (vals.websiteLinkedOnGmb && vals.websiteLinkedOnGmb.trim()) {
      try {
        new URL(vals.websiteLinkedOnGmb);
        if (vals.websiteLinkedOnGmb.length > 200) {
          newErrors.websiteLinkedOnGmb = "URL cannot exceed 200 characters";
        }
      } catch {
        newErrors.websiteLinkedOnGmb = "Please enter a valid URL (e.g., https://example.com)";
      }
    }

    // Account User validation
    if (vals.accountUser && vals.accountUser.trim()) {
      if (vals.accountUser.length > 50) {
        newErrors.accountUser = "Account user cannot exceed 50 characters";
      }
    }

    // Start Date validation
    if (vals.startDate && vals.startDate.trim()) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(vals.startDate)) {
        newErrors.startDate = "Please enter date in YYYY-MM-DD format (e.g., 2026-01-15)";
      } else {
        const date = new Date(vals.startDate);
        if (isNaN(date.getTime())) {
          newErrors.startDate = "Please enter a valid date";
        }
      }
    }

    // Next Bill Date validation
    if (vals.nextBillDate && vals.nextBillDate.trim()) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(vals.nextBillDate)) {
        newErrors.nextBillDate = "Please enter date in YYYY-MM-DD format (e.g., 2026-04-15)";
      } else {
        const date = new Date(vals.nextBillDate);
        if (isNaN(date.getTime())) {
          newErrors.nextBillDate = "Please enter a valid date";
        }
      }
    }

    // Subscription ID validation
    if (vals.subscriptionId && vals.subscriptionId.trim()) {
      if (vals.subscriptionId.length > 50) {
        newErrors.subscriptionId = "Subscription ID cannot exceed 50 characters";
      }
    }

    // Last 4 card validation
    if (vals.lastFourCard && vals.lastFourCard.trim()) {
      if (!/^\d{4}$/.test(vals.lastFourCard)) {
        newErrors.lastFourCard = "Please enter exactly 4 digits (e.g., 1234)";
      }
    }

    setErrors(newErrors);
    
    if (Object.keys(newErrors).length > 0) {
      const errorCount = Object.keys(newErrors).length;
      toast({
        title: "❌ Validation Error",
        description: `Please fix ${errorCount} ${errorCount === 1 ? 'error' : 'errors'} before saving.`,
        variant: "destructive",
      });
      return false;
    }
    
    return true;
  }

  function handleSave() {
    if (validateFields()) {
      setConfirmSave(true);
    }
  }

  function handleConfirmSave() {
    onSave(vals);
    setConfirmSave(false);
  }

  function handleConfirmCancel() {
    setConfirmCancel(false);
    setVals(initValues);
    setErrors({});
    onOpenChange(false);
  }

  return (
    <>
      <FullScreenDialog
        open={open} onOpenChange={handleOpenChange}
        title="Edit Client Details" icon={Building2}
        saving={saving} onSave={handleSave}
      >
        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          {BIZ_FIELDS.map((f) => (
            <div key={f.key} className={`space-y-2 ${f.wide ? "col-span-2" : ""}`}>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {f.label}
                {f.key === "businessName" && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {f.key === "planName" ? (
                <Select
                  value={vals[f.key] ?? ""}
                  onValueChange={(v) => setVals((p) => ({ ...p, [f.key]: v }))}
                >
                  <SelectTrigger className="bg-muted/30 border-border/60 h-11 text-sm">
                    <SelectValue placeholder="Select a plan…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allPlanNames.map((plan) => (
                      <SelectItem key={plan} value={plan}>{plan}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.dropdown ? (
                <Select
                  value={vals[f.key] ?? ""}
                  onValueChange={(v) => setVals((p) => ({ ...p, [f.key]: v }))}
                >
                  <SelectTrigger className="bg-muted/30 border-border/60 h-11 text-sm">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.dropdown.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className={`bg-muted/30 border-border/60 h-11 text-sm ${errors[f.key] ? "border-red-500" : ""}`}
                  placeholder={f.placeholder ?? ""}
                  maxLength={f.maxLength}
                  type={f.type}
                  value={vals[f.key] ?? ""}
                  onChange={(e) => {
                    setVals((p) => ({ ...p, [f.key]: e.target.value }));
                    if (errors[f.key]) {
                      setErrors((p) => {
                        const { [f.key]: _, ...rest } = p;
                        return rest;
                      });
                    }
                  }}
                />
              )}
              {errors[f.key] && (
                <p className="text-xs text-red-500 mt-1">{errors[f.key]}</p>
              )}
            </div>
          ))}
        </div>
      </FullScreenDialog>

      {/* Save Confirmation Dialog */}
      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to save the changes to <strong>{vals.businessName}</strong>?
              This will update the client information immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmSave(false)}>Go Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleConfirmSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Yes, Save Changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard your changes? All unsaved modifications will be lost. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmCancel(false)}>Continue Editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmCancel}
            >
              Yes, Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Edit Account Details                                         */
/* ─────────────────────────────────────────────────────────── */
const ACC_FIELDS: Array<{ key: string; label: string; placeholder?: string; maxLength?: number; wide?: boolean; dropdown?: string[]; type?: string }> = [
  { key: "accountType",     label: "Account Type",             dropdown: ["Agency", "Retail"] },
  { key: "accountUserName", label: "Account User Name",        maxLength: 100 },
  { key: "accountEmail",    label: "Account Email",            placeholder: "user@example.com", wide: true, maxLength: 100, type: "email" },
  { key: "billingEmail",    label: "Contact / Billing Email",  placeholder: "billing@example.com", wide: true, maxLength: 100, type: "email" },
  { key: "planName",        label: "Plan",                     maxLength: 100 },
  { key: "subscriptionId",  label: "Subscription ID",          maxLength: 50 },
  { key: "businessName",    label: "Client Name",              maxLength: 100 },
  { key: "searchAddress",   label: "Search Address",           wide: true, maxLength: 200 },
  { key: "lastFourCard",    label: "Last 4 of Billing Credit Card", placeholder: "e.g. 4242", maxLength: 4 },
  { key: "nextBillDate",    label: "Next Bill Date",           placeholder: "YYYY-MM-DD", type: "date" },
  { key: "startDate",       label: "Start Date",               placeholder: "YYYY-MM-DD", type: "date" },
  { key: "createdBy",       label: "Created By",               placeholder: "e.g. Belle", maxLength: 50 },
];

function EditAccDialog({
  open, onOpenChange, saving, onSave, values: initValues,
}: {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  saving:       boolean;
  onSave:       (vals: Record<string, string>) => void;
  values:       Record<string, string>;
}) {
  const [vals, setVals] = useState<Record<string, string>>(initValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setVals(initValues);
      setErrors({});
    }
  }, [open, initValues]);

  function validateFields(): boolean {
    const newErrors: Record<string, string> = {};

    // Account Type validation (dropdown - always valid if set)
    // No validation needed as it's a dropdown

    // Account User Name validation
    if (vals.accountUserName && vals.accountUserName.trim()) {
      if (vals.accountUserName.length < 2) {
        newErrors.accountUserName = "Account user name must be at least 2 characters";
      } else if (vals.accountUserName.length > 100) {
        newErrors.accountUserName = "Account user name cannot exceed 100 characters";
      }
    }

    // Account Email validation
    if (vals.accountEmail && vals.accountEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(vals.accountEmail)) {
        newErrors.accountEmail = "Please enter a valid email address (e.g., user@example.com)";
      } else if (vals.accountEmail.length > 100) {
        newErrors.accountEmail = "Email cannot exceed 100 characters";
      }
    }

    // Billing Email validation
    if (vals.billingEmail && vals.billingEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(vals.billingEmail)) {
        newErrors.billingEmail = "Please enter a valid billing email address (e.g., billing@example.com)";
      } else if (vals.billingEmail.length > 100) {
        newErrors.billingEmail = "Email cannot exceed 100 characters";
      }
    }

    // Plan Name validation
    if (vals.planName && vals.planName.trim()) {
      if (vals.planName.length > 100) {
        newErrors.planName = "Plan name cannot exceed 100 characters";
      }
    }

    // Subscription ID validation
    if (vals.subscriptionId && vals.subscriptionId.trim()) {
      if (vals.subscriptionId.length > 50) {
        newErrors.subscriptionId = "Subscription ID cannot exceed 50 characters";
      }
    }

    // Client Name validation
    if (vals.businessName && vals.businessName.trim()) {
      if (vals.businessName.length < 2) {
        newErrors.businessName = "Client name must be at least 2 characters";
      } else if (vals.businessName.length > 100) {
        newErrors.businessName = "Client name cannot exceed 100 characters";
      }
    }

    // Search Address validation
    if (vals.searchAddress && vals.searchAddress.trim()) {
      if (vals.searchAddress.length > 200) {
        newErrors.searchAddress = "Address cannot exceed 200 characters";
      }
    }

    // Card validation
    if (vals.lastFourCard && vals.lastFourCard.trim()) {
      if (!/^\d{4}$/.test(vals.lastFourCard)) {
        newErrors.lastFourCard = "Please enter exactly 4 digits (e.g., 1234)";
      }
    }

    // Next Bill Date validation
    if (vals.nextBillDate && vals.nextBillDate.trim()) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(vals.nextBillDate)) {
        newErrors.nextBillDate = "Please enter date in YYYY-MM-DD format (e.g., 2026-04-15)";
      } else {
        const date = new Date(vals.nextBillDate);
        if (isNaN(date.getTime())) {
          newErrors.nextBillDate = "Please enter a valid date";
        }
      }
    }

    // Start Date validation
    if (vals.startDate && vals.startDate.trim()) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(vals.startDate)) {
        newErrors.startDate = "Please enter date in YYYY-MM-DD format (e.g., 2026-01-15)";
      } else {
        const date = new Date(vals.startDate);
        if (isNaN(date.getTime())) {
          newErrors.startDate = "Please enter a valid date";
        }
      }
    }

    // Created By validation (REQUIRED)
    if (!vals.createdBy || !vals.createdBy.trim()) {
      newErrors.createdBy = "Please enter who is making these changes (this field is required)";
    } else if (vals.createdBy.length < 2) {
      newErrors.createdBy = "Name must be at least 2 characters";
    } else if (vals.createdBy.length > 50) {
      newErrors.createdBy = "Name cannot exceed 50 characters";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      const errorCount = Object.keys(newErrors).length;
      toast({
        title: "❌ Validation Error",
        description: `Please fix ${errorCount} ${errorCount === 1 ? 'error' : 'errors'} before saving.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      // Check if there are unsaved changes
      const hasChanges = Object.keys(vals).some(
        (key) => vals[key] !== initValues[key]
      );
      if (hasChanges) {
        setConfirmCancel(true);
        return;
      }
    }
    
    if (v) {
      setVals(initValues);
      setErrors({});
    }
    onOpenChange(v);
  }

  function handleSave() {
    if (validateFields()) {
      setConfirmSave(true);
    }
  }

  function handleConfirmSave() {
    setConfirmSave(false);
    onSave(vals);
  }

  function handleConfirmCancel() {
    setConfirmCancel(false);
    setVals(initValues);
    setErrors({});
    onOpenChange(false);
  }

  return (
    <>
      <FullScreenDialog
        open={open} onOpenChange={handleOpenChange}
        title="Edit Account Details" icon={Briefcase}
        saving={saving} onSave={handleSave}
      >
        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          {ACC_FIELDS.map((f) => (
            <div key={f.key} className={`space-y-2 ${f.wide ? "col-span-2" : ""}`}>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {f.label}
                {f.key === "createdBy" && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {f.dropdown ? (
                <Select
                  value={vals[f.key] ?? ""}
                  onValueChange={(v) => setVals((p) => ({ ...p, [f.key]: v }))}
                >
                  <SelectTrigger className="bg-muted/30 border-border/60 h-11 text-sm">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.dropdown.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className={`bg-muted/30 border-border/60 h-11 text-sm ${errors[f.key] ? "border-red-500" : ""}`}
                  placeholder={f.placeholder ?? ""}
                  maxLength={f.maxLength}
                  type={f.type}
                  value={vals[f.key] ?? ""}
                  onChange={(e) => {
                    setVals((p) => ({ ...p, [f.key]: e.target.value }));
                    if (errors[f.key]) {
                      setErrors((p) => {
                        const { [f.key]: _, ...rest } = p;
                        return rest;
                      });
                    }
                  }}
                />
              )}
              {errors[f.key] && (
                <p className="text-xs text-red-500 mt-1">{errors[f.key]}</p>
              )}
            </div>
          ))}
        </div>
      </FullScreenDialog>

      {/* Save Confirmation Dialog */}
      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to save the changes to the account details?
              This will update the information immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmSave(false)}>Go Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleConfirmSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Yes, Save Changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard your changes? All unsaved modifications will be lost. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmCancel(false)}>Continue Editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmCancel}
            >
              Yes, Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
