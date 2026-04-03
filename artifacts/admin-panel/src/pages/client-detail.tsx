import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetClient,
  useGetSessions,
  useGetKeywords,
  useUpdateKeyword,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin, Globe, ExternalLink, Activity, Pencil, Plus, Key,
  ChevronLeft, Building2, Mail, Star, Link2, Loader2, CreditCard,
  Calendar, User, Briefcase, BarChart2, RefreshCcw, ShieldCheck,
  Cpu, Wifi, Trash2,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─────────────────────────────────────────────────────────── */
/* Helpers                                                      */
/* ─────────────────────────────────────────────────────────── */
function Field({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      {value ? (
        href ? (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1 break-all">
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

function SectionCard({ title, icon: Icon, onEdit, children }: {
  title: string;
  icon: React.ElementType;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </CardTitle>
        {onEdit && (
          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={onEdit}>
            <Pencil className="w-3 h-3" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Component                                                    */
/* ─────────────────────────────────────────────────────────── */
export default function ClientDetail() {
  const [, params] = useRoute("/clients/:id");
  const clientId   = Number(params?.id);
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  /* ── Dialog open states ── */
  const [editBiz,     setEditBiz]     = useState(false);
  const [editAccount, setEditAccount] = useState(false);
  const [kwOpen,      setKwOpen]      = useState(false);
  const [editKw,      setEditKw]      = useState<null | Record<string, unknown>>(null);
  const [saving,      setSaving]      = useState(false);

  /* ── Data ── */
  const { data: client, isLoading: isClientLoading } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: ["getClient", clientId] },
  });
  const { data: sessionsData } = useGetSessions(
    { clientId, limit: 100 },
    { query: { enabled: !!clientId, queryKey: ["getSessions", clientId] } },
  );
  const { data: allKeywords } = useGetKeywords();
  const clientKeywords = (allKeywords ?? []).filter((k) => k.clientId === clientId);

  const updateKeyword = useUpdateKeyword();

  /* ── Metric computations ── */
  const sessions     = sessionsData?.sessions ?? [];
  const totalSess    = sessions.length;
  const deviceSet    = new Set(sessions.map((s) => s.deviceId).filter(Boolean));
  const deviceRot    = totalSess ? Math.round((deviceSet.size / totalSess) * 100) : 0;
  const proxySet     = new Set(sessions.map((s) => (s as Record<string, unknown>).proxyId).filter(Boolean));
  const ipRot        = totalSess ? Math.round((proxySet.size / totalSess) * 100) : 0;
  const completed    = sessions.filter((s) => s.status === "completed").length;
  const promptAcc    = totalSess ? Math.round((completed / totalSess) * 100) : 0;

  /* ─── Generic PATCH client ─── */
  async function patchClient(body: Record<string, unknown>) {
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
      setEditBiz(false);
      setEditAccount(false);
    } catch (err: unknown) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ─── Keyword save ─── */
  async function saveKeyword(id: number | null, data: Record<string, unknown>) {
    setSaving(true);
    try {
      if (id) {
        await new Promise<void>((resolve, reject) =>
          updateKeyword.mutate({ id, data }, {
            onSuccess: () => resolve(),
            onError:   (e) => reject(e),
          }),
        );
      } else {
        const res = await fetch(`${BASE}/api/keywords`, {
          method:      "POST",
          credentials: "include",
          headers:     { "Content-Type": "application/json" },
          body:        JSON.stringify({ ...data, clientId, tierLabel: "aeo" }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: id ? "Keyword updated" : "Keyword added" });
      setEditKw(null);
      setKwOpen(false);
    } catch (err: unknown) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteKeyword(id: number) {
    try {
      await fetch(`${BASE}/api/keywords/${id}`, { method: "DELETE", credentials: "include" });
      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: "Keyword deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  /* ─── Loading / not found ─── */
  if (isClientLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-48" />
      <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-52" /><Skeleton className="h-52" /></div>
      <Skeleton className="h-64" />
    </div>
  );
  if (!client) return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
      <Building2 className="w-12 h-12 opacity-20" />
      <p>Client not found</p>
      <Link href="/clients"><Button variant="outline" size="sm">Back to Clients</Button></Link>
    </div>
  );

  const c = client as Record<string, unknown>;
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
      <div className="rounded-xl border border-border/50 bg-card/60 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-xl font-bold text-primary flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">{client.businessName}</h1>
            <Badge variant="outline" className={client.status === "active"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-muted text-muted-foreground"}>
              {client.status}
            </Badge>
            {client.planName && <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">{client.planName}</Badge>}
            {(c.accountType as string) && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px]">
                {c.accountType as string}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
            {client.city && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{client.city}, {client.state}</span>}
            {client.contactEmail && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{client.contactEmail}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5 border-border/60" onClick={() => setKwOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Keyword
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="business" className="space-y-4">
        <TabsList className="bg-card/60 border border-border/40 h-9">
          <TabsTrigger value="business"  className="text-xs gap-1.5"><Building2 className="w-3 h-3" /> Business Details</TabsTrigger>
          <TabsTrigger value="account"   className="text-xs gap-1.5"><User className="w-3 h-3" /> Account Details</TabsTrigger>
          <TabsTrigger value="keywords"  className="text-xs gap-1.5"><Key className="w-3 h-3" /> Keywords <Badge variant="outline" className="text-[9px] text-muted-foreground ml-0.5 h-4">{clientKeywords.length}</Badge></TabsTrigger>
          <TabsTrigger value="metrics"   className="text-xs gap-1.5"><BarChart2 className="w-3 h-3" /> Metrics</TabsTrigger>
        </TabsList>

        {/* ══════════════════════ BUSINESS DETAILS ══════════════════════ */}
        <TabsContent value="business" className="space-y-4 mt-0">
          <SectionCard title="Business Details" icon={Building2} onEdit={() => setEditBiz(true)}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
              <Field label="Business Name"              value={client.businessName} />
              <Field label="Plan"                       value={client.planName} />
              <Field label="Search Address"             value={client.searchAddress} />
              <Field label="GMB Address"                value={client.publishedAddress} />
              <Field label="GMB Link"                   value={client.gmbUrl}        href={client.gmbUrl ?? undefined} />
              <Field label="Website Published on GMB"   value={c.websitePublishedOnGmb as string} href={(c.websitePublishedOnGmb as string) ?? undefined} />
              <Field label="Website Linked on GMB"      value={c.websiteLinkedOnGmb  as string} href={(c.websiteLinkedOnGmb  as string) ?? undefined} />
              <Field label="Account User"               value={c.accountUser as string} />
              <Field label="Start Date"                 value={c.startDate     as string} />
              <Field label="Next Bill Date"             value={c.nextBillDate  as string} />
              <Field label="Subscription ID"            value={c.subscriptionId as string} />
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Last 4 of Billing Card</p>
                {(c.lastFourCard as string) ? (
                  <p className="text-sm text-foreground flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-muted-foreground" /> •••• {c.lastFourCard as string}
                  </p>
                ) : <p className="text-sm text-muted-foreground/40">—</p>}
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ══════════════════════ ACCOUNT DETAILS ══════════════════════ */}
        <TabsContent value="account" className="space-y-4 mt-0">
          <SectionCard title="Account Details" icon={Briefcase} onEdit={() => setEditAccount(true)}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
              <Field label="Account Type"               value={c.accountType    as string} />
              <Field label="Account User Name"          value={c.accountUserName as string} />
              <Field label="Account Email"              value={c.accountEmail   as string} />
              <Field label="Contact / Billing Email"    value={c.billingEmail   as string} />
              <Field label="Plan"                       value={client.planName} />
              <Field label="Subscription ID"            value={c.subscriptionId as string} />
              <Field label="Business Name"              value={client.businessName} />
              <Field label="Search Address"             value={client.searchAddress} />
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Last 4 of Billing Card</p>
                {(c.lastFourCard as string) ? (
                  <p className="text-sm text-foreground flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-muted-foreground" /> •••• {c.lastFourCard as string}
                  </p>
                ) : <p className="text-sm text-muted-foreground/40">—</p>}
              </div>
              <Field label="Next Bill Date"             value={c.nextBillDate as string} />
              <Field label="Start Date"                 value={c.startDate    as string} />
            </div>
          </SectionCard>
        </TabsContent>

        {/* ══════════════════════ KEYWORDS ══════════════════════ */}
        <TabsContent value="keywords" className="space-y-4 mt-0">
          <Card className="border-border/50">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Key className="w-4 h-4 text-primary" /> Keywords
                <Badge variant="outline" className="text-[10px] text-muted-foreground">{clientKeywords.length}</Badge>
              </CardTitle>
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
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60 w-5"></TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60">Keyword</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60">Type</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60">Primary</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60 text-center">Active</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60">Date Added</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60 text-right">Init 30d</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60 text-right">FU 30d</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60 text-right">Init Life</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60 text-right">FU Life</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60">Link Label</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60 text-center">Link Active</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60">Init Report</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60">Curr Report</TableHead>
                        <TableHead className="text-[10px] uppercase text-muted-foreground/60 text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientKeywords.map((kw) => {
                        const kwr = kw as Record<string, unknown>;
                        return (
                          <TableRow key={kw.id} className="border-border/30 hover:bg-muted/20 text-xs">
                            <TableCell className="pl-4 w-5">
                              {kw.isPrimary ? <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> : null}
                            </TableCell>
                            <TableCell className="font-medium max-w-[140px] truncate" title={kw.keywordText}>{kw.keywordText}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={kw.keywordType === 2
                                ? "text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20"
                                : "text-[9px] bg-primary/10 text-primary border-primary/20"}>
                                {kw.keywordType === 2 ? "Type 2" : "Type 1"}
                              </Badge>
                            </TableCell>
                            <TableCell>{kw.isPrimary ? <Badge variant="outline" className="text-[9px]">1st</Badge> : <span className="text-muted-foreground/40">—</span>}</TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={kw.isActive}
                                onCheckedChange={(v) => updateKeyword.mutate(
                                  { id: kw.id, data: { isActive: v } },
                                  { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/keywords"] }) },
                                )}
                                className="data-[state=checked]:bg-emerald-500 scale-75"
                              />
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {(kwr.dateAdded as string) ? format(new Date(kwr.dateAdded as string), "MMM d, yyyy") : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono">{(kwr.initialSearchCount30Days as number) ?? 0}</TableCell>
                            <TableCell className="text-right font-mono">{(kwr.followupSearchCount30Days as number) ?? 0}</TableCell>
                            <TableCell className="text-right font-mono">{(kwr.initialSearchCountLife as number) ?? 0}</TableCell>
                            <TableCell className="text-right font-mono">{(kwr.followupSearchCountLife as number) ?? 0}</TableCell>
                            <TableCell className="max-w-[120px] truncate text-muted-foreground" title={(kwr.linkTypeLabel as string) ?? ""}>
                              {(kwr.linkTypeLabel as string) || <span className="text-muted-foreground/30">—</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={(kwr.linkActive as boolean) !== false}
                                onCheckedChange={(v) => updateKeyword.mutate(
                                  { id: kw.id, data: { linkActive: v } },
                                  { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/keywords"] }) },
                                )}
                                className="data-[state=checked]:bg-emerald-500 scale-75"
                              />
                            </TableCell>
                            <TableCell>
                              {(kwr.initialRankReportLink as string) ? (
                                <a href={kwr.initialRankReportLink as string} target="_blank" rel="noopener noreferrer"
                                  className="text-primary hover:underline flex items-center gap-1">
                                  Link <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : <span className="text-muted-foreground/30">—</span>}
                            </TableCell>
                            <TableCell>
                              {(kwr.currentRankReportLink as string) ? (
                                <a href={kwr.currentRankReportLink as string} target="_blank" rel="noopener noreferrer"
                                  className="text-primary hover:underline flex items-center gap-1">
                                  Link <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : <span className="text-muted-foreground/30">—</span>}
                            </TableCell>
                            <TableCell className="text-right pr-3">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-6 w-6"
                                  onClick={() => setEditKw({ ...kwr, id: kw.id })}>
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                                  onClick={() => deleteKeyword(kw.id)}>
                                  <Trash2 className="w-3 h-3" />
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
        </TabsContent>

        {/* ══════════════════════ METRICS ══════════════════════ */}
        <TabsContent value="metrics" className="space-y-4 mt-0">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: "Device Rotation", value: `${deviceRot}%`,  icon: Cpu,         desc: `${deviceSet.size} unique devices across ${totalSess} sessions` },
              { label: "IP Address Rotation", value: `${ipRot}%`,  icon: Wifi,        desc: `${proxySet.size} unique proxies across ${totalSess} sessions` },
              { label: "Cache Clearing",  value: "—",              icon: RefreshCcw,  desc: "Not tracked yet" },
              { label: "Prompt Execution Accuracy", value: `${promptAcc}%`, icon: ShieldCheck, desc: `${completed} of ${totalSess} sessions completed` },
              { label: "Volume Searches Accuracy", value: totalSess > 0 ? `${Math.min(100, Math.round((completed / Math.max(1, totalSess)) * 100))}%` : "—", icon: BarChart2, desc: "Based on completed vs total sessions" },
            ].map((m) => (
              <Card key={m.label} className="border-border/50">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <m.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{m.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-0.5">{m.value}</p>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{m.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Recent sessions table */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Recent Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase text-muted-foreground/60">Time</TableHead>
                    <TableHead className="text-[10px] uppercase text-muted-foreground/60">Platform</TableHead>
                    <TableHead className="text-[10px] uppercase text-muted-foreground/60">Keyword</TableHead>
                    <TableHead className="text-[10px] uppercase text-muted-foreground/60">Device</TableHead>
                    <TableHead className="text-[10px] uppercase text-muted-foreground/60">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.slice(0, 8).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">No sessions yet</TableCell>
                    </TableRow>
                  ) : sessions.slice(0, 8).map((s) => (
                    <TableRow key={s.id} className="border-border/30 hover:bg-muted/20 text-xs">
                      <TableCell className="text-muted-foreground">{format(new Date(s.timestamp), "MMM d, HH:mm")}</TableCell>
                      <TableCell>{s.aiPlatform}</TableCell>
                      <TableCell className="max-w-[160px] truncate" title={s.keywordText}>{s.keywordText}</TableCell>
                      <TableCell className="text-muted-foreground font-mono">{s.deviceId ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          s.status === "completed" ? "text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                          s.status === "failed"    ? "text-[9px] bg-destructive/10 text-destructive border-destructive/20" :
                          "text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }>{s.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════
          EDIT BUSINESS DETAILS DIALOG
      ═══════════════════════════════════════════════ */}
      <EditDialog
        open={editBiz}
        onOpenChange={setEditBiz}
        title="Edit Business Details"
        icon={Building2}
        saving={saving}
        onSave={(vals) => patchClient(vals)}
        fields={[
          { key: "businessName",        label: "Business Name",              value: client.businessName },
          { key: "planName",            label: "Plan",                       value: client.planName },
          { key: "searchAddress",       label: "Search Address",             value: client.searchAddress },
          { key: "publishedAddress",    label: "GMB Address",                value: client.publishedAddress },
          { key: "gmbUrl",              label: "GMB Link",                   value: client.gmbUrl },
          { key: "websiteUrl",          label: "Website URL",                value: client.websiteUrl },
          { key: "websitePublishedOnGmb", label: "Website Published on GMB", value: c.websitePublishedOnGmb as string },
          { key: "websiteLinkedOnGmb",  label: "Website Linked on GMB (if different)", value: c.websiteLinkedOnGmb as string },
          { key: "accountUser",         label: "Account User",               value: c.accountUser as string },
          { key: "startDate",           label: "Start Date",                 value: c.startDate    as string, placeholder: "YYYY-MM-DD" },
          { key: "nextBillDate",        label: "Next Bill Date",             value: c.nextBillDate as string, placeholder: "YYYY-MM-DD" },
          { key: "subscriptionId",      label: "Subscription ID",            value: c.subscriptionId as string },
          { key: "lastFourCard",        label: "Last 4 of Billing Card",     value: c.lastFourCard as string, placeholder: "e.g. 4242", maxLength: 4 },
        ]}
      />

      {/* ═══════════════════════════════════════════════
          EDIT ACCOUNT DETAILS DIALOG
      ═══════════════════════════════════════════════ */}
      <EditDialog
        open={editAccount}
        onOpenChange={setEditAccount}
        title="Edit Account Details"
        icon={Briefcase}
        saving={saving}
        onSave={(vals) => patchClient(vals)}
        fields={[
          { key: "accountType",     label: "Account Type",            value: c.accountType     as string, options: ["Agency", "Retail"] },
          { key: "accountUserName", label: "Account User Name",       value: c.accountUserName as string },
          { key: "accountEmail",    label: "Account Email",           value: c.accountEmail    as string },
          { key: "billingEmail",    label: "Contact / Billing Email", value: c.billingEmail    as string },
          { key: "planName",        label: "Plan",                    value: client.planName },
          { key: "subscriptionId",  label: "Subscription ID",         value: c.subscriptionId  as string },
          { key: "businessName",    label: "Business Name",           value: client.businessName },
          { key: "searchAddress",   label: "Search Address",          value: client.searchAddress },
          { key: "lastFourCard",    label: "Last 4 of Billing Card",  value: c.lastFourCard    as string, placeholder: "e.g. 4242", maxLength: 4 },
          { key: "nextBillDate",    label: "Next Bill Date",          value: c.nextBillDate    as string, placeholder: "YYYY-MM-DD" },
          { key: "startDate",       label: "Start Date",              value: c.startDate       as string, placeholder: "YYYY-MM-DD" },
        ]}
      />

      {/* ═══════════════════════════════════════════════
          ADD KEYWORD DIALOG
      ═══════════════════════════════════════════════ */}
      <KeywordDialog
        open={kwOpen}
        onOpenChange={setKwOpen}
        title="Add Keyword"
        saving={saving}
        onSave={(data) => saveKeyword(null, data)}
      />

      {/* ═══════════════════════════════════════════════
          EDIT KEYWORD DIALOG
      ═══════════════════════════════════════════════ */}
      {editKw && (
        <KeywordDialog
          open
          onOpenChange={(o) => { if (!o) setEditKw(null); }}
          title="Edit Keyword"
          saving={saving}
          initial={editKw}
          onSave={(data) => saveKeyword(editKw.id as number, data)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Generic editable fields dialog                              */
/* ─────────────────────────────────────────────────────────── */
interface FieldSpec {
  key:         string;
  label:       string;
  value?:      string | null;
  placeholder?: string;
  maxLength?:  number;
  options?:    string[];
  textarea?:   boolean;
}

function EditDialog({
  open, onOpenChange, title, icon: Icon, saving, onSave, fields,
}: {
  open:          boolean;
  onOpenChange:  (v: boolean) => void;
  title:         string;
  icon:          React.ElementType;
  saving:        boolean;
  onSave:        (vals: Record<string, string>) => void;
  fields:        FieldSpec[];
}) {
  const [vals, setVals] = useState<Record<string, string>>({});

  function init() {
    const init: Record<string, string> = {};
    fields.forEach((f) => { init[f.key] = f.value ?? ""; });
    setVals(init);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) init(); }}>
      <DialogContent className="sm:max-w-[600px] border-border/60 bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 mt-2">
          {fields.map((f) => (
            <div key={f.key} className={`space-y-1.5 ${f.textarea ? "col-span-2" : ""}`}>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{f.label}</Label>
              {f.options ? (
                <Select value={vals[f.key] ?? ""} onValueChange={(v) => setVals((p) => ({ ...p, [f.key]: v }))}>
                  <SelectTrigger className="bg-muted/30 border-border/60 h-9 text-sm">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : f.textarea ? (
                <Textarea
                  className="bg-muted/30 border-border/60 text-sm resize-none"
                  rows={2}
                  placeholder={f.placeholder ?? ""}
                  value={vals[f.key] ?? ""}
                  onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  className="bg-muted/30 border-border/60 h-9 text-sm"
                  placeholder={f.placeholder ?? ""}
                  maxLength={f.maxLength}
                  value={vals[f.key] ?? ""}
                  onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-3 pt-4">
          <Button variant="outline" className="flex-1 border-border/50" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            className="flex-1 gap-2"
            disabled={saving}
            onClick={() => onSave(vals)}
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Keyword add / edit dialog                                   */
/* ─────────────────────────────────────────────────────────── */
function KeywordDialog({
  open, onOpenChange, title, saving, initial, onSave,
}: {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  title:        string;
  saving:       boolean;
  initial?:     Record<string, unknown>;
  onSave:       (data: Record<string, unknown>) => void;
}) {
  const blank: Record<string, unknown> = {
    keywordText:               "",
    keywordType:               "1",
    isPrimary:                 "0",
    isActive:                  true,
    linkTypeLabel:             "",
    linkActive:                true,
    initialRankReportLink:     "",
    currentRankReportLink:     "",
    initialSearchCount30Days:  0,
    followupSearchCount30Days: 0,
    initialSearchCountLife:    0,
    followupSearchCountLife:   0,
  };

  const [vals, setVals] = useState<Record<string, unknown>>(initial ?? blank);

  function set(k: string, v: unknown) { setVals((p) => ({ ...p, [k]: v })); }

  const LINK_TYPES = ["GBP snippet", "Client website blog post", "External article", "Other"];

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setVals(initial ?? blank); }}>
      <DialogContent className="sm:max-w-[620px] border-border/60 bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Key className="w-4 h-4 text-primary" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Keyword row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground/60 tracking-wide">Keyword</Label>
              <Input className="bg-muted/30 border-border/60 h-9 text-sm" placeholder="e.g. best plumber in Manchester"
                value={vals.keywordText as string} onChange={(e) => set("keywordText", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground/60 tracking-wide">Keyword Type</Label>
              <Select value={String(vals.keywordType)} onValueChange={(v) => set("keywordType", v)}>
                <SelectTrigger className="bg-muted/30 border-border/60 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Type 1 — Geo Specific</SelectItem>
                  <SelectItem value="2">Type 2 — Backlink</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Primary + Active */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg p-3">
              <div className="flex-1">
                <p className="text-xs font-medium">Primary (1st)</p>
                <p className="text-[10px] text-muted-foreground">Mark as primary keyword</p>
              </div>
              <Switch checked={vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true}
                onCheckedChange={(v) => set("isPrimary", v ? "1" : "0")}
                className="data-[state=checked]:bg-primary" />
            </div>
            <div className="flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg p-3">
              <div className="flex-1">
                <p className="text-xs font-medium">Active</p>
                <p className="text-[10px] text-muted-foreground">Enable keyword for campaigns</p>
              </div>
              <Switch checked={vals.isActive !== false}
                onCheckedChange={(v) => set("isActive", v)}
                className="data-[state=checked]:bg-emerald-500" />
            </div>
          </div>

          {/* Search counts */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 mb-2">Search Counts</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { k: "initialSearchCount30Days",  label: "Initial · 30 days" },
                { k: "followupSearchCount30Days", label: "Follow-up · 30 days" },
                { k: "initialSearchCountLife",    label: "Initial · Lifetime" },
                { k: "followupSearchCountLife",   label: "Follow-up · Lifetime" },
              ].map(({ k, label }) => (
                <div key={k} className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60">{label}</Label>
                  <Input type="number" min={0} className="bg-muted/30 border-border/60 h-9 text-sm font-mono"
                    value={vals[k] as number}
                    onChange={(e) => set(k, parseInt(e.target.value) || 0)} />
                </div>
              ))}
            </div>
          </div>

          {/* Associated links */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 mb-2">Associated Links</p>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 items-end">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60">Link Type Label</Label>
                  <Select value={(vals.linkTypeLabel as string) || ""} onValueChange={(v) => set("linkTypeLabel", v)}>
                    <SelectTrigger className="bg-muted/30 border-border/60 h-9 text-sm"><SelectValue placeholder="Select type…" /></SelectTrigger>
                    <SelectContent>
                      {LINK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 bg-muted/20 border border-border/40 rounded-lg p-3 h-9">
                  <p className="text-xs flex-1">Link Active</p>
                  <Switch checked={vals.linkActive !== false}
                    onCheckedChange={(v) => set("linkActive", v)}
                    className="data-[state=checked]:bg-emerald-500 scale-75" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60 flex items-center gap-1"><Link2 className="w-3 h-3" /> Initial Rank Report</Label>
                  <Input className="bg-muted/30 border-border/60 h-9 text-sm font-mono text-xs"
                    placeholder="https://…"
                    value={(vals.initialRankReportLink as string) || ""}
                    onChange={(e) => set("initialRankReportLink", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground/60 flex items-center gap-1"><Link2 className="w-3 h-3" /> Current Rank Report</Label>
                  <Input className="bg-muted/30 border-border/60 h-9 text-sm font-mono text-xs"
                    placeholder="https://…"
                    value={(vals.currentRankReportLink as string) || ""}
                    onChange={(e) => set("currentRankReportLink", e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <Button variant="outline" className="flex-1 border-border/50" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="flex-1 gap-2" disabled={saving || !(vals.keywordText as string)?.trim()} onClick={() => onSave({
            ...vals,
            keywordType:               Number(vals.keywordType),
            isPrimary:                 vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true ? 1 : 0,
            initialSearchCount30Days:  Number(vals.initialSearchCount30Days)  || 0,
            followupSearchCount30Days: Number(vals.followupSearchCount30Days) || 0,
            initialSearchCountLife:    Number(vals.initialSearchCountLife)    || 0,
            followupSearchCountLife:   Number(vals.followupSearchCountLife)   || 0,
          })}
            style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Keyword"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
