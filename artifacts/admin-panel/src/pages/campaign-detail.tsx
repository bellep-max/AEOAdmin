import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CampaignFormDialog } from "@/components/CampaignFormDialog";
import { KeywordDialog, type KwRecord } from "@/components/KeywordDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  ClipboardList,
  CreditCard,
  Key,
  Plus,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { SalesEmailDialog } from "@/components/SalesEmailDialog";
import { FreeTrialProofDialog } from "@/components/FreeTrialProofDialog";
import { CampaignEmailsCard } from "@/components/CampaignEmailsCard";
import { getPlanMeta } from "@/lib/plan-meta";
import { KeywordsWithRankingsCard } from "@/components/KeywordsWithRankingsCard";
import { PerformanceSummaryCard } from "@/components/PerformanceSummaryCard";
import { RankTrendChart } from "@/components/RankTrendChart";
import { BiWeeklyGraphsCard } from "@/components/BiWeeklyGraphsCard";
import { PlatformAggregateStrip } from "@/components/PlatformAggregateStrip";
import { CampaignSessionsCard } from "@/components/CampaignSessionsCard";
import { CampaignAuditRankingsCard } from "@/components/CampaignAuditRankingsCard";
import { useAuth } from "@/lib/auth";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { credentials: "include", ...init, headers });
}

interface Campaign {
  id: number;
  clientId: number;
  businessId: number | null;
  name: string | null;
  businessName: string | null;
  planType: string;
  searchAddress: string | null;
  currentAnswerPresence: string | null;
  searchBoostTarget: number | null;
  monthlyAeoBudget: number | null;
  schemaImplementor: string | null;
  subscriptionId: string | null;
  subscriptionStartDate: string | null;
  nextBillingDate: string | null;
  cardLast4: string | null;
  createdBy: string | null;
  campaignStatus: string;
  cancelReason: string | null;
  canceledAt: string | null;
  trialStartDate: string | null;
  trialEndDate: string | null;
  paidConversionDate: string | null;
}

interface BillingSummary {
  hasStripeRef: boolean;
  summary: {
    stripeCustomerId: string | null;
    billingEmail: string | null;
    cardLast4: string | null;
    subscription: {
      id: string;
      status: string;
      monthlyPrice: number | null;
      currency: string | null;
      billingCycle: string | null;
      trialStartDate: string | null;
      trialEndDate: string | null;
      trialConversionDate: string | null;
      cancelAtPeriodEnd: boolean;
      canceledAt: string | null;
      cancelEffectiveDate: string | null;
      currentPeriodEnd: string | null;
    } | null;
    charges: Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      date: string | null;
      description: string | null;
    }>;
    paymentStatus: string | null;
    hasFailedPayment: boolean;
    lastPaymentDate: string | null;
  } | null;
}

interface Keyword {
  id: number;
  keywordText: string;
  isActive: boolean | null;
  keywordType: number | null;
  isPrimary?: number | null;
  links?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface Business {
  id: number;
  name: string;
}

interface Client {
  id: number;
  businessName: string;
  source: string | null;
}

function Field({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </p>
      {value != null && value !== "" ? (
        <p className="text-sm text-foreground">{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground/40">—</p>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  paused: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  canceled: "bg-red-500/10 text-red-500 border-red-500/20",
};

/** Editor-gated inline editor for campaign status, cancel reason and the
 *  trial/paid dates. PATCHes the plan directly — separate from the big
 *  CampaignFormDialog so lifecycle changes stay one click away. */
function CampaignLifecycleEditor({
  clientId,
  campaign,
  onSaved,
}: {
  clientId: number;
  campaign: Campaign;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState(campaign.campaignStatus || "active");
  const [cancelReason, setCancelReason] = useState(campaign.cancelReason ?? "");
  const [trialStart, setTrialStart] = useState(
    (campaign.trialStartDate ?? "").slice(0, 10),
  );
  const [trialEnd, setTrialEnd] = useState(
    (campaign.trialEndDate ?? "").slice(0, 10),
  );
  const [paidDate, setPaidDate] = useState(
    (campaign.paidConversionDate ?? "").slice(0, 10),
  );
  const [saving, setSaving] = useState(false);

  const dirty =
    status !== (campaign.campaignStatus || "active") ||
    cancelReason.trim() !== (campaign.cancelReason ?? "").trim() ||
    trialStart !== (campaign.trialStartDate ?? "").slice(0, 10) ||
    trialEnd !== (campaign.trialEndDate ?? "").slice(0, 10) ||
    paidDate !== (campaign.paidConversionDate ?? "").slice(0, 10);

  async function save() {
    setSaving(true);
    try {
      const res = await rawFetch(
        `/api/clients/${clientId}/aeo-plans/${campaign.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignStatus: status,
            cancelReason: cancelReason.trim() || null,
            trialStartDate: trialStart || null,
            trialEndDate: trialEnd || null,
            paidConversionDate: paidDate || null,
          }),
        },
      );
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).error ?? "Failed");
      toast({ title: "Campaign updated" });
      onSaved();
    } catch (err: unknown) {
      toast({
        title: err instanceof Error ? err.message : "Failed to save",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="col-span-full border-t border-border/50 pt-4 mt-1 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Campaign Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Trial Start Date</Label>
          <Input
            type="date"
            className="h-9"
            value={trialStart}
            onChange={(e) => setTrialStart(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Trial End Date</Label>
          <Input
            type="date"
            className="h-9"
            value={trialEnd}
            onChange={(e) => setTrialEnd(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Paid / Conversion Date</Label>
          <Input
            type="date"
            className="h-9"
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
          />
        </div>
      </div>
      {status === "canceled" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Reason they canceled</Label>
          <Textarea
            rows={2}
            placeholder="Why did the client cancel? This is kept as data."
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </div>
      )}
      {dirty && (
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      )}
    </div>
  );
}

export default function CampaignDetail() {
  const [, params] = useRoute(
    "/clients/:clientId/businesses/:businessId/campaigns/:campaignId",
  );
  const clientId = Number(params?.clientId);
  const businessId = Number(params?.businessId);
  const campaignId = Number(params?.campaignId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, isEditor, isOwner } = useAuth();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [salesEmailOpen, setSalesEmailOpen] = useState(false);
  const [ftpOpen, setFtpOpen] = useState(false);
  const [confirmDeleteCampaign, setConfirmDeleteCampaign] = useState(false);
  const [kwDialogOpen, setKwDialogOpen] = useState(false);
  const [savingKw, setSavingKw] = useState(false);
  const [editingKw, setEditingKw] = useState<KwRecord | null>(null);
  const [confirmDeleteKw, setConfirmDeleteKw] = useState<Keyword | null>(null);

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: ["/api/clients", clientId, "aeo-plans", campaignId],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/clients/${clientId}/aeo-plans/${campaignId}`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!clientId && !!campaignId,
  });

  const { data: business } = useQuery<Business>({
    queryKey: ["/api/businesses", businessId],
    queryFn: async () => {
      const res = await rawFetch(`/api/businesses/${businessId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!businessId,
  });

  const { data: client } = useQuery<Client>({
    queryKey: ["/api/clients", clientId],
    queryFn: async () => {
      const res = await rawFetch(`/api/clients/${clientId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!clientId,
  });

  // Live Stripe billing — admin/owner only (the endpoint 403s below that).
  const { data: billing } = useQuery<BillingSummary>({
    queryKey: ["/api/clients", clientId, "aeo-plans", campaignId, "billing"],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/clients/${clientId}/aeo-plans/${campaignId}/billing`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!clientId && !!campaignId && isAdmin,
    staleTime: 60_000,
  });

  const { data: keywords, refetch: refetchKeywords } = useQuery<Keyword[]>({
    queryKey: ["/api/keywords", { aeoPlanId: campaignId }],
    queryFn: async () => {
      const res = await rawFetch(`/api/keywords?aeoPlanId=${campaignId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!campaignId,
  });

  // Locked/won keywords — shown in their own card. They stay rankable (we keep
  // running them to confirm they hold top-3), so they're excluded from the main
  // active list above and surfaced separately here.
  const { data: lockedKeywords } = useQuery<Keyword[]>({
    queryKey: ["/api/keywords", { aeoPlanId: campaignId, status: "locked" }],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/keywords?aeoPlanId=${campaignId}&status=locked`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!campaignId,
  });

  async function handleSaveKeyword(data: KwRecord) {
    setSavingKw(true);
    try {
      const {
        id,
        linkUrl,
        linkTypeLabel,
        linkActive,
        embeddedUrl,
        initialRankReportLink,
        currentRankReportLink,
        ...kwData
      } = data;
      const isEdit = id != null;
      const url = isEdit ? `/api/keywords/${id}` : `/api/keywords`;
      const res = await rawFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kwData,
          clientId,
          businessId,
          aeoPlanId: campaignId,
        }),
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      const kwId = isEdit ? id : saved.id;
      if (Number(kwData.keywordType) === 4) {
        await rawFetch(`/api/keywords/${kwId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            linkUrl: linkUrl || null,
            linkTypeLabel: linkTypeLabel || null,
            embeddedUrl: embeddedUrl || null,
            linkActive,
            initialRankReportLink: initialRankReportLink || null,
            currentRankReportLink: currentRankReportLink || null,
          }),
        });
      }
      toast({ title: isEdit ? "Keyword updated" : "Keyword added" });
      setKwDialogOpen(false);
      setEditingKw(null);
      refetchKeywords();
    } catch {
      toast({ title: "Failed to save keyword", variant: "destructive" });
    } finally {
      setSavingKw(false);
    }
  }

  async function deleteCampaign() {
    try {
      const res = await rawFetch(
        `/api/clients/${clientId}/aeo-plans/${campaignId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      toast({ title: "Campaign deleted" });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", clientId, "aeo-plans"],
      });
      navigate(`/clients/${clientId}/businesses/${businessId}`);
    } catch {
      toast({ title: "Failed to delete campaign", variant: "destructive" });
    } finally {
      setConfirmDeleteCampaign(false);
    }
  }

  async function deleteKeyword(id: number) {
    try {
      const res = await rawFetch(`/api/keywords/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error();
      toast({ title: "Keyword deleted" });
      refetchKeywords();
    } catch {
      toast({ title: "Failed to delete keyword", variant: "destructive" });
    } finally {
      setConfirmDeleteKw(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <p>Campaign not found.</p>
        <Link
          href={`/clients/${clientId}/businesses/${businessId}`}
          className="text-primary hover:underline mt-2 inline-block"
        >
          ← Back to business
        </Link>
      </div>
    );
  }

  const meta = getPlanMeta(campaign.planType);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <Link
          href="/clients"
          className="hover:text-foreground transition-colors flex items-center gap-1"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Clients
        </Link>
        <span>/</span>
        <Link
          href={`/clients/${clientId}`}
          className="hover:text-foreground transition-colors"
        >
          {client?.businessName ?? "Client"}
        </Link>
        <span>/</span>
        <Link
          href={`/clients/${clientId}/businesses/${businessId}`}
          className="hover:text-foreground transition-colors"
        >
          {business?.name ?? "Business"}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">
          {campaign.planType} Campaign
        </span>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/60 p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
          <ClipboardList className="w-7 h-7 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">
              {campaign.name ?? `${campaign.planType} Campaign`}
            </h1>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass}`}
            >
              {campaign.planType}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.tierClass}`}
            >
              {meta.tier}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {campaign.searchAddress ?? ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            className="gap-1"
            onClick={() => setSalesEmailOpen(true)}
          >
            <Send className="w-3.5 h-3.5" /> Send proof
          </Button>
          {isOwner && campaign.planType === "Free Trial Plans" && (
            <Button
              size="sm"
              variant="secondary"
              className="gap-1"
              onClick={() => setFtpOpen(true)}
            >
              <Send className="w-3.5 h-3.5" /> Send free-trial proof
            </Button>
          )}
          {isEditor && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmDeleteCampaign(true)}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Proof emails scoped to THIS campaign — the screenshot pool only
          offers this campaign's keywords. */}
      <SalesEmailDialog
        open={salesEmailOpen}
        onClose={() => setSalesEmailOpen(false)}
        clientId={clientId}
        businessId={businessId}
        aeoPlanId={campaignId}
      />
      <FreeTrialProofDialog
        open={ftpOpen}
        onClose={() => setFtpOpen(false)}
        clientId={clientId}
        businessId={businessId}
        aeoPlanId={campaignId}
      />

      <CampaignFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        clientId={clientId}
        businessId={businessId}
        businessName={business?.name}
        campaign={campaign}
        onSaved={() => {
          queryClient.invalidateQueries({
            queryKey: ["/api/clients", clientId, "aeo-plans", campaignId],
          });
        }}
      />

      <AlertDialog
        open={confirmDeleteCampaign}
        onOpenChange={setConfirmDeleteCampaign}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the campaign and all linked keywords.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={deleteCampaign}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Campaign Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <Field label="Product" value="Signal AEO" />
            <Field label="Plan Tier" value={campaign.planType} />
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Campaign Status
              </p>
              <Badge
                variant="outline"
                className={`capitalize ${STATUS_BADGE[campaign.campaignStatus] ?? ""}`}
              >
                {campaign.campaignStatus || "active"}
              </Badge>
            </div>
            <Field
              label="Primary Campaign Goal"
              value="Reach Top 3 in AI answers"
            />
            <Field
              label="Primary Search Location"
              value={campaign.searchAddress}
            />
            <Field
              label="Signup Source"
              value={client?.source ?? campaign.createdBy}
            />
            <Field
              label="Trial Start Date"
              value={(campaign.trialStartDate ?? "").slice(0, 10) || null}
            />
            <Field
              label="Trial End Date"
              value={(campaign.trialEndDate ?? "").slice(0, 10) || null}
            />
            <Field
              label="Paid / Conversion Date"
              value={(campaign.paidConversionDate ?? "").slice(0, 10) || null}
            />
            <Field label="Created By" value={campaign.createdBy} />
            {campaign.campaignStatus === "canceled" && (
              <>
                <Field
                  label="Canceled On"
                  value={(campaign.canceledAt ?? "").slice(0, 10) || null}
                />
                <Field
                  label="Reason they canceled"
                  value={campaign.cancelReason}
                />
              </>
            )}
            {isEditor && (
              <CampaignLifecycleEditor
                key={`${campaign.id}-${campaign.campaignStatus}-${campaign.trialStartDate}-${campaign.trialEndDate}-${campaign.paidConversionDate}-${campaign.cancelReason}`}
                clientId={clientId}
                campaign={campaign}
                onSaved={() =>
                  queryClient.invalidateQueries({
                    queryKey: ["/api/clients", clientId, "aeo-plans", campaignId],
                  })
                }
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            Subscription
            {billing?.summary?.hasFailedPayment && (
              <Badge variant="destructive" className="ml-1">
                Payment failed
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <Field label="Subscription ID" value={campaign.subscriptionId} />
            <Field
              label="Card (last 4)"
              value={
                (billing?.summary?.cardLast4 ?? campaign.cardLast4)
                  ? `•••• ${billing?.summary?.cardLast4 ?? campaign.cardLast4}`
                  : null
              }
            />
            <Field
              label="Start Date"
              value={(campaign.subscriptionStartDate ?? "").slice(0, 10) || null}
            />
            <Field
              label="Next Billing Date"
              value={
                billing?.summary?.subscription?.currentPeriodEnd ??
                ((campaign.nextBillingDate ?? "").slice(0, 10) || null)
              }
            />
          </div>

          {/* Live Stripe state — admin/owner only (the query is gated). */}
          {billing?.summary && (
            <div className="border-t border-border/50 pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Subscription Status
                </p>
                {billing.summary.subscription ? (
                  <Badge variant="outline" className="capitalize">
                    {billing.summary.subscription.status}
                  </Badge>
                ) : (
                  <p className="text-sm text-muted-foreground/60">
                    No subscription yet — card on file only
                  </p>
                )}
              </div>
              <Field
                label="Monthly Price"
                value={
                  billing.summary.subscription?.monthlyPrice != null
                    ? `$${billing.summary.subscription.monthlyPrice.toFixed(2)} ${(billing.summary.subscription.currency ?? "").toUpperCase()}`
                    : null
                }
              />
              <Field
                label="Billing Cycle"
                value={
                  billing.summary.subscription?.billingCycle
                    ? `per ${billing.summary.subscription.billingCycle}`
                    : null
                }
              />
              <Field
                label="Trial Start (Stripe)"
                value={billing.summary.subscription?.trialStartDate}
              />
              <Field
                label="Trial Conversion Date"
                value={billing.summary.subscription?.trialConversionDate}
              />
              <Field
                label="Payment Status"
                value={billing.summary.paymentStatus}
              />
              <Field
                label="Cancellation Status"
                value={
                  billing.summary.subscription
                    ? billing.summary.subscription.status === "canceled"
                      ? "canceled"
                      : billing.summary.subscription.cancelAtPeriodEnd
                        ? "cancels at period end"
                        : "not canceled"
                    : null
                }
              />
              <Field
                label="Cancellation Effective"
                value={billing.summary.subscription?.cancelEffectiveDate}
              />
              <Field
                label="Failed-Payment Status"
                value={billing.summary.hasFailedPayment ? "FAILED" : "none"}
              />
              <Field
                label="Last Payment Date"
                value={billing.summary.lastPaymentDate}
              />
            </div>
          )}

          {/* Charge history — amount + date, newest first. */}
          {billing?.summary && billing.summary.charges.length > 0 && (
            <div className="border-t border-border/50 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
                Charge History
              </p>
              <div className="space-y-1.5">
                {billing.summary.charges.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex items-center gap-3 text-sm border-b border-border/30 last:border-b-0 pb-1.5"
                  >
                    <span className="text-muted-foreground w-28 flex-shrink-0">
                      {ch.date ?? "—"}
                    </span>
                    <span className="font-medium w-28 flex-shrink-0">
                      ${ch.amount.toFixed(2)} {ch.currency.toUpperCase()}
                    </span>
                    <Badge
                      variant={
                        ch.status === "succeeded"
                          ? "outline"
                          : ch.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                      className="capitalize"
                    >
                      {ch.status}
                    </Badge>
                    <span className="text-muted-foreground truncate">
                      {ch.description ?? ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {billing != null && !billing.hasStripeRef && (
            <p className="text-xs text-muted-foreground">
              No Stripe customer/subscription is linked to this campaign.
            </p>
          )}
        </CardContent>
      </Card>

      <CampaignEmailsCard clientId={clientId} aeoPlanId={campaignId} />

      <PerformanceSummaryCard
        clientId={clientId}
        businessId={businessId}
        aeoPlanId={campaignId}
        title="Overall Performance summary · this campaign"
      />

      <RankTrendChart
        scope="campaign"
        clientId={clientId}
        businessId={businessId}
        aeoPlanId={campaignId}
      />

      <BiWeeklyGraphsCard
        scope="campaign"
        clientId={clientId}
        businessId={businessId}
        aeoPlanId={campaignId}
      />

      <PlatformAggregateStrip
        clientId={clientId}
        businessId={businessId}
        aeoPlanId={campaignId}
        title={`Overall ranking · Campaign — ${campaign.name ?? campaign.planType}`}
      />

      <KeywordsWithRankingsCard
        title="Keywords"
        clientId={clientId}
        businessId={businessId}
        aeoPlanId={campaignId}
        addButton={
          isEditor ? (
            <Button
              size="sm"
              className="h-8 gap-1"
              onClick={() => setKwDialogOpen(true)}
            >
              <Plus className="w-3.5 h-3.5" /> Add Keyword
            </Button>
          ) : undefined
        }
        onEditKeyword={
          isEditor
            ? (id) => {
                const kw = (keywords ?? []).find((k) => k.id === id);
                if (!kw) {
                  toast({ title: "Keyword not found", variant: "destructive" });
                  return;
                }
                setEditingKw(kw as unknown as KwRecord);
              }
            : undefined
        }
        onDeleteKeyword={
          isAdmin
            ? (id) => {
                const kw = (keywords ?? []).find((k) => k.id === id);
                if (kw) setConfirmDeleteKw(kw);
                else deleteKeyword(id);
              }
            : undefined
        }
        extraKeywords={(keywords ?? [])
          .filter((k) => {
            const status = String((k as { status?: unknown }).status ?? "");
            return (
              k.isActive !== false &&
              status !== "archived" &&
              status !== "locked"
            );
          })
          .map((k) => ({ id: k.id, keywordText: k.keywordText }))}
        showRotation
        onRotated={() => {
          refetchKeywords();
        }}
      />

      {(lockedKeywords?.length ?? 0) > 0 && (
        <KeywordsWithRankingsCard
          title="Locked / Won Keywords"
          clientId={clientId}
          businessId={businessId}
          aeoPlanId={campaignId}
          extraKeywords={(lockedKeywords ?? []).map((k) => ({
            id: k.id,
            keywordText: k.keywordText,
          }))}
          restrictToKeywordIds={(lockedKeywords ?? []).map((k) => k.id)}
          collapsible
          defaultCollapsed
          lockedView
        />
      )}

      <KeywordDialog
        open={kwDialogOpen}
        onOpenChange={setKwDialogOpen}
        title="Add Keyword"
        saving={savingKw}
        lockContext
        defaultClientId={clientId}
        defaultBusinessId={businessId}
        defaultCampaignId={campaignId}
        clients={
          client ? [{ id: client.id, businessName: client.businessName }] : []
        }
        businesses={
          business ? [{ id: business.id, clientId, name: business.name }] : []
        }
        plans={
          campaign
            ? [
                {
                  id: campaign.id,
                  clientId,
                  businessId,
                  name: campaign.name,
                  planType: campaign.planType,
                },
              ]
            : []
        }
        onSave={handleSaveKeyword}
      />

      {editingKw && (
        <KeywordDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditingKw(null);
          }}
          title="Edit Keyword"
          saving={savingKw}
          lockContext
          defaultClientId={clientId}
          defaultBusinessId={businessId}
          defaultCampaignId={campaignId}
          clients={
            client ? [{ id: client.id, businessName: client.businessName }] : []
          }
          businesses={
            business ? [{ id: business.id, clientId, name: business.name }] : []
          }
          plans={
            campaign
              ? [
                  {
                    id: campaign.id,
                    clientId,
                    businessId,
                    name: campaign.name,
                    planType: campaign.planType,
                  },
                ]
              : []
          }
          initial={editingKw}
          onSave={handleSaveKeyword}
        />
      )}

      <CampaignSessionsCard campaignId={campaignId} />

      <CampaignAuditRankingsCard campaignId={campaignId} />

      <AlertDialog
        open={!!confirmDeleteKw}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteKw(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this keyword?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <strong>"{confirmDeleteKw?.keywordText ?? ""}"</strong> and any
              associated links. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeleteKw(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = confirmDeleteKw?.id;
                setConfirmDeleteKw(null);
                if (id != null) deleteKeyword(id);
              }}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
