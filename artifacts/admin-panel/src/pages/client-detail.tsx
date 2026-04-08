import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useGetClient } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import {
  ExternalLink, Pencil, ChevronLeft, Building2, CreditCard, Loader2, Briefcase,
} from "lucide-react";
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

  const [editBizOpen, setEditBizOpen] = useState(false);
  const [editAccOpen, setEditAccOpen] = useState(false);
  const [saving,      setSaving]      = useState(false);

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
      toast({ title: "Saved" });
      onSuccess();
    } catch (err: unknown) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
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

      {/* ── Unified profile card ── */}
      <Card className="border-border/50">

        {/* ─ Business Details ─ */}
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
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

        <CardContent className="pb-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-5">
            <Field label="Business Name"   value={client.businessName} />
            <Field label="Plan"            value={client.planName} />
            <Field label="Account User"    value={c.accountUser as string} />
            <Field label="Start Date"      value={c.startDate as string} />
            <Field label="Next Bill Date"  value={c.nextBillDate as string} />
            <Field label="Subscription ID" value={c.subscriptionId as string} />
            {/* Last 4 with card icon */}
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Last 4 Credit Card</p>
              {(c.lastFourCard as string) ? (
                <p className="text-sm text-foreground flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                  •••• {c.lastFourCard as string}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground/40">—</p>
              )}
            </div>
            <div className="col-span-2 sm:col-span-3 lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 pt-1">
              <Field label="Search Address"                        value={client.searchAddress} />
              <Field label="GMB Address"                           value={client.publishedAddress} />
              <Field label="GMB Link"                              value={client.gmbUrl} href={client.gmbUrl ?? undefined} />
              <Field label="Website Published on GMB"              value={c.websitePublishedOnGmb as string} href={(c.websitePublishedOnGmb as string) ?? undefined} />
              <Field label="Website Linked to on GMB (if different)" value={c.websiteLinkedOnGmb as string} href={(c.websiteLinkedOnGmb as string) ?? undefined} />
            </div>
          </div>
        </CardContent>

        <Separator />

        {/* ─ Account Details ─ */}
        <CardHeader className="pb-3 pt-5 flex flex-row items-center justify-between">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-5">
            <Field label="Account Type"            value={c.accountType as string} />
            <Field label="Account User Name"       value={c.accountUserName as string} />
            <Field label="Account Email"           value={c.accountEmail as string} />
            <Field label="Contact / Billing Email" value={c.billingEmail as string} />
          </div>
        </CardContent>

      </Card>

      {/* ═══ AEO PLANS ═══ */}
      <ClientAeoPlans clientId={clientId} clientBusinessName={client.businessName ?? ""} />

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
const BIZ_FIELDS: Array<{ key: string; label: string; placeholder?: string; maxLength?: number; wide?: boolean }> = [
  { key: "businessName",          label: "Business Name" },
  { key: "planName",              label: "Plan" },
  { key: "searchAddress",         label: "Search Address",                           wide: true },
  { key: "publishedAddress",      label: "GMB Address",                              wide: true },
  { key: "gmbUrl",                label: "GMB Link",                  placeholder: "https://maps.google.com/…", wide: true },
  { key: "websitePublishedOnGmb", label: "Website Published on GMB",  placeholder: "https://…", wide: true },
  { key: "websiteLinkedOnGmb",    label: "Website Linked to on GMB (if different)", placeholder: "https://…", wide: true },
  { key: "accountUser",           label: "Account User" },
  { key: "startDate",             label: "Start Date",                placeholder: "YYYY-MM-DD" },
  { key: "nextBillDate",          label: "Next Bill Date",            placeholder: "YYYY-MM-DD" },
  { key: "subscriptionId",        label: "Subscription ID" },
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

  function handleOpenChange(v: boolean) {
    if (v) setVals(initValues);
    onOpenChange(v);
  }

  return (
    <FullScreenDialog
      open={open} onOpenChange={handleOpenChange}
      title="Edit Business Details" icon={Building2}
      saving={saving} onSave={() => onSave(vals)}
    >
      <div className="grid grid-cols-2 gap-x-8 gap-y-6">
        {BIZ_FIELDS.map((f) => (
          <div key={f.key} className={`space-y-2 ${f.wide ? "col-span-2" : ""}`}>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{f.label}</Label>
            <Input
              className="bg-muted/30 border-border/60 h-11 text-sm"
              placeholder={f.placeholder ?? ""}
              maxLength={f.maxLength}
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
    </FullScreenDialog>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Edit Account Details                                         */
/* ─────────────────────────────────────────────────────────── */
const ACC_FIELDS: Array<{ key: string; label: string; placeholder?: string; maxLength?: number; wide?: boolean; dropdown?: string[] }> = [
  { key: "accountType",     label: "Account Type",             dropdown: ["Agency", "Retail"] },
  { key: "accountUserName", label: "Account User Name" },
  { key: "accountEmail",    label: "Account Email",            placeholder: "user@example.com", wide: true },
  { key: "billingEmail",    label: "Contact / Billing Email",  placeholder: "billing@example.com", wide: true },
  { key: "planName",        label: "Plan" },
  { key: "subscriptionId",  label: "Subscription ID" },
  { key: "businessName",    label: "Business Name" },
  { key: "searchAddress",   label: "Search Address",           wide: true },
  { key: "lastFourCard",    label: "Last 4 of Billing Credit Card", placeholder: "e.g. 4242", maxLength: 4 },
  { key: "nextBillDate",    label: "Next Bill Date",           placeholder: "YYYY-MM-DD" },
  { key: "startDate",       label: "Start Date",               placeholder: "YYYY-MM-DD" },
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

  function handleOpenChange(v: boolean) {
    if (v) setVals(initValues);
    onOpenChange(v);
  }

  return (
    <FullScreenDialog
      open={open} onOpenChange={handleOpenChange}
      title="Edit Account Details" icon={Briefcase}
      saving={saving} onSave={() => onSave(vals)}
    >
      <div className="grid grid-cols-2 gap-x-8 gap-y-6">
        {ACC_FIELDS.map((f) => (
          <div key={f.key} className={`space-y-2 ${f.wide ? "col-span-2" : ""}`}>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{f.label}</Label>
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
                className="bg-muted/30 border-border/60 h-11 text-sm"
                placeholder={f.placeholder ?? ""}
                maxLength={f.maxLength}
                value={vals[f.key] ?? ""}
                onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
    </FullScreenDialog>
  );
}
