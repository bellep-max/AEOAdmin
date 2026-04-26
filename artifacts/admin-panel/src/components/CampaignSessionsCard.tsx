import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity } from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { fmtDateTime, fmtDuration, fmtBool, statusBadgeClass } from "@/lib/session-common";

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
  backlinkInjected: boolean;
  backlinkFound: boolean;
  backlinkUrl: string | null;
}

interface SessionsResponse {
  sessions: SessionRow[];
  total: number;
  offset: number;
  limit: number;
}

interface Props {
  campaignId: number;
}

const PAGE_SIZE = 25;
const ALL = "__all__";
const POPOVER_MAX_H = "max-h-[320px]";

function etDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const m = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
function defaultToET():   string { return etDateString(new Date()); }
function defaultFromET(): string { return etDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)); }

export function CampaignSessionsCard({ campaignId }: Props) {
  const [platform, setPlatform] = useState<string>("");
  const [status, setStatus]     = useState<string>("");
  const [from, setFrom]         = useState<string>(() => defaultFromET());
  const [to, setTo]             = useState<string>(() => defaultToET());
  const [page, setPage]         = useState(0);
  const [open, setOpen]         = useState<SessionRow | null>(null);

  const { data, isLoading, error, refetch } = useQuery<SessionsResponse>({
    queryKey: ["/api/sessions/campaign", campaignId, platform, status, from, to, page],
    queryFn: async () => {
      const p = new URLSearchParams({ campaignId: String(campaignId) });
      if (platform) p.set("platform", platform);
      if (status)   p.set("status",   status);
      if (from)     p.set("from",     from);
      if (to)       p.set("to",       to);
      p.set("limit",  String(PAGE_SIZE));
      p.set("offset", String(page * PAGE_SIZE));
      const res = await rawFetch(`/api/sessions?${p}`);
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
    enabled: !!campaignId,
  });

  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function clearFilters() {
    setPlatform(""); setStatus("");
    setFrom(defaultFromET()); setTo(defaultToET());
    setPage(0);
  }

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Daily Sessions
              <span className="ml-1 text-xs font-normal text-muted-foreground">· times in America/New_York (ET)</span>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Platform</Label>
              <Select value={platform || ALL} onValueChange={(v) => { setPlatform(v === ALL ? "" : v); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent className={POPOVER_MAX_H}>
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
                <SelectContent className={POPOVER_MAX_H}>
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
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          </div>

          {/* Table */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{total.toLocaleString()} total</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
              <span>Page {page + 1} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>}
          {error   && <p className="text-sm text-destructive py-8 text-center">Failed to load sessions.</p>}
          {!isLoading && !error && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time <span className="text-xs font-normal text-muted-foreground">(ET)</span></TableHead>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Backlink</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.sessions ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No sessions found for this campaign.
                      </TableCell>
                    </TableRow>
                  ) : (data?.sessions ?? []).map((s) => (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(s)}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(s.timestamp)}</TableCell>
                      <TableCell className="text-sm font-medium">{s.keywordText ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{s.aiPlatform}</Badge></TableCell>
                      <TableCell><Badge className={statusBadgeClass(s.status)}>{s.status}</Badge></TableCell>
                      <TableCell className="text-sm">{fmtDuration(s.durationSeconds)}</TableCell>
                      <TableCell>{renderBacklink(s.backlinksExpected, s.backlinkInjected, s.backlinkFound)}</TableCell>
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
                  <Row label="Prompt"        value={open.promptText ?? "—"}  pre />
                  <Row label="Has follow-up" value={fmtBool(open.hasFollowUp)} />
                  <Row label="Follow-up"     value={open.followupText ?? "—"} pre />
                </Section>

                <Section title="Device & Proxy">
                  <Row label="Device id"       value={open.deviceIdentifier ?? (open.deviceId ? `#${open.deviceId}` : "—")} />
                  <Row label="Proxy status"    value={open.proxyStatus ?? "—"} />
                  <Row label="Proxy username"  value={open.proxyUsername ?? "—"} />
                  <Row label="Proxy host:port" value={open.proxyHost ? `${open.proxyHost}:${open.proxyPort ?? "?"}` : "—"} />
                  <Row label="Exit IP"         value={open.proxyIp ?? "—"} />
                  <Row label="Exit location"   value={[open.proxyCity, open.proxyRegion, open.proxyCountry, open.proxyZip].filter(Boolean).join(", ") || "—"} />
                </Section>

                <Section title="Geo">
                  <Row label="Base coords"   value={open.baseLatitude   != null && open.baseLongitude   != null ? `${open.baseLatitude}, ${open.baseLongitude}` : "—"} />
                  <Row label="Mocked coords" value={open.mockedLatitude != null && open.mockedLongitude != null ? `${open.mockedLatitude}, ${open.mockedLongitude}` : "—"} />
                  <Row label="Mocked tz"     value={open.mockedTimezone ?? "—"} />
                </Section>

                <Section title="Backlinks">
                  <Row label="Expected" value={open.backlinksExpected != null ? String(open.backlinksExpected) : "—"} />
                  <Row label="Injected" value={fmtBool(open.backlinkInjected)} />
                  <Row label="Found"    value={open.backlinkInjected ? fmtBool(open.backlinkFound) : "N/A (not injected)"} />
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
    </>
  );
}

function renderBacklink(expected: number | null, injected: boolean, found: boolean) {
  if (expected == null || expected === 0) {
    return <span className="text-xs text-muted-foreground" title="No backlinks configured for this keyword">—</span>;
  }
  if (!injected) {
    return <span className="text-xs text-muted-foreground" title="Control group — backlink not seeded in prompt">N/A</span>;
  }
  return (
    <Badge
      variant={found ? "default" : "outline"}
      title={found ? "Backlink URL surfaced in AI response" : "Backlink injected but not found in response"}
    >
      {found ? "Yes" : "No"}
    </Badge>
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
