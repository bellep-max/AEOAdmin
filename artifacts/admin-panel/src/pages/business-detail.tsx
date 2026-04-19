import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Pencil, ExternalLink, Building2, MapPin, ClipboardList, Plus, Trash2 } from "lucide-react";
import { AddBusinessDialog } from "@/components/AddBusinessDialog";
import { CampaignFormDialog } from "@/components/CampaignFormDialog";
import { getPlanMeta } from "@/lib/plan-meta";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocation } from "wouter";
import { RankingsSection } from "@/components/RankingsSection";
import { PlatformAggregateStrip } from "@/components/PlatformAggregateStrip";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers });
}

interface Business {
  id: number;
  clientId: number;
  name: string;
  category?: string | null;
  gmbUrl?: string | null;
  websiteUrl?: string | null;
  publishedAddress?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  placeId?: string | null;
  status: "active" | "inactive";
  notes?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

interface Client {
  id: number;
  businessName: string;
}

interface CampaignRow {
  id: number;
  name: string | null;
  planType: string;
  searchAddress: string | null;
  schemaImplementor: string | null;
  createdBy: string | null;
  keywordCount?: number;
}

function Field({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      {value ? (
        href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 break-all">
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

export default function BusinessDetail() {
  const [, params] = useRoute("/clients/:clientId/businesses/:businessId");
  const clientId = Number(params?.clientId);
  const businessId = Number(params?.businessId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignRow | null>(null);
  const [deletingCampaign, setDeletingCampaign] = useState<CampaignRow | null>(null);
  const [, navigate] = useLocation();

  const { data: business, isLoading } = useQuery<Business>({
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

  const { data: campaigns, refetch: refetchCampaigns } = useQuery<CampaignRow[]>({
    queryKey: ["/api/clients", clientId, "aeo-plans", { businessId }],
    queryFn: async () => {
      const res = await rawFetch(`/api/clients/${clientId}/aeo-plans?businessId=${businessId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!clientId && !!businessId,
  });

  async function deleteCampaign(id: number) {
    try {
      const res = await rawFetch(`/api/clients/${clientId}/aeo-plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Campaign deleted" });
      refetchCampaigns();
    } catch {
      toast({ title: "Failed to delete campaign", variant: "destructive" });
    } finally {
      setDeletingCampaign(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!business) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <p>Business not found.</p>
        <Link href={`/clients/${clientId}`} className="text-primary hover:underline mt-2 inline-block">
          ← Back to client
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/clients" className="hover:text-foreground transition-colors flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Clients
        </Link>
        <span>/</span>
        <Link href={`/clients/${clientId}`} className="hover:text-foreground transition-colors">
          {client?.businessName ?? "Client"}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{business.name}</span>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/60 p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-xl font-bold text-primary flex-shrink-0">
          <Building2 className="w-7 h-7" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">{business.name}</h1>
            <Badge
              variant="outline"
              className={business.status === "active"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-muted text-muted-foreground"}
            >
              {business.status}
            </Badge>
            {business.category && (
              <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/20">
                {business.category}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditOpen(true)}>
          <Pencil className="w-3.5 h-3.5" /> Edit
        </Button>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Business Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <Field label="Name" value={business.name} />
            <Field label="Service Category" value={business.category} />
            <Field label="Website" value={business.websiteUrl} href={business.websiteUrl ?? undefined} />
            <Field label="GMB URL" value={business.gmbUrl} href={business.gmbUrl ?? undefined} />
            <Field label="Published (GMB) Address" value={business.publishedAddress} />
            <Field label="City" value={business.city} />
            <Field label="State" value={business.state} />
            <Field label="Country" value={business.country} />
            <Field label="Place ID" value={business.placeId} />
            <Field label="Created By" value={business.createdBy} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Campaigns {campaigns ? <span className="text-muted-foreground font-normal">({campaigns.length})</span> : null}
          </CardTitle>
          <Button
            variant="outline" size="sm"
            className="h-7 px-2 gap-1 text-xs border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => { setEditingCampaign(null); setCampaignDialogOpen(true); }}
          >
            <Plus className="w-3 h-3" /> Add Campaign
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {!campaigns || campaigns.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No campaigns yet. Click <strong>Add Campaign</strong> to create one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Name</TableHead>
                    <TableHead>Plan Type</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => {
                    const meta = getPlanMeta(c.planType);
                    return (
                      <TableRow
                        key={c.id}
                        className="hover:bg-muted/30 cursor-pointer"
                        onClick={() => navigate(`/clients/${clientId}/businesses/${businessId}/campaigns/${c.id}`)}
                      >
                        <TableCell className="text-sm">
                          <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
                            <Link
                              href={`/clients/${clientId}/businesses/${businessId}/campaigns/${c.id}`}
                              className="font-semibold text-primary hover:underline"
                            >
                              {c.name ?? "(unnamed campaign)"}
                            </Link>
                            <Link
                              href={`/clients/${clientId}/businesses/${businessId}/campaigns/${c.id}`}
                              className="text-[11px] text-primary hover:underline w-fit"
                            >
                              {c.keywordCount ?? 0} active keyword{(c.keywordCount ?? 0) === 1 ? "" : "s"}
                            </Link>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass} whitespace-nowrap`}>
                            {c.planType}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.tierClass} whitespace-nowrap`}>
                            {meta.tier}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{c.createdBy ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => { setEditingCampaign(c); setCampaignDialogOpen(true); }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                              onClick={() => setDeletingCampaign(c)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PlatformAggregateStrip
        clientId={clientId}
        businessId={businessId}
        aeoPlanId={null}
        title={`Overall ranking · Business — ${business?.name ?? "Business"}`}
      />

      <CampaignFormDialog
        open={campaignDialogOpen}
        onOpenChange={(open) => { setCampaignDialogOpen(open); if (!open) setEditingCampaign(null); }}
        clientId={clientId}
        businessId={businessId}
        businessName={business?.name}
        campaign={editingCampaign}
        onSaved={() => refetchCampaigns()}
      />

      <AlertDialog open={!!deletingCampaign} onOpenChange={(open) => { if (!open) setDeletingCampaign(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign "{deletingCampaign?.name ?? deletingCampaign?.planType}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the campaign and all linked keywords. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingCampaign(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deletingCampaign) deleteCampaign(deletingCampaign.id); }}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddBusinessDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        clientId={clientId}
        business={business}
        onUpdated={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId] });
          toast({ title: "Business updated" });
        }}
      />
    </div>
  );
}
