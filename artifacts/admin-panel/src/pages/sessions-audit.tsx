import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rawFetch } from "@/lib/period-comparison";
import {
  useClients, useBusinesses, useCampaigns,
  fmtDateTime, fmtDuration, statusBadgeClass,
} from "@/lib/session-common";

interface AuditRow {
  id: number;
  clientId: number | null;
  businessId: number | null;
  campaignId: number | null;
  keywordId: number | null;
  deviceId: number | null;
  bizName: string | null;
  campaignName: string | null;
  keywordText: string | null;
  clientName: string | null;
  timestamp: string;
  createdAt: string;
  platform: string | null;
  mode: string | null;
  device: string | null;
  status: string | null;
  durationSeconds: number | null;
  rankPosition: number | null;
  rankTotal: number | null;
  mentioned: string | null;
  rankContext: string | null;
  screenshotPath: string | null;
  responseText: string | null;
  prompt: string | null;
  error: string | null;
  proxyUsername: string | null;
  proxyIp: string | null;
  proxyCity: string | null;
  proxyRegion: string | null;
  proxyZip: string | null;
}

interface AuditResponse {
  logs: AuditRow[];
  total: number;
  offset: number;
  limit: number;
}

const PAGE_SIZE = 50;
const ALL = "__all__";

export default function SessionsAudit() {
  const [clientId, setClientId] = useState<number | null>(null);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [mode, setMode] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AuditRow | null>(null);

  const { data: clients } = useClients();
  const { data: businesses } = useBusinesses(clientId);
  const { data: campaigns } = useCampaigns(clientId);

  const filteredBusinesses = useMemo(
    () => (clientId == null ? [] : (businesses ?? []).filter((b) => b.clientId === clientId)),
    [businesses, clientId],
  );
  const filteredCampaigns = useMemo(
    () => (campaigns ?? []).filter((c) =>
      (clientId == null   || c.clientId === clientId) &&
      (businessId == null || c.businessId === businessId),
    ),
    [campaigns, clientId, businessId],
  );

  const queryKey = ["/api/audit-logs", clientId, businessId, campaignId, platform, mode, status, from, to, page] as const;
  const { data, isLoading, error, refetch } = useQuery<AuditResponse>({
    queryKey,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (clientId   != null) p.set("clientId",   String(clientId));
      if (businessId != null) p.set("businessId", String(businessId));
      if (campaignId != null) p.set("campaignId", String(campaignId));
      if (platform)           p.set("platform",   platform);
      if (mode)               p.set("mode",       mode);
      if (status)             p.set("status",     status);
      if (from)               p.set("from",       from);
      if (to)                 p.set("to",         to);
      p.set("limit",  String(PAGE_SIZE));
      p.set("offset", String(page * PAGE_SIZE));
      const res = await rawFetch(`/api/audit-logs?${p}`);
      if (!res.ok) throw new Error("Failed to load audit logs");
      return res.json();
    },
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function clearFilters() {
    setClientId(null); setBusinessId(null); setCampaignId(null);
    setPlatform(""); setMode(""); setStatus(""); setFrom(""); setTo(""); setPage(0);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Ranking</h1>
          <p className="text-sm text-muted-foreground">Audit-mode ranking checks from the executor — one row per keyword × platform.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Client</Label>
              <Select
                value={clientId == null ? ALL : String(clientId)}
                onValueChange={(v) => { setClientId(v === ALL ? null : Number(v)); setBusinessId(null); setCampaignId(null); setPage(0); }}
              >
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All clients</SelectItem>
                  {(clients ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.businessName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Business</Label>
              <Select
                value={businessId == null ? ALL : String(businessId)}
                onValueChange={(v) => { setBusinessId(v === ALL ? null : Number(v)); setCampaignId(null); setPage(0); }}
                disabled={clientId == null}
              >
                <SelectTrigger><SelectValue placeholder={clientId == null ? "Pick client first" : "All"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All businesses</SelectItem>
                  {filteredBusinesses.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Campaign</Label>
              <Select
                value={campaignId == null ? ALL : String(campaignId)}
                onValueChange={(v) => { setCampaignId(v === ALL ? null : Number(v)); setPage(0); }}
                disabled={clientId == null}
              >
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All campaigns</SelectItem>
                  {filteredCampaigns.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name ?? c.planType}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Platform</Label>
              <Select value={platform || ALL} onValueChange={(v) => { setPlatform(v === ALL ? "" : v); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  <SelectItem value="Gemini">Gemini</SelectItem>
                  <SelectItem value="ChatGPT">ChatGPT</SelectItem>
                  <SelectItem value="Perplexity">Perplexity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mode</Label>
              <Select value={mode || ALL} onValueChange={(v) => { setMode(v === ALL ? "" : v); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  <SelectItem value="adb">adb</SelectItem>
                  <SelectItem value="appium">appium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={status || ALL} onValueChange={(v) => { setStatus(v === ALL ? "" : v); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Audit logs
            <span className="ml-2 text-sm font-normal text-muted-foreground">{total.toLocaleString()} total</span>
          </CardTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
            <span>Page {page + 1} / {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>}
          {error && <p className="text-sm text-destructive py-8 text-center">Failed to load audit logs.</p>}
          {!isLoading && !error && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Business</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rank</TableHead>
                    <TableHead>Mentioned</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.logs ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No audit logs match these filters.</TableCell></TableRow>
                  ) : (data?.logs ?? []).map((l) => (
                    <TableRow key={l.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(l)}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(l.timestamp ?? l.createdAt)}</TableCell>
                      <TableCell className="text-sm">{l.clientName ?? (l.clientId ? `#${l.clientId}` : "—")}</TableCell>
                      <TableCell className="text-sm">{l.bizName ?? "—"}</TableCell>
                      <TableCell className="text-sm">{l.campaignName ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{l.keywordText ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{l.platform ?? "—"}</Badge></TableCell>
                      <TableCell className="text-xs">{l.mode ?? "—"}</TableCell>
                      <TableCell><Badge className={statusBadgeClass(l.status)}>{l.status ?? "—"}</Badge></TableCell>
                      <TableCell className="text-sm">{l.rankPosition != null ? `${l.rankPosition}/${l.rankTotal ?? "?"}` : "—"}</TableCell>
                      <TableCell className="text-sm">{l.mentioned === "yes" ? <Badge>Yes</Badge> : "—"}</TableCell>
                      <TableCell className="text-sm">{fmtDuration(l.durationSeconds)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail drawer */}
      <Sheet open={open != null} onOpenChange={(v) => { if (!v) setOpen(null); }}>
        <SheetContent className="w-[640px] sm:max-w-[640px] overflow-y-auto">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>Audit #{open.id}</SheetTitle>
                <SheetDescription>{fmtDateTime(open.timestamp ?? open.createdAt)} · {open.platform ?? "—"}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5 text-sm">
                <Section title="Identity">
                  <Row label="Client"   value={`${open.clientName ?? "—"}${open.clientId ? ` (#${open.clientId})` : ""}`} />
                  <Row label="Business" value={`${open.bizName ?? "—"}${open.businessId ? ` (#${open.businessId})` : ""}`} />
                  <Row label="Campaign" value={`${open.campaignName ?? "—"}${open.campaignId ? ` (#${open.campaignId})` : ""}`} />
                  <Row label="Keyword"  value={`${open.keywordText ?? "—"}${open.keywordId ? ` (#${open.keywordId})` : ""}`} />
                </Section>

                <Section title="Run">
                  <Row label="Status"   value={open.status ?? "—"} />
                  <Row label="Mode"     value={open.mode ?? "—"} />
                  <Row label="Device"   value={open.device ?? (open.deviceId ? `#${open.deviceId}` : "—")} />
                  <Row label="Duration" value={fmtDuration(open.durationSeconds)} />
                </Section>

                <Section title="Ranking">
                  <Row label="Position"  value={open.rankPosition != null ? `${open.rankPosition} / ${open.rankTotal ?? "?"}` : "—"} />
                  <Row label="Mentioned" value={open.mentioned ?? "—"} />
                  <Row label="Context"   value={open.rankContext ?? "—"} pre />
                </Section>

                <Section title="Prompt & Response">
                  <Row label="Prompt"   value={open.prompt ?? "—"} pre />
                  <Row label="Response" value={open.responseText ?? "—"} />
                </Section>

                <Section title="Proxy">
                  <Row label="Username" value={open.proxyUsername ?? "—"} />
                  <Row label="Exit IP"  value={open.proxyIp ?? "—"} />
                  <Row label="Location" value={[open.proxyCity, open.proxyRegion, open.proxyZip].filter(Boolean).join(", ") || "—"} />
                </Section>

                {open.error && (
                  <Section title="Error">
                    <Row label="Message" value={open.error} pre />
                  </Section>
                )}

                {open.screenshotPath && (
                  <Section title="Screenshot">
                    <Row label="Path" value={open.screenshotPath} />
                  </Section>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value, pre = false }: { label: string; value: string; pre?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-32 shrink-0 text-xs text-muted-foreground pt-0.5">{label}</div>
      {pre
        ? <pre className="flex-1 whitespace-pre-wrap break-words text-xs bg-muted/50 rounded p-2">{value}</pre>
        : <div className="flex-1 break-words text-sm">{value}</div>}
    </div>
  );
}
