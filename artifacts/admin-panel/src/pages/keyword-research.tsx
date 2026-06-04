import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Search, Loader2, Plus, Sparkles, Check } from "lucide-react";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { credentials: "include", ...init, headers });
}

interface Idea {
  id: number;
  keyword: string;
  listType: "traditional" | "ai_search";
  popularity: number | null;
  intent: string | null;
  commercialIntent: number | null;
  reasoning: string | null;
  difficulty: number | null;
  lvs: number | null;
  promotedKeywordId: number | null;
}
interface RunResponse {
  run: { id: number; costUsd: number | null };
  ideas: Idea[];
}
interface ClientRow { id: number; name?: string; businessName?: string }
interface CampaignRow { id: number; name?: string; planName?: string; label?: string }

function intentVariant(intent: string | null): "default" | "secondary" | "outline" {
  if (intent === "transactional" || intent === "commercial") return "default";
  if (intent === "informational") return "secondary";
  return "outline";
}
function lvsColor(lvs: number | null): string {
  const v = lvs ?? 0;
  if (v >= 75) return "text-emerald-500";
  if (v >= 55) return "text-amber-500";
  return "text-slate-400";
}

export default function KeywordResearch() {
  const { toast } = useToast();
  const [seed, setSeed] = useState("");
  const [location, setLocation] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [campaignId, setCampaignId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [cost, setCost] = useState<number | null>(null);
  const [promoting, setPromoting] = useState<number | null>(null);

  const { data: clients } = useQuery<ClientRow[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const r = await rawFetch("/api/clients");
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : (data.clients ?? []);
    },
  });

  const { data: campaigns } = useQuery<CampaignRow[]>({
    queryKey: ["/api/clients", clientId, "aeo-plans"],
    enabled: !!clientId,
    queryFn: async () => {
      const r = await rawFetch(`/api/clients/${clientId}/aeo-plans`);
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : (data.plans ?? data.aeoPlans ?? []);
    },
  });

  async function runResearch() {
    const s = seed.trim();
    if (!s) {
      toast({ title: "Enter a seed keyword", variant: "destructive" });
      return;
    }
    setLoading(true);
    setIdeas([]);
    setCost(null);
    try {
      const r = await rawFetch("/api/keyword-research/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: s,
          location: location.trim() || undefined,
          clientId: clientId ? Number(clientId) : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Research failed");
      const data = (await r.json()) as RunResponse;
      setIdeas(data.ideas ?? []);
      setCost(data.run?.costUsd ?? 0);
      toast({ title: `Found ${data.ideas?.length ?? 0} keywords` });
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function promote(idea: Idea) {
    if (!campaignId) {
      toast({ title: "Pick a campaign first", description: "Select a client + campaign to promote into.", variant: "destructive" });
      return;
    }
    setPromoting(idea.id);
    try {
      const r = await rawFetch(`/api/keyword-research/ideas/${idea.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aeoPlanId: Number(campaignId) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? "Promote failed");
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, promotedKeywordId: body.keyword?.id ?? -1 } : i)));
      toast({ title: "Added to keywords", description: idea.keyword });
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setPromoting(null);
    }
  }

  const traditional = ideas.filter((i) => i.listType === "traditional");
  const aiSearch = ideas.filter((i) => i.listType === "ai_search");

  function renderTable(rows: Idea[], showPopularity: boolean) {
    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground py-8 text-center">No keywords yet — run a search above.</p>;
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Keyword</TableHead>
            <TableHead>Intent</TableHead>
            <TableHead className="text-right">Commercial</TableHead>
            {showPopularity && <TableHead className="text-right">Popularity</TableHead>}
            <TableHead className="text-right">LVS</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">
                {i.reasoning ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help border-b border-dotted border-muted-foreground/40">{i.keyword}</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{i.reasoning}</TooltipContent>
                  </Tooltip>
                ) : (
                  i.keyword
                )}
              </TableCell>
              <TableCell>
                <Badge variant={intentVariant(i.intent)}>{i.intent ?? "—"}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {i.commercialIntent != null ? `${Math.round(i.commercialIntent * 100)}%` : "—"}
              </TableCell>
              {showPopularity && (
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {i.popularity != null ? Math.round(i.popularity * 100) : "—"}
                </TableCell>
              )}
              <TableCell className={`text-right tabular-nums font-bold ${lvsColor(i.lvs)}`}>{i.lvs ?? "—"}</TableCell>
              <TableCell>
                {i.promotedKeywordId ? (
                  <span className="flex items-center justify-center text-emerald-500" title="Added to keywords">
                    <Check className="w-4 h-4" />
                  </span>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Add to keywords"
                    disabled={promoting === i.id}
                    onClick={() => promote(i)}
                  >
                    {promoting === i.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" /> Keyword Research
        </h1>
        <p className="text-muted-foreground">
          Discover local keywords from a seed + location, scored by Local Value Score (LVS). Promote the best ones into a campaign.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New research</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="seed">Seed keyword</Label>
              <Input id="seed" placeholder="e.g. childcare" value={seed} onChange={(e) => setSeed(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runResearch()} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="e.g. San Francisco, California" value={location}
                onChange={(e) => setLocation(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runResearch()} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Client (optional — for promoting)</Label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v); setCampaignId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name ?? c.businessName ?? `Client #${c.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Campaign (promote target)</Label>
              <Select value={campaignId} onValueChange={setCampaignId} disabled={!clientId}>
                <SelectTrigger><SelectValue placeholder={clientId ? "Select a campaign" : "Pick a client first"} /></SelectTrigger>
                <SelectContent>
                  {(campaigns ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name ?? c.planName ?? c.label ?? `Campaign #${c.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={runResearch} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              {loading ? "Researching…" : "Get Keywords"}
            </Button>
            {cost != null && (
              <span className="text-xs text-muted-foreground">DeepSeek cost: ${cost.toFixed(4)}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {ideas.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <Tabs defaultValue="traditional">
              <TabsList>
                <TabsTrigger value="traditional">Traditional ({traditional.length})</TabsTrigger>
                <TabsTrigger value="ai_search">AI search ({aiSearch.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="traditional" className="mt-4">{renderTable(traditional, true)}</TabsContent>
              <TabsContent value="ai_search" className="mt-4">{renderTable(aiSearch, false)}</TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
