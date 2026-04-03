import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetClient,
  useGetClientGbpSnippet,
  useGetClientAeoSummary,
  useGetSessions,
  useUpdateClient,
  useGetKeywords,
  useUpdateKeyword,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  MapPin, Globe, ExternalLink, ArrowUp, ArrowDown, Minus, Activity,
  Pencil, Plus, Key, ChevronLeft, Building2, Mail, Star, Link2,
  Loader2, CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Schemas ──────────────────────────────────────────── */
const editClientSchema = z.object({
  businessName:     z.string().min(2, "Required"),
  city:             z.string().optional(),
  state:            z.string().optional(),
  planName:         z.string().optional(),
  status:           z.enum(["active", "inactive"]),
  gmbUrl:           z.string().url("Must be a valid URL").optional().or(z.literal("")),
  websiteUrl:       z.string().url("Must be a valid URL").optional().or(z.literal("")),
  contactEmail:     z.string().email("Must be a valid email").optional().or(z.literal("")),
  publishedAddress: z.string().optional(),
});
type EditClientForm = z.infer<typeof editClientSchema>;

const addKeywordSchema = z.object({
  keywordText:   z.string().min(2, "At least 2 characters"),
  keywordType:   z.enum(["1", "2"]),
  isPrimary:     z.boolean(),
  isActive:      z.boolean(),
  backlinkCount: z.coerce.number().min(0).max(100),
});
type AddKeywordForm = z.infer<typeof addKeywordSchema>;

const VERIFY_MAP = {
  verified: { icon: CheckCircle2, label: "Verified", cls: "text-emerald-400" },
  failed:   { icon: XCircle,      label: "Failed",   cls: "text-destructive" },
  pending:  { icon: Clock,        label: "Pending",  cls: "text-amber-400"   },
} as const;

/* ── Component ────────────────────────────────────────── */
export default function ClientDetail() {
  const [, params]  = useRoute("/clients/:id");
  const clientId    = Number(params?.id);
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [editOpen, setEditOpen]   = useState(false);
  const [kwOpen, setKwOpen]       = useState(false);
  const [saving, setSaving]       = useState(false);
  const [addingKw, setAddingKw]   = useState(false);

  const { data: client,  isLoading: isClientLoading }  = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: ["getClient", clientId] },
  });
  const { data: snippet, isLoading: isSnippetLoading } = useGetClientGbpSnippet(clientId, {
    query: { enabled: !!clientId, queryKey: ["getGbpSnippet", clientId] },
  });
  const { data: aeo,     isLoading: isAeoLoading }     = useGetClientAeoSummary(clientId, {
    query: { enabled: !!clientId, queryKey: ["getAeoSummary", clientId] },
  });
  const { data: sessions, isLoading: isSessionsLoading } = useGetSessions(
    { clientId, limit: 10 },
    { query: { enabled: !!clientId, queryKey: ["getSessions", clientId] } },
  );
  const { data: allKeywords } = useGetKeywords();
  const clientKeywords = allKeywords?.filter((k) => k.clientId === clientId) ?? [];

  const updateClient  = useUpdateClient();
  const updateKeyword = useUpdateKeyword();

  /* Edit client form */
  const editForm = useForm<EditClientForm>({
    resolver: zodResolver(editClientSchema),
    values: client
      ? {
          businessName:     client.businessName ?? "",
          city:             client.city ?? "",
          state:            client.state ?? "",
          planName:         client.planName ?? "",
          status:           (client.status as "active" | "inactive") ?? "active",
          gmbUrl:           client.gmbUrl ?? "",
          websiteUrl:       client.websiteUrl ?? "",
          contactEmail:     client.contactEmail ?? "",
          publishedAddress: client.publishedAddress ?? "",
        }
      : undefined,
  });

  async function onEditSubmit(values: EditClientForm) {
    setSaving(true);
    updateClient.mutate(
      { id: clientId, data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["getClient", clientId] });
          queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
          toast({ title: "Profile updated" });
          setEditOpen(false);
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
        onSettled: () => setSaving(false),
      },
    );
  }

  /* Add keyword form */
  const kwForm = useForm<AddKeywordForm>({
    resolver: zodResolver(addKeywordSchema),
    defaultValues: {
      keywordText:   "",
      keywordType:   "1",
      isPrimary:     false,
      isActive:      true,
      backlinkCount: 0,
    },
  });

  async function onAddKeyword(values: AddKeywordForm) {
    setAddingKw(true);
    try {
      const res = await fetch(`${BASE}/api/keywords`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywordText:   values.keywordText,
          clientId,
          tierLabel:     "aeo",
          keywordType:   Number(values.keywordType),
          isPrimary:     values.isPrimary ? 1 : 0,
          isActive:      values.isActive,
          backlinkCount: values.backlinkCount,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: "Keyword added" });
      kwForm.reset();
      setKwOpen(false);
    } catch (err: unknown) {
      toast({ title: "Failed to add keyword", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setAddingKw(false);
    }
  }

  function handleKwToggle(id: number, isActive: boolean) {
    updateKeyword.mutate(
      { id, data: { isActive } },
      {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/keywords"] }); },
        onError:   () => toast({ title: "Update failed", variant: "destructive" }),
      },
    );
  }

  /* ── Avatar initials ── */
  const initials = client?.businessName
    ? client.businessName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : "?";

  if (isClientLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
        <Building2 className="w-12 h-12 opacity-20" />
        <p>Client not found</p>
        <Link href="/clients"><Button variant="outline" size="sm">Back to Clients</Button></Link>
      </div>
    );
  }

  const watchKwType = kwForm.watch("keywordType");

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

      {/* ── Hero header ── */}
      <div className="rounded-xl border border-border/50 bg-card/60 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* Avatar */}
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-xl font-bold text-primary flex-shrink-0">
          {initials}
        </div>

        {/* Info */}
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
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
            {client.city && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{client.city}, {client.state}</span>}
            {client.contactEmail && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{client.contactEmail}</span>}
            {client.websiteUrl && (
              <a href={client.websiteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                <Globe className="w-3.5 h-3.5" /> Website <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-border/60"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="w-3.5 h-3.5" /> Edit Profile
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.3)" }}
            onClick={() => setKwOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Add Keyword
          </Button>
        </div>
      </div>

      {/* ── Two column: GBP + AEO Performance ── */}
      <div className="grid gap-6 md:grid-cols-2">

        {/* GBP Card */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              Google Business Profile
            </CardTitle>
            <CardDescription>Verified GBP map entity</CardDescription>
          </CardHeader>
          <CardContent>
            {isSnippetLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : snippet ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{snippet.businessName}</span>
                      <Badge
                        variant="outline"
                        className={
                          snippet.verificationStatus === "verified"
                            ? "border-emerald-500/30 text-emerald-400 text-[10px]"
                            : snippet.verificationStatus === "failed"
                            ? "border-destructive/30 text-destructive text-[10px]"
                            : "border-amber-500/30 text-amber-400 text-[10px]"
                        }
                      >
                        {snippet.verificationStatus}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 break-all">{snippet.publishedAddress || "No address"}</p>
                    {snippet.placeId && (
                      <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">Place ID: {snippet.placeId}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  {snippet.gmbUrl && (
                    <a href={snippet.gmbUrl} target="_blank" rel="noreferrer"
                      className="text-xs flex items-center gap-1 text-primary hover:underline">
                      <MapPin className="w-3 h-3" /> View on Maps
                    </a>
                  )}
                  {client.websiteUrl && (
                    <a href={client.websiteUrl} target="_blank" rel="noreferrer"
                      className="text-xs flex items-center gap-1 text-primary hover:underline">
                      <Globe className="w-3 h-3" /> Website
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-2">
                <MapPin className="w-6 h-6 opacity-20" />
                <p className="text-xs">No GBP data — add a Google Maps URL when editing the profile</p>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setEditOpen(true)}>
                  <Pencil className="w-3 h-3" /> Edit Profile
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AEO Campaign Card */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              AEO Campaign Performance
            </CardTitle>
            <CardDescription>Clicks delivered and ranking data</CardDescription>
          </CardHeader>
          <CardContent>
            {isAeoLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : aeo ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/30 border border-border/40 p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total Clicks</p>
                    <p className="text-2xl font-bold text-foreground">{aeo.totalClicksDelivered.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-border/40 p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Avg. Rank</p>
                    <p className="text-2xl font-bold text-foreground">
                      {aeo.averageRankingPosition ? aeo.averageRankingPosition.toFixed(1) : "—"}
                    </p>
                  </div>
                </div>
                {aeo.aeoKeywords.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top Keywords</p>
                    <div className="space-y-1.5">
                      {aeo.aeoKeywords.slice(0, 4).map((kw) => {
                        const delta = (kw.initialRankingPosition ?? 0) - (kw.currentRankingPosition ?? 0);
                        return (
                          <div key={kw.keywordId} className="flex items-center justify-between text-xs px-2.5 py-1.5 bg-muted/30 rounded-md border border-border/30">
                            <span className="font-medium truncate max-w-[140px]" title={kw.keywordText}>{kw.keywordText}</span>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-muted-foreground">{kw.clicksDelivered} clicks</span>
                              <span className="font-mono flex items-center gap-0.5">
                                {kw.currentRankingPosition ?? "—"}
                                {delta > 0 ? <ArrowUp className="w-3 h-3 text-emerald-400" /> :
                                 delta < 0 ? <ArrowDown className="w-3 h-3 text-destructive" /> :
                                             <Minus className="w-3 h-3 text-muted-foreground" />}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-2">
                <Activity className="w-6 h-6 opacity-20" />
                <p className="text-xs">No AEO metrics yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Keywords for this client ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              Keywords
              <Badge variant="outline" className="text-[10px] text-muted-foreground">{clientKeywords.length}</Badge>
            </CardTitle>
            <CardDescription>AEO prompt keywords assigned to this client</CardDescription>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-border/60" onClick={() => setKwOpen(true)}>
            <Plus className="w-3 h-3" /> Add Keyword
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {clientKeywords.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-20 text-muted-foreground gap-2">
              <Key className="w-5 h-5 opacity-20" />
              <p className="text-xs">No keywords yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-xs text-muted-foreground/60 uppercase w-6"></TableHead>
                  <TableHead className="text-xs text-muted-foreground/60 uppercase">Keyword</TableHead>
                  <TableHead className="text-xs text-muted-foreground/60 uppercase">Type</TableHead>
                  <TableHead className="text-xs text-muted-foreground/60 uppercase text-right">Clicks</TableHead>
                  <TableHead className="text-xs text-muted-foreground/60 uppercase">Status</TableHead>
                  <TableHead className="text-xs text-muted-foreground/60 uppercase text-center">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientKeywords.map((kw) => {
                  const verify   = VERIFY_MAP[kw.verificationStatus as keyof typeof VERIFY_MAP] ?? VERIFY_MAP.pending;
                  const VerifyIcon = verify.icon;
                  return (
                    <TableRow key={kw.id} className="border-border/30 hover:bg-muted/20 transition-colors">
                      <TableCell className="w-6 pl-4">
                        {kw.isPrimary ? <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> : null}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{kw.keywordText}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={kw.keywordType === 2
                            ? "text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20 gap-1"
                            : "text-[10px] bg-primary/10 text-primary border-primary/20 gap-1"
                          }
                        >
                          {kw.keywordType === 2 ? <><Link2 className="w-2.5 h-2.5" /> Type 2</> : <><MapPin className="w-2.5 h-2.5" /> Type 1</>}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{kw.clickCount}</TableCell>
                      <TableCell>
                        <span className={`flex items-center gap-1 text-xs ${verify.cls}`}>
                          <VerifyIcon className="w-3 h-3" /> {verify.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={kw.isActive}
                          onCheckedChange={(v) => handleKwToggle(kw.id, v)}
                          className="data-[state=checked]:bg-emerald-500"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Sessions ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Recent Sessions
          </CardTitle>
          <CardDescription>Last 10 AEO sessions for this client</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-xs text-muted-foreground/60 uppercase">Time</TableHead>
                <TableHead className="text-xs text-muted-foreground/60 uppercase">Platform</TableHead>
                <TableHead className="text-xs text-muted-foreground/60 uppercase">Keyword</TableHead>
                <TableHead className="text-xs text-muted-foreground/60 uppercase">Device</TableHead>
                <TableHead className="text-xs text-muted-foreground/60 uppercase">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isSessionsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : sessions?.sessions && sessions.sessions.length > 0 ? (
                sessions.sessions.map((s) => (
                  <TableRow key={s.id} className="border-border/30 hover:bg-muted/20 transition-colors">
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {format(new Date(s.timestamp), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          s.aiPlatform === "gemini"     ? "border-blue-500/30 text-blue-400 text-[10px]" :
                          s.aiPlatform === "chatgpt"    ? "border-emerald-500/30 text-emerald-400 text-[10px]" :
                                                          "border-amber-500/30 text-amber-400 text-[10px]"
                        }
                      >
                        {s.aiPlatform}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-sm">{s.keywordText || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.deviceIdentifier || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{s.durationSeconds ? `${s.durationSeconds}s` : "—"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground text-sm">
                    No sessions recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ════════════════════════════════════════
          Edit Profile Dialog
      ════════════════════════════════════════ */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!saving) setEditOpen(o); }}>
        <DialogContent className="sm:max-w-[540px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Building2 className="w-4 h-4 text-primary" />
              </div>
              <DialogTitle>Edit Client Profile</DialogTitle>
            </div>
            <DialogDescription>Update {client.businessName}'s details and settings.</DialogDescription>
          </DialogHeader>

          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 mt-2">
            {/* Business name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Business Name <span className="text-destructive">*</span>
              </Label>
              <Input className="bg-muted/30 border-border/60 h-10" {...editForm.register("businessName")} />
              {editForm.formState.errors.businessName && (
                <p className="text-xs text-destructive">{editForm.formState.errors.businessName.message}</p>
              )}
            </div>

            {/* City + State */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">City</Label>
                <Input className="bg-muted/30 border-border/60 h-10" placeholder="Detroit" {...editForm.register("city")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">State</Label>
                <Input className="bg-muted/30 border-border/60 h-10" placeholder="MI" {...editForm.register("state")} />
              </div>
            </div>

            {/* Plan + Status */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plan</Label>
                <Input className="bg-muted/30 border-border/60 h-10" placeholder="Starter / Growth / Pro" {...editForm.register("planName")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</Label>
                <Controller
                  name="status"
                  control={editForm.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="bg-muted/30 border-border/60 h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {/* GMB URL */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Google Maps URL</Label>
              <Input className="bg-muted/30 border-border/60 h-10" placeholder="https://maps.google.com/…" {...editForm.register("gmbUrl")} />
              {editForm.formState.errors.gmbUrl && (
                <p className="text-xs text-destructive">{editForm.formState.errors.gmbUrl.message}</p>
              )}
            </div>

            {/* Website + Email */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Website URL</Label>
                <Input className="bg-muted/30 border-border/60 h-10" placeholder="https://…" {...editForm.register("websiteUrl")} />
                {editForm.formState.errors.websiteUrl && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.websiteUrl.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact Email</Label>
                <Input className="bg-muted/30 border-border/60 h-10" placeholder="client@example.com" {...editForm.register("contactEmail")} />
                {editForm.formState.errors.contactEmail && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.contactEmail.message}</p>
                )}
              </div>
            </div>

            {/* Published Address */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Published Address</Label>
              <Input className="bg-muted/30 border-border/60 h-10" placeholder="123 Main St, Detroit, MI" {...editForm.register("publishedAddress")} />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1 border-border/50" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 gap-2"
                disabled={saving}
                style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Pencil className="w-4 h-4" /> Save Changes</>}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════
          Add Keyword Dialog (pre-filled with client)
      ════════════════════════════════════════ */}
      <Dialog open={kwOpen} onOpenChange={(o) => { if (!addingKw) { setKwOpen(o); if (!o) kwForm.reset(); } }}>
        <DialogContent className="sm:max-w-[460px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Key className="w-4 h-4 text-primary" />
              </div>
              <DialogTitle>Add AEO Keyword</DialogTitle>
            </div>
            <DialogDescription>
              Adding keyword for <span className="font-semibold text-foreground">{client.businessName}</span>
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={kwForm.handleSubmit(onAddKeyword)} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Keyword <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. best dentist near me Detroit"
                className="bg-muted/30 border-border/60 h-10"
                {...kwForm.register("keywordText")}
              />
              {kwForm.formState.errors.keywordText && (
                <p className="text-xs text-destructive">{kwForm.formState.errors.keywordText.message}</p>
              )}
            </div>

            {/* Prompt Type */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AEO Prompt Type</Label>
              <Controller
                name="keywordType"
                control={kwForm.control}
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "1", label: "Type 1 — Geo Specific",  desc: "60% budget · 100% search rate", accent: "border-primary/50 bg-primary/10 text-primary",       icon: MapPin },
                      { value: "2", label: "Type 2 — Backlink",       desc: "10% budget · 1st keyword only", accent: "border-amber-400/50 bg-amber-500/10 text-amber-400", icon: Link2  },
                    ] as const).map((opt) => {
                      const Icon     = opt.icon;
                      const selected = field.value === opt.value;
                      return (
                        <button key={opt.value} type="button" onClick={() => field.onChange(opt.value)}
                          className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-all ${
                            selected ? opt.accent : "border-border/50 bg-muted/20 text-muted-foreground hover:border-border/80"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5" />
                            <span className="text-xs font-semibold">{opt.label}</span>
                          </div>
                          <span className="text-[10px] opacity-70">{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              />
            </div>

            {watchKwType === "2" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Backlink Count
                  <span className="ml-1 text-[10px] text-amber-400 normal-case font-normal">(1st/primary keyword only)</span>
                </Label>
                <Input type="number" min={0} max={100} placeholder="0"
                  className="bg-muted/30 border-border/60 h-10"
                  {...kwForm.register("backlinkCount")} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">Primary</p>
                  <p className="text-[10px] text-muted-foreground">1st keyword flag</p>
                </div>
                <Controller name="isPrimary" control={kwForm.control}
                  render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-[10px] text-muted-foreground">Include in sessions</p>
                </div>
                <Controller name="isActive" control={kwForm.control}
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange}
                      className="data-[state=checked]:bg-emerald-500" />
                  )} />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1 border-border/50"
                onClick={() => { setKwOpen(false); kwForm.reset(); }} disabled={addingKw}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1 gap-2" disabled={addingKw}
                style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}>
                {addingKw ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</> : <><Plus className="w-4 h-4" /> Add Keyword</>}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
