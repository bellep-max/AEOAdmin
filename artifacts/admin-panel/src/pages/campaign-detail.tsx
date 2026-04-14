import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CampaignFormDialog } from "@/components/CampaignFormDialog";
import { KeywordDialog, type KwRecord } from "@/components/KeywordDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ClipboardList, Key, Plus, Pencil, Trash2 } from "lucide-react";
import { getPlanMeta } from "@/lib/plan-meta";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers });
}

interface Campaign {
  id: number;
  clientId: number;
  businessId: number | null;
  name: string | null;
  businessName: string | null;
  planType: string;
  serviceCategory: string | null;
  targetCityRadius: string | null;
  currentAnswerPresence: string | null;
  searchBoostTarget: number | null;
  monthlyAeoBudget: number | null;
  schemaImplementor: string | null;
}

interface Keyword {
  id: number;
  keywordText: string;
  isActive: boolean | null;
  keywordType: number | null;
}

interface Business {
  id: number;
  name: string;
}

interface Client {
  id: number;
  businessName: string;
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      {value != null && value !== "" ? (
        <p className="text-sm text-foreground">{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground/40">—</p>
      )}
    </div>
  );
}

export default function CampaignDetail() {
  const [, params] = useRoute("/clients/:clientId/businesses/:businessId/campaigns/:campaignId");
  const clientId = Number(params?.clientId);
  const businessId = Number(params?.businessId);
  const campaignId = Number(params?.campaignId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteCampaign, setConfirmDeleteCampaign] = useState(false);
  const [kwDialogOpen, setKwDialogOpen] = useState(false);
  const [savingKw, setSavingKw] = useState(false);
  const [confirmDeleteKw, setConfirmDeleteKw] = useState<Keyword | null>(null);

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: ["/api/clients", clientId, "aeo-plans", campaignId],
    queryFn: async () => {
      const res = await rawFetch(`/api/clients/${clientId}/aeo-plans/${campaignId}`);
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

  const { data: keywords, refetch: refetchKeywords } = useQuery<Keyword[]>({
    queryKey: ["/api/keywords", { aeoPlanId: campaignId }],
    queryFn: async () => {
      const res = await rawFetch(`/api/keywords?aeoPlanId=${campaignId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!campaignId,
  });

  async function handleSaveKeyword(data: KwRecord) {
    setSavingKw(true);
    try {
      const { linkUrl, linkTypeLabel, linkActive, initialRankReportLink, currentRankReportLink, ...kwData } = data;
      const res = await rawFetch(`/api/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kwData,
          clientId,
          businessId,
          aeoPlanId: campaignId,
        }),
      });
      if (!res.ok) throw new Error();
      const newKw = await res.json();
      if (Number(kwData.keywordType) === 4) {
        await rawFetch(`/api/keywords/${newKw.id}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            linkUrl: linkUrl || null,
            linkTypeLabel: linkTypeLabel || null,
            linkActive,
            initialRankReportLink: initialRankReportLink || null,
            currentRankReportLink: currentRankReportLink || null,
          }),
        });
      }
      toast({ title: "Keyword added" });
      setKwDialogOpen(false);
      refetchKeywords();
    } catch {
      toast({ title: "Failed to add keyword", variant: "destructive" });
    } finally {
      setSavingKw(false);
    }
  }

  async function deleteCampaign() {
    try {
      const res = await rawFetch(`/api/clients/${clientId}/aeo-plans/${campaignId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Campaign deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "aeo-plans"] });
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
        <Link href={`/clients/${clientId}/businesses/${businessId}`} className="text-primary hover:underline mt-2 inline-block">
          ← Back to business
        </Link>
      </div>
    );
  }

  const meta = getPlanMeta(campaign.planType);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <Link href="/clients" className="hover:text-foreground transition-colors flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Clients
        </Link>
        <span>/</span>
        <Link href={`/clients/${clientId}`} className="hover:text-foreground transition-colors">
          {client?.businessName ?? "Client"}
        </Link>
        <span>/</span>
        <Link href={`/clients/${clientId}/businesses/${businessId}`} className="hover:text-foreground transition-colors">
          {business?.name ?? "Business"}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{campaign.planType} Campaign</span>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/60 p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
          <ClipboardList className="w-7 h-7 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">{campaign.name ?? `${campaign.planType} Campaign`}</h1>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass}`}>
              {campaign.planType}
            </span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.tierClass}`}>
              {meta.tier}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {campaign.serviceCategory} · {campaign.targetCityRadius}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditOpen(true)}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmDeleteCampaign(true)}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        </div>
      </div>

      <CampaignFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        clientId={clientId}
        businessId={businessId}
        campaign={campaign}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "aeo-plans", campaignId] });
        }}
      />

      <AlertDialog open={confirmDeleteCampaign} onOpenChange={setConfirmDeleteCampaign}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the campaign and all linked keywords. This cannot be undone.
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
            <Field label="Plan Type" value={campaign.planType} />
            <Field label="Tier" value={meta.tier} />
            <Field label="Service Category" value={campaign.serviceCategory} />
            <Field label="Target City / Radius" value={campaign.targetCityRadius} />
            <Field label="Answer Presence" value={campaign.currentAnswerPresence} />
            <Field label="Search Boost Target" value={campaign.searchBoostTarget} />
            <Field label="Monthly AEO Budget" value={campaign.monthlyAeoBudget} />
            <Field label="Schema Implementor" value={campaign.schemaImplementor} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            Keywords {keywords ? <span className="text-muted-foreground font-normal">({keywords.length})</span> : null}
          </CardTitle>
          <Button size="sm" className="h-8 gap-1" onClick={() => setKwDialogOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Keyword
          </Button>
        </CardHeader>
        <CardContent>
          {!keywords || keywords.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No keywords yet. Click <strong>Add Keyword</strong> to create one.
            </div>
          ) : (
            <div className="space-y-2">
              {keywords.map((kw) => (
                <div
                  key={kw.id}
                  className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{kw.keywordText}</span>
                    {kw.isActive === false && (
                      <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">inactive</Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteKeyword(kw.id)}
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <KeywordDialog
        open={kwDialogOpen}
        onOpenChange={setKwDialogOpen}
        title="Add Keyword"
        saving={savingKw}
        lockContext
        defaultClientId={clientId}
        defaultBusinessId={businessId}
        defaultCampaignId={campaignId}
        clients={client ? [{ id: client.id, businessName: client.businessName }] : []}
        businesses={business ? [{ id: business.id, clientId, name: business.name }] : []}
        plans={campaign ? [{
          id: campaign.id,
          clientId,
          businessId,
          name: campaign.name,
          planType: campaign.planType,
          serviceCategory: campaign.serviceCategory,
        }] : []}
        onSave={handleSaveKeyword}
      />
    </div>
  );
}
