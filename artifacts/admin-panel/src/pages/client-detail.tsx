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
import { useToast } from "@/hooks/use-toast";
import {
  ExternalLink, Pencil, ChevronLeft, Building2, CreditCard, Loader2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Read-only field ────────────────────────────────────────────────────── */
function Field({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
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

  const [editOpen, setEditOpen] = useState(false);
  const [saving,   setSaving]   = useState(false);

  const { data: client, isLoading } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: ["getClient", clientId] },
  });

  /* ── PATCH helper ── */
  async function patchClient(body: Record<string, string>) {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${clientId}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await queryClient.invalidateQueries({ queryKey: ["getClient", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Saved" });
      setEditOpen(false);
    } catch (err: unknown) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ── Loading / not found ── */
  if (isLoading) return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-80 w-full rounded-xl" />
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

  const c        = client as Record<string, unknown>;
  const initials = client.businessName
    ? client.businessName.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase()
    : "?";

  return (
    <div className="space-y-6 max-w-4xl">

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
          </div>
        </div>
      </div>

      {/* ── Business Details card ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Business Details
          </CardTitle>
          <Button
            variant="ghost" size="sm"
            className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="w-3 h-3" /> Edit
          </Button>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-5">

            <Field label="Business Name"              value={client.businessName} />
            <Field label="Plan"                       value={client.planName} />
            <Field label="Search Address"             value={client.searchAddress} />
            <Field label="GMB Address"                value={client.publishedAddress} />
            <Field
              label="GMB Link"
              value={client.gmbUrl}
              href={client.gmbUrl ?? undefined}
            />
            <Field
              label="Website Published on GMB"
              value={c.websitePublishedOnGmb as string}
              href={(c.websitePublishedOnGmb as string) ?? undefined}
            />
            <Field
              label="Website Linked to on GMB (if different)"
              value={c.websiteLinkedOnGmb as string}
              href={(c.websiteLinkedOnGmb as string) ?? undefined}
            />
            <Field label="Account User"               value={c.accountUser as string} />
            <Field label="Start Date"                 value={c.startDate as string} />
            <Field label="Next Bill Date"             value={c.nextBillDate as string} />
            <Field label="Subscription ID"            value={c.subscriptionId as string} />

            {/* Last 4 — special display with card icon */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
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

      {/* ═══════════════════════════════════════════════
          EDIT BUSINESS DETAILS DIALOG
      ═══════════════════════════════════════════════ */}
      <EditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        saving={saving}
        onSave={patchClient}
        values={{
          businessName:         client.businessName        ?? "",
          planName:             client.planName            ?? "",
          searchAddress:        client.searchAddress       ?? "",
          publishedAddress:     client.publishedAddress    ?? "",
          gmbUrl:               client.gmbUrl              ?? "",
          websitePublishedOnGmb: (c.websitePublishedOnGmb as string) ?? "",
          websiteLinkedOnGmb:   (c.websiteLinkedOnGmb  as string) ?? "",
          accountUser:          (c.accountUser          as string) ?? "",
          startDate:            (c.startDate            as string) ?? "",
          nextBillDate:         (c.nextBillDate         as string) ?? "",
          subscriptionId:       (c.subscriptionId       as string) ?? "",
          lastFourCard:         (c.lastFourCard         as string) ?? "",
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Edit Dialog                                                 */
/* ─────────────────────────────────────────────────────────── */

const FIELDS: Array<{
  key:         string;
  label:       string;
  placeholder?: string;
  maxLength?:  number;
}> = [
  { key: "businessName",          label: "Business Name" },
  { key: "planName",              label: "Plan" },
  { key: "searchAddress",         label: "Search Address" },
  { key: "publishedAddress",      label: "GMB Address" },
  { key: "gmbUrl",                label: "GMB Link",                              placeholder: "https://maps.google.com/…" },
  { key: "websitePublishedOnGmb", label: "Website Published on GMB",             placeholder: "https://…" },
  { key: "websiteLinkedOnGmb",    label: "Website Linked to on GMB (if different)", placeholder: "https://…" },
  { key: "accountUser",           label: "Account User" },
  { key: "startDate",             label: "Start Date",                            placeholder: "YYYY-MM-DD" },
  { key: "nextBillDate",          label: "Next Bill Date",                        placeholder: "YYYY-MM-DD" },
  { key: "subscriptionId",        label: "Subscription ID" },
  { key: "lastFourCard",          label: "Last 4 of Billing Credit Card",         placeholder: "e.g. 4242", maxLength: 4 },
];

function EditDialog({
  open, onOpenChange, saving, onSave, values: initValues,
}: {
  open:          boolean;
  onOpenChange:  (v: boolean) => void;
  saving:        boolean;
  onSave:        (vals: Record<string, string>) => void;
  values:        Record<string, string>;
}) {
  const [vals, setVals] = useState<Record<string, string>>(initValues);

  /* Re-sync form when the dialog opens (captures latest server data) */
  function handleOpenChange(v: boolean) {
    if (v) setVals(initValues);
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none max-h-none rounded-none border-0 border-border/60 bg-card overflow-y-auto flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-primary" />
            </div>
            <DialogTitle>Edit Business Details</DialogTitle>
          </div>
          <DialogDescription className="sr-only">Edit business details</DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col items-center justify-center px-8 py-6">
          <div className="w-full max-w-3xl">
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              {FIELDS.map((f) => (
                <div
                  key={f.key}
                  className={`space-y-2 ${
                    f.key === "gmbUrl" ||
                    f.key === "websitePublishedOnGmb" ||
                    f.key === "websiteLinkedOnGmb" ||
                    f.key === "searchAddress" ||
                    f.key === "publishedAddress"
                      ? "col-span-2"
                      : ""
                  }`}
                >
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {f.label}
                  </Label>
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

            <div className="flex gap-4 pt-10">
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
                onClick={() => onSave(vals)}
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
