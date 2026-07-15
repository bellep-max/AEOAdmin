import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { rawFetch } from "@/lib/period-comparison";
import {
  MailCheck,
  Eye,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

interface SendRow {
  id: number;
  clientId: number | null;
  clientName: string | null;
  sentAt: string;
  recipients: string[];
  intendedRecipients: string[] | null;
  subject: string;
  status: string;
  kind: string | null;
  meta: {
    keyword?: string;
    platform?: string;
    beforeRank?: number;
    afterRank?: number;
    business?: string;
    mode?: string;
  } | null;
  ghlStatus: string | null;
  error: string | null;
  deliveredVia: string | null;
  latestStatus: string | null;
  latestEventAt: string | null;
  openedCount: number | null;
  clickedCount: number | null;
}

interface SendEvent {
  id: number;
  provider: string;
  event: string;
  occurredAt: string | null;
  createdAt: string;
}

interface SendDetail extends SendRow {
  html: string | null;
  events?: SendEvent[];
}

/* Normalized lifecycle status → label + tone. Advances Sent → Delivered →
   Opened → Clicked as provider webhooks fire; red for terminal failures. */
const LIFECYCLE: Record<
  string,
  { label: string; cls: string; title?: string }
> = {
  sent: { label: "Sent", cls: "border-slate-300 text-slate-600 bg-slate-50" },
  delivered: {
    label: "Delivered",
    cls: "border-sky-300 text-sky-700 bg-sky-50",
  },
  opened: {
    label: "Opened",
    cls: "border-amber-300 text-amber-700 bg-amber-50",
    title:
      "Open tracking can be triggered automatically (e.g. Apple Mail) — clicks are the reliable signal",
  },
  clicked: {
    label: "Clicked",
    cls: "border-emerald-300 text-emerald-700 bg-emerald-50",
  },
  bounced: { label: "Bounced", cls: "border-red-300 text-red-700 bg-red-50" },
  dropped: { label: "Dropped", cls: "border-red-300 text-red-700 bg-red-50" },
  spam: { label: "Spam", cls: "border-red-300 text-red-700 bg-red-50" },
  unsubscribed: {
    label: "Unsubscribed",
    cls: "border-slate-300 text-slate-600 bg-slate-50",
  },
  failed: { label: "Failed", cls: "border-red-300 text-red-700 bg-red-50" },
};

/* The lifecycle key a row displays as (mirrors LifecycleBadge). */
function effectiveStatus(row: SendRow): string {
  return row.status === "failed" ? "failed" : (row.latestStatus ?? row.status);
}

/* Coarse bucket for the summary tiles + status filter. Hard failures collapse
   into one "failed" bucket; everything pre-delivery counts as "sent". */
function statusBucket(
  row: SendRow,
): "sent" | "delivered" | "opened" | "clicked" | "failed" {
  const s = effectiveStatus(row);
  if (["failed", "bounced", "dropped", "spam"].includes(s)) return "failed";
  if (s === "delivered" || s === "opened" || s === "clicked") return s;
  return "sent";
}

const PAGE_SIZE = 20;

/* Summary tiles — also act as one-click status filters. */
const TILES: Array<{
  key: "all" | "delivered" | "opened" | "clicked" | "failed";
  label: string;
  active: string;
  idle: string;
}> = [
  {
    key: "all",
    label: "Total",
    active: "border-primary bg-primary/10 text-foreground",
    idle: "border-border bg-card text-foreground hover:border-primary/50",
  },
  {
    key: "delivered",
    label: "Delivered",
    active: "border-sky-400 bg-sky-100 text-sky-800",
    idle: "border-border bg-card text-sky-700 hover:border-sky-300",
  },
  {
    key: "opened",
    label: "Opened",
    active: "border-amber-400 bg-amber-100 text-amber-800",
    idle: "border-border bg-card text-amber-700 hover:border-amber-300",
  },
  {
    key: "clicked",
    label: "Clicked",
    active: "border-emerald-400 bg-emerald-100 text-emerald-800",
    idle: "border-border bg-card text-emerald-700 hover:border-emerald-300",
  },
  {
    key: "failed",
    label: "Failed",
    active: "border-red-400 bg-red-100 text-red-800",
    idle: "border-border bg-card text-red-700 hover:border-red-300",
  },
];

function LifecycleBadge({ row }: { row: SendRow }) {
  const key = effectiveStatus(row);
  const meta = LIFECYCLE[key] ?? {
    label: key,
    cls: "border-slate-300 text-slate-600 bg-slate-50",
  };
  return (
    <Badge variant="outline" className={meta.cls} title={meta.title}>
      {meta.label}
    </Badge>
  );
}

function platformLabel(p: string | undefined): string {
  if (p === "chatgpt") return "ChatGPT";
  if (p === "gemini") return "Gemini";
  if (p === "perplexity") return "Perplexity";
  return p ?? "";
}

function fmtWhen(s: string): string {
  return new Date(s).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function GhlChip({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const posted = status === "posted";
  const failed = status.startsWith("failed");
  return (
    <Badge
      variant="outline"
      className={
        posted
          ? "border-emerald-300 text-emerald-700 bg-emerald-50"
          : failed
            ? "border-red-300 text-red-700 bg-red-50"
            : "border-slate-300 text-slate-600 bg-slate-50"
      }
      title={status}
    >
      {posted ? "GHL ✓" : failed ? "GHL ✗" : status}
    </Badge>
  );
}

export default function SentEmails() {
  const [kind, setKind] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [viewId, setViewId] = useState<number | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ sends: SendRow[] }>({
    queryKey: ["/api/sales/email-sends", kind],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (kind !== "all") p.set("kind", kind);
      const res = await rawFetch(`/api/sales/email-sends?${p}`);
      if (!res.ok) throw new Error("Failed to load sent emails");
      return res.json();
    },
  });

  const { data: detail, isFetching: detailLoading } = useQuery<SendDetail>({
    enabled: viewId != null,
    queryKey: ["/api/sales/email-sends", "detail", viewId],
    queryFn: async () => {
      const res = await rawFetch(`/api/sales/email-sends/${viewId}`);
      if (!res.ok) throw new Error("Failed to load email");
      return res.json();
    },
  });

  // GHL lifecycle status is pulled on demand (no webhook drives it). Refresh
  // recent non-terminal sends on load and via the button, then reload the list.
  const refresh = useMutation({
    mutationFn: async () => {
      const p = new URLSearchParams();
      if (kind !== "all") p.set("kind", kind);
      const res = await rawFetch(`/api/sales/email-sends/refresh-status?${p}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to refresh statuses");
      return res.json() as Promise<{ polled: number; updated: number }>;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["/api/sales/email-sends", kind] }),
  });

  useEffect(() => {
    refresh.mutate();
    // Re-poll when the kind filter changes; refresh identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const sends = useMemo(() => data?.sends ?? [], [data]);

  // Search filter (subject / client / recipients / keyword) — independent of the
  // status filter so the tiles can show every status's count within the search.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sends;
    return sends.filter((s) => {
      const hay = [
        s.subject,
        s.clientName ?? "",
        (s.recipients ?? []).join(" "),
        (s.intendedRecipients ?? []).join(" "),
        s.meta?.keyword ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sends, search]);

  const counts = useMemo(() => {
    const c = {
      all: searched.length,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      failed: 0,
    };
    for (const s of searched) c[statusBucket(s)]++;
    return c;
  }, [searched]);

  const filtered = useMemo(
    () =>
      status === "all"
        ? searched
        : searched.filter((s) => statusBucket(s) === status),
    [searched, status],
  );

  // Keep the page in range whenever the result set shrinks.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  useEffect(() => {
    setPage(1);
  }, [search, status, kind]);

  const start = (page - 1) * PAGE_SIZE;
  const paged = filtered.slice(start, start + PAGE_SIZE);
  const hasFilters = search.trim() !== "" || status !== "all";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <MailCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sent Emails</h1>
            <p className="text-sm text-muted-foreground">
              Every report & sales email sent from the admin panel — click one
              to see exactly what the recipient got.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          title="Pull the latest delivered / opened / clicked status from GHL"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${refresh.isPending ? "animate-spin" : ""}`}
          />
          {refresh.isPending ? "Refreshing…" : "Refresh status"}
        </Button>
      </div>

      {/* Summary tiles — click one to filter by that status. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {TILES.map((t) => {
          const isActive =
            status === t.key || (t.key === "all" && status === "all");
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                isActive ? t.active : t.idle
              }`}
            >
              <div className="text-2xl font-bold tabular-nums">
                {counts[t.key]}
              </div>
              <div className="text-xs font-medium uppercase tracking-wide opacity-80">
                {t.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, client, recipient, keyword…"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="opened">Opened</SelectItem>
            <SelectItem value="clicked">Clicked</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="sales">Sales emails</SelectItem>
            <SelectItem value="report">Ranking reports</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground"
            onClick={() => {
              setSearch("");
              setStatus("all");
            }}
          >
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground border-b">
            <div className="col-span-2">Sent</div>
            <div className="col-span-2">Client</div>
            <div className="col-span-3">Subject</div>
            <div className="col-span-2">Proof</div>
            <div className="col-span-1">Kind</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1" />
          </div>
          {isLoading && (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">
              {sends.length === 0
                ? "No emails sent yet."
                : "No emails match your filters."}
            </div>
          )}
          {paged.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm border-b last:border-b-0 hover:bg-muted/30"
            >
              <div className="col-span-2 text-xs text-muted-foreground">
                {fmtWhen(s.sentAt)}
              </div>
              <div className="col-span-2 truncate font-medium">
                {s.clientName ?? "—"}
              </div>
              <div className="col-span-3 truncate" title={s.subject}>
                {s.subject}
              </div>
              <div className="col-span-2 text-xs text-muted-foreground truncate">
                {s.meta?.keyword ? (
                  <>
                    “{s.meta.keyword}” · #{s.meta.beforeRank} → #
                    {s.meta.afterRank} {platformLabel(s.meta.platform)}
                  </>
                ) : (
                  (s.meta?.mode ?? "—")
                )}
              </div>
              <div className="col-span-1">
                <Badge variant="secondary" className="capitalize">
                  {s.kind ?? "—"}
                </Badge>
              </div>
              <div className="col-span-1 flex flex-col gap-1">
                <LifecycleBadge row={s} />
                {((s.clickedCount ?? 0) > 0 || (s.openedCount ?? 0) > 0) && (
                  <span className="text-[10px] text-muted-foreground">
                    {(s.clickedCount ?? 0) > 0 && `${s.clickedCount} click`}
                    {(s.clickedCount ?? 0) > 0 &&
                      (s.openedCount ?? 0) > 0 &&
                      " · "}
                    {(s.openedCount ?? 0) > 0 && `${s.openedCount} open`}
                  </span>
                )}
                {s.kind === "sales" && <GhlChip status={s.ghlStatus} />}
              </div>
              <div className="col-span-1 text-right">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setViewId(s.id)}
                >
                  <Eye className="w-3.5 h-3.5" /> View
                </Button>
              </div>
            </div>
          ))}

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t text-sm">
              <span className="text-xs text-muted-foreground">
                Showing {start + 1}–
                {Math.min(start + PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length}
                {filtered.length !== sends.length &&
                  ` (filtered from ${sends.length})`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Prev
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {page} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={viewId != null} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{detail?.subject ?? "Sent email"}</DialogTitle>
            <DialogDescription>
              {detail
                ? `Sent ${fmtWhen(detail.sentAt)} to ${(detail.intendedRecipients ?? detail.recipients).join(", ")}`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="flex-shrink-0 flex flex-wrap items-center gap-2 pb-2">
              <LifecycleBadge row={detail} />
              {(detail.events ?? []).map((e) => (
                <span
                  key={e.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                  title={`${e.provider} · ${e.occurredAt ?? e.createdAt}`}
                >
                  <span className="capitalize">{e.event}</span>
                  <span className="opacity-60">
                    {fmtWhen(e.occurredAt ?? e.createdAt)}
                  </span>
                </span>
              ))}
              {detail.events && detail.events.length === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  No delivery events yet.
                </span>
              )}
            </div>
          )}
          <div className="flex-1 min-h-0 border rounded-md overflow-hidden bg-white">
            {detailLoading && (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            )}
            {detail?.html ? (
              <iframe
                title="sent email"
                srcDoc={detail.html}
                className="w-full h-full border-0"
              />
            ) : (
              !detailLoading && (
                <div className="p-4 text-sm text-muted-foreground">
                  No stored copy for this send (sent before archiving was
                  added).
                </div>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
