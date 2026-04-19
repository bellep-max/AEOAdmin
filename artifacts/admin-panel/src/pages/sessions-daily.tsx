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
  fmtDateTime, fmtDuration, fmtBool, statusBadgeClass,
} from "@/lib/session-common";

interface SessionRow {
  id: number;
  clientId: number;
  businessId: number | null;
  campaignId: number | null;
  keywordId: number | null;
  deviceId: number | null;
  proxyId: number | null;
  clientName: string | null;
  bizName: string | null;
  campaignName: string | null;
  keywordText: string | null;
  city: string | null;
  state: string | null;
  date: string | null;
  timestamp: string;
  durationSeconds: number | null;
  promptText: string | null;
  followupText: string | null;
  hasFollowUp: boolean;
  status: string;
  type: string;
  errorClass: string | null;
  errorMessage: string | null;
  aiPlatform: string;
  screenshotUrl: string | null;
  deviceIdentifier: string | null;
  proxyStatus: string | null;
  proxySessionId: string | null;
  proxyUsername: string | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyIp: string | null;
  proxyCity: string | null;
  proxyRegion: string | null;
  proxyCountry: string | null;
  proxyZip: string | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  mockedLatitude: number | null;
  mockedLongitude: number | null;
  mockedTimezone: string | null;
  backlinksExpected: number | null;
  backlinkFound: boolean;
  backlinkUrl: string | null;
}

interface SessionsResponse {
  sessions: SessionRow[];
  total: number;
  offset: number;
  limit: number;
}

const PAGE_SIZE = 50;
const ALL = "__all__";

export default function SessionsDaily() {
  const [clientId, setClientId] = useState<number | null>(null);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<SessionRow | null>(null);

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

  const queryKey = ["/api/sessions", clientId, businessId, campaignId, platform, status, from, to, page] as const;
  const { data, isLoading, error, refetch } = useQuery<SessionsResponse>({
    queryKey,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (clientId   != null) p.set("clientId",   String(clientId));
      if (businessId != null) p.set("businessId", String(businessId));
      if (campaignId != null) p.set("campaignId", String(campaignId));
      if (platform)           p.set("platform",   platform);
      if (status)             p.set("status",     status);
      if (from)               p.set("from",       from);
      if (to)                 p.set("to",         to);
      p.set("limit",  String(PAGE_SIZE));
      p.set("offset", String(page * PAGE_SIZE));
      const res = await rawFetch(`/api/sessions?${p}`);
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function clearFilters() {
    setClientId(null); setBusinessId(null); setCampaignId(null);
    setPlatform(""); setStatus(""); setFrom(""); setTo(""); setPage(0);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Daily Sessions</h1>
          <p className="text-sm text-muted-foreground">Per-run logs from the executor — one row per AI session.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Client</Label>
              <Select
                value={clientId == null ? ALL : String(clientId)}
                onValueChange={(v) => { setClientId(v === ALL ? null : Number(v)); setBusinessId(null); setCampaignId(null); setPage(0); }}
              >
                <SelectTrigger><SelectValue placeholder="All clients" /></SelectTrigger>
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
                <SelectTrigger><SelectValue placeholder={clientId == null ? "Pick client first" : "All businesses"} /></SelectTrigger>
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
                <SelectTrigger><SelectValue placeholder="All campaigns" /></SelectTrigger>
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
                  <SelectItem value={ALL}>All platforms</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                  <SelectItem value="chatgpt">ChatGPT</SelectItem>
                  <SelectItem value="perplexity">Perplexity</SelectItem>
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
                  <SelectItem value="pending">Pending</SelectItem>
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
            Sessions
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
          {error && <p className="text-sm text-destructive py-8 text-center">Failed to load sessions.</p>}
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
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Proxy</TableHead>
                    <TableHead>Backlink</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.sessions ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No sessions match these filters.</TableCell></TableRow>
                  ) : (data?.sessions ?? []).map((s) => (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(s)}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(s.timestamp)}</TableCell>
                      <TableCell className="text-sm">{s.clientName ?? `#${s.clientId}`}</TableCell>
                      <TableCell className="text-sm">{s.bizName ?? "—"}</TableCell>
                      <TableCell className="text-sm">{s.campaignName ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{s.keywordText ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{s.aiPlatform}</Badge></TableCell>
                      <TableCell><Badge className={statusBadgeClass(s.status)}>{s.status}</Badge></TableCell>
                      <TableCell className="text-sm">{fmtDuration(s.durationSeconds)}</TableCell>
                      <TableCell className="text-xs">{[s.proxyCity, s.proxyRegion].filter(Boolean).join(", ") || "—"}</TableCell>
                      <TableCell><Badge variant={s.backlinkFound ? "default" : "outline"}>{fmtBool(s.backlinkFound)}</Badge></TableCell>
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
                <SheetTitle>Session #{open.id}</SheetTitle>
                <SheetDescription>{fmtDateTime(open.timestamp)} · {open.aiPlatform}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5 text-sm">
                <Section title="Identity">
                  <Row label="Client"   value={`${open.clientName ?? "—"}${open.clientId ? ` (#${open.clientId})` : ""}`} />
                  <Row label="Business" value={`${open.bizName ?? "—"}${open.businessId ? ` (#${open.businessId})` : ""}`} />
                  <Row label="Campaign" value={`${open.campaignName ?? "—"}${open.campaignId ? ` (#${open.campaignId})` : ""}`} />
                  <Row label="Keyword"  value={`${open.keywordText ?? "—"}${open.keywordId ? ` (#${open.keywordId})` : ""}`} />
                  <Row label="City/State" value={[open.city, open.state].filter(Boolean).join(", ") || "—"} />
                </Section>

                <Section title="Run">
                  <Row label="Status"   value={open.status} />
                  <Row label="Type"     value={open.type} />
                  <Row label="Duration" value={fmtDuration(open.durationSeconds)} />
                  <Row label="Date"     value={open.date ?? "—"} />
                </Section>

                <Section title="Prompts">
                  <Row label="Prompt"     value={open.promptText ?? "—"}   pre />
                  <Row label="Has follow-up" value={fmtBool(open.hasFollowUp)} />
                  <Row label="Follow-up"  value={open.followupText ?? "—"} pre />
                </Section>

                <Section title="Device & Proxy">
                  <Row label="Device id"        value={open.deviceIdentifier ?? (open.deviceId ? `#${open.deviceId}` : "—")} />
                  <Row label="Proxy status"     value={open.proxyStatus ?? "—"} />
                  <Row label="Proxy username"   value={open.proxyUsername ?? "—"} />
                  <Row label="Proxy host:port"  value={open.proxyHost ? `${open.proxyHost}:${open.proxyPort ?? "?"}` : "—"} />
                  <Row label="Exit IP"          value={open.proxyIp ?? "—"} />
                  <Row label="Exit location"    value={[open.proxyCity, open.proxyRegion, open.proxyCountry, open.proxyZip].filter(Boolean).join(", ") || "—"} />
                </Section>

                <Section title="Geo">
                  <Row label="Base coords"   value={open.baseLatitude   != null && open.baseLongitude   != null ? `${open.baseLatitude}, ${open.baseLongitude}` : "—"} />
                  <Row label="Mocked coords" value={open.mockedLatitude != null && open.mockedLongitude != null ? `${open.mockedLatitude}, ${open.mockedLongitude}` : "—"} />
                  <Row label="Mocked tz"     value={open.mockedTimezone ?? "—"} />
                </Section>

                <Section title="Backlinks">
                  <Row label="Expected" value={open.backlinksExpected != null ? String(open.backlinksExpected) : "—"} />
                  <Row label="Found"    value={fmtBool(open.backlinkFound)} />
                  <Row label="URL"      value={open.backlinkUrl ?? "—"} />
                </Section>

                {open.errorMessage && (
                  <Section title="Error">
                    <Row label="Class"   value={open.errorClass ?? "—"} />
                    <Row label="Message" value={open.errorMessage} pre />
                  </Section>
                )}

                {open.screenshotUrl && (
                  <Section title="Screenshot">
                    <Row label="URL" value={open.screenshotUrl} />
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
