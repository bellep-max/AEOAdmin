import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Key, ChevronRight, ExternalLink, Pencil, Check, X, Sparkles, Trash2, Loader2 } from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active:          { label: "Active",          cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  inactive:        { label: "Inactive",        cls: "bg-slate-500/10 text-slate-500 border-slate-500/30" },
  needs_improved:  { label: "Needs improved",  cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  new:             { label: "New",             cls: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
};

const STATUS_OPTIONS = Object.entries(STATUS_MAP).map(([value, { label }]) => ({ value, label }));

interface AuditLog {
  id: number;
  platform: string;
  status: string;
  rankPosition: number | null;
  rankTotal: number | null;
  timestamp: string;
  durationSeconds: number | null;
}

interface Session {
  id: number;
  timestamp: string;
  aiPlatform: string;
  status: string;
  durationSeconds: number | null;
  errorMessage: string | null;
}

interface KeywordLink {
  id: number;
  linkUrl: string;
  linkTypeLabel: string | null;
  linkActive: boolean;
  embeddedUrl: string | null;
}

interface KeywordVariant {
  id: number;
  keywordId: number;
  variantText: string;
  isActive: boolean;
  weekOf: string | null;
  sourceModel: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
}

interface KeywordData {
  id: number;
  keywordText: string;
  keywordType: number;
  isActive: boolean;
  isPrimary: number;
  status: string | null;
  notes: string | null;
  implementedBy: string | null;
  lastRunAt: string | null;
  dateAdded: string | null;
  clientName: string | null;
  businessName: string | null;
  campaignName: string | null;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  links: KeywordLink[];
}

function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}

export default function KeywordDetail({ params }: { params: { clientId: string; businessId: string; campaignId: string; keywordId: string } }) {
  const clientId = parseInt(params.clientId);
  const businessId = parseInt(params.businessId);
  const campaignId = parseInt(params.campaignId);
  const keywordId = parseInt(params.keywordId);
  const queryClient = useQueryClient();
  const { isOwner } = useAuth();
  const [editing, setEditing] = useState<"status" | "notes" | "implementedBy" | null>(null);
  const [draft, setDraft] = useState("");

  const { data: kw, isLoading } = useQuery<KeywordData>({
    queryKey: [`/api/keywords/${keywordId}`],
    queryFn: async () => {
      const res = await rawFetch(`/api/keywords/${keywordId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: auditLogs } = useQuery<AuditLog[]>({
    queryKey: [`/api/audit-logs?keywordId=${keywordId}&limit=30`],
    queryFn: async () => {
      const res = await rawFetch(`/api/audit-logs?keywordId=${keywordId}&limit=30`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      return data.logs ?? [];
    },
    enabled: !isLoading,
  });

  const { data: variants, isLoading: isVariantsLoading } = useQuery<KeywordVariant[]>({
    queryKey: [`/api/keywords/${keywordId}/variants`],
    queryFn: async () => {
      const res = await rawFetch(`/api/keywords/${keywordId}/variants`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      return data.variants ?? [];
    },
    enabled: !isLoading,
  });

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);

  const regenerateVariants = async () => {
    setIsRegenerating(true);
    setVariantError(null);
    try {
      const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
      const res = await fetch(`${BASE}/api/keywords/${keywordId}/variants/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      queryClient.invalidateQueries({ queryKey: [`/api/keywords/${keywordId}/variants`] });
    } catch (err) {
      setVariantError(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setIsRegenerating(false);
    }
  };

  const deleteVariant = async (variantId: number) => {
    const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
    await fetch(`${BASE}/api/keyword-variants/${variantId}`, {
      method: "DELETE",
      credentials: "include",
    });
    queryClient.invalidateQueries({ queryKey: [`/api/keywords/${keywordId}/variants`] });
  };

  const { data: sessions } = useQuery<Session[]>({
    queryKey: [`/api/sessions?keywordId=${keywordId}&limit=10`],
    queryFn: async () => {
      const res = await rawFetch(`/api/sessions?keywordId=${keywordId}&limit=10`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      return data.sessions ?? [];
    },
    enabled: !isLoading,
  });

  const updateField = async (field: string, value: string) => {
    const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
    await fetch(`${BASE}/api/keywords/${keywordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ [field]: value || null }),
    });
    queryClient.invalidateQueries({ queryKey: [`/api/keywords/${keywordId}`] });
  };

  const startEdit = (field: "status" | "notes" | "implementedBy") => {
    const current = field === "status" ? (kw?.status ?? "new") : (kw?.[field] ?? "");
    setDraft(current ?? "");
    setEditing(field);
  };

  const commitEdit = () => {
    if (editing) updateField(editing, draft);
    setEditing(null);
  };

  const cancelEdit = () => setEditing(null);

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!kw) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Keyword not found</div>;
  }

  const s = STATUS_MAP[kw.status ?? "new"] ?? STATUS_MAP.new;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
        <Link href="/clients" className="hover:text-primary">Clients</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        {kw.clientId ? (
          <Link href={`/clients/${kw.clientId}`} className="hover:text-primary">{kw.clientName ?? `Client #${kw.clientId}`}</Link>
        ) : (
          <span>{kw.clientName ?? "—"}</span>
        )}
        <ChevronRight className="w-3.5 h-3.5" />
        {kw.clientId && kw.businessId ? (
          <Link href={`/clients/${kw.clientId}/businesses/${kw.businessId}`} className="hover:text-primary">{kw.businessName ?? "Business"}</Link>
        ) : (
          <span>{kw.businessName ?? "—"}</span>
        )}
        <ChevronRight className="w-3.5 h-3.5" />
        {kw.clientId && kw.businessId && kw.aeoPlanId ? (
          <Link href={`/clients/${kw.clientId}/businesses/${kw.businessId}/campaigns/${kw.aeoPlanId}`} className="hover:text-primary">{kw.campaignName ?? "Campaign"}</Link>
        ) : (
          <span>{kw.campaignName ?? "—"}</span>
        )}
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-semibold">{kw.keywordText}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{kw.keywordText}</h1>
            <p className="text-sm text-muted-foreground">
              {kw.clientName} · {kw.businessName} · {kw.campaignName}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Info card */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Keyword Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              {editing === "status" ? (
                <div className="flex items-center gap-1">
                  <select value={draft} onChange={(e) => setDraft(e.target.value)} className="text-xs border rounded px-2 py-1 bg-background" autoFocus>
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={commitEdit}><Check className="w-3 h-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEdit}><X className="w-3 h-3" /></Button>
                </div>
              ) : (
                <button type="button" onClick={() => startEdit("status")} className="flex items-center gap-1.5 group">
                  <Badge className={`text-[11px] border ${s.cls}`} variant="outline">{s.label}</Badge>
                  <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Active</p>
                <p>{kw.isActive ? "Yes" : "No"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Type</p>
                <p>{kw.keywordType === 4 ? "w/ Backlinks" : "Keyword"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Primary</p>
                <p>{kw.isPrimary === 1 ? "Yes" : "No"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Date Added</p>
                <p>{kw.dateAdded ? format(new Date(kw.dateAdded), "MMM d, yyyy") : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Last Run</p>
                <p>{kw.lastRunAt ? format(new Date(kw.lastRunAt), "MMM d, yyyy 'at' h:mm a") : "Never"}</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Implemented By</span>
              {editing === "implementedBy" ? (
                <div className="flex items-center gap-1">
                  <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} className="text-xs border rounded px-2 py-1 w-40 bg-background" autoFocus onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} />
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={commitEdit}><Check className="w-3 h-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEdit}><X className="w-3 h-3" /></Button>
                </div>
              ) : (
                <button type="button" onClick={() => startEdit("implementedBy")} className="flex items-center gap-1.5 group">
                  <span className="text-sm">{kw.implementedBy ?? "—"}</span>
                  <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground">Notes</span>
                {editing !== "notes" && (
                  <button type="button" onClick={() => startEdit("notes")} className="group">
                    <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </button>
                )}
              </div>
              {editing === "notes" ? (
                <div className="flex items-start gap-1">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="text-xs border rounded px-2 py-1 w-full bg-background resize-none" rows={3} autoFocus />
                  <div className="flex flex-col gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={commitEdit}><Check className="w-3 h-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEdit}><X className="w-3 h-3" /></Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm">{kw.notes || "—"}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Links card */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Associated Links</CardTitle>
          </CardHeader>
          <CardContent>
            {kw.links && kw.links.length > 0 ? (
              <div className="space-y-2">
                {kw.links.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 text-sm">
                    <Badge variant={l.linkActive ? "default" : "secondary"} className="text-[10px]">
                      {l.linkActive ? "Active" : "Inactive"}
                    </Badge>
                    <span className="text-muted-foreground">{l.linkTypeLabel ?? "Link"}</span>
                    <a href={l.linkUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate flex items-center gap-1">
                      {l.embeddedUrl ?? l.linkUrl} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No associated links</p>
            )}
          </CardContent>
        </Card>

        {/* Rankings card */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Latest Rankings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {auditLogs && auditLogs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Rank</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{format(new Date(a.timestamp), "MMM d, h:mm a")}</TableCell>
                      <TableCell className="text-xs capitalize">{a.platform}</TableCell>
                      <TableCell className="text-xs font-semibold">{a.rankPosition != null ? `#${a.rankPosition}` : "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{a.status}</Badge></TableCell>
                      <TableCell className="text-xs">{fmtDuration(a.durationSeconds)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">No rankings yet</div>
            )}
          </CardContent>
        </Card>

        {/* Sessions card */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sessions && sessions.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs">{format(new Date(s.timestamp), "MMM d, h:mm a")}</TableCell>
                      <TableCell className="text-xs capitalize">{s.aiPlatform}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{s.status}</Badge></TableCell>
                      <TableCell className="text-xs">{fmtDuration(s.durationSeconds)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{s.errorMessage ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">No sessions yet</div>
            )}
          </CardContent>
        </Card>

        {/* Variants card — spans both columns */}
        <Card className="border-border/50 lg:col-span-2">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Search Variants
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Auto-generated phrases that get randomly substituted into the search prompt during daily runs.
              </p>
            </div>
            {/* Variant generation is super-admin (owner) only. */}
            {isOwner && (
              <Button size="sm" onClick={regenerateVariants} disabled={isRegenerating}>
                {isRegenerating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                {variants && variants.length > 0 ? "Regenerate" : "Generate"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {variantError ? (
              <div className="px-4 py-2 text-xs text-destructive border-b">{variantError}</div>
            ) : null}
            {isVariantsLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : variants && variants.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variant</TableHead>
                    <TableHead className="w-20">Used</TableHead>
                    <TableHead className="w-32">Last Used</TableHead>
                    <TableHead className="w-32">Expires</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-sm">{v.variantText}</TableCell>
                      <TableCell className="text-xs">{v.timesUsed}x</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {v.lastUsedAt ? format(new Date(v.lastUsedAt), "MMM d, h:mm a") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {v.expiresAt ? format(new Date(v.expiresAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteVariant(v.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                No variants yet. Click <span className="font-semibold">Generate</span> to create them via DeepSeek.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
