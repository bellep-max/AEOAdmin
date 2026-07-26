import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { ExternalLink, Lock, Unlock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { rawFetch } from "@/lib/api-fetch";
import { StatusBadge } from "./StatusBadge";
import { PLATFORM_LABELS, type LockedKeywordRecord, type Platform } from "./types";

interface RankingReportRow {
  id: number;
  platform: string | null;
  status: string | null;
  rankingPosition: number | null;
  date: string | null;
  createdAt: string;
  deviceIdentifier: string | null;
  error: string | null;
  failureStep: string | null;
  proxyCity: string | null;
  proxyRegion: string | null;
  proxyCountry: string | null;
}

function useKeywordReports(keywordId: number | null) {
  return useQuery({
    queryKey: ["lk-drawer-reports", keywordId],
    enabled: keywordId != null,
    queryFn: async () => {
      const r = await rawFetch(`/api/ranking-reports?keywordId=${keywordId}&limit=200`);
      if (!r.ok) throw new Error("Failed to load platform history");
      const b = await r.json();
      return (b.data ?? []) as RankingReportRow[];
    },
  });
}

interface LockEvent {
  id: number;
  action: string;
  reason: string | null;
  note: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  retentionAtAction: number | null;
  actorEmail: string | null;
  createdAt: string;
}

function useKeywordEvents(keywordId: number | null) {
  return useQuery({
    queryKey: ["lk-drawer-events", keywordId],
    enabled: keywordId != null,
    queryFn: async () => {
      const r = await rawFetch(`/api/admin/locked-keywords/${keywordId}/events`);
      if (!r.ok) throw new Error("Failed to load decision history");
      const b = await r.json();
      return (b.items ?? []) as LockEvent[];
    },
  });
}

function OverviewTab({ record }: { record: LockedKeywordRecord }) {
  const rows: [string, string][] = [
    ["Retention rate", record.retentionRate == null ? "— no valid checks yet" : `${Math.round(record.retentionRate * 10) / 10}%`],
    ["Valid checks", String(record.validChecks)],
    ["Top-3 checks", String(record.topThreeChecks)],
    ["Absent checks", String(record.absentChecks)],
    ["Consecutive absent", String(record.consecutiveAbsentChecks)],
    ["Checks this cycle (incl. failed)", String(record.totalChecksInCycle)],
    ["Last valid check", record.lastValidCheckAt ? format(new Date(record.lastValidCheckAt), "MMM d, yyyy") : "—"],
    ["Next check due", record.nextCheckDueNow ? "Due now" : record.nextCheckDueAt ? format(new Date(record.nextCheckDueAt), "MMM d, yyyy") : "Not scheduled"],
    ["Maintenance level", record.maintenanceLevel[0].toUpperCase() + record.maintenanceLevel.slice(1)],
  ];
  return (
    <div className="space-y-4 py-4">
      <div className="rounded-lg border divide-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlatformHistoryTab({ keywordId }: { keywordId: number }) {
  const { data: reports, isLoading } = useKeywordReports(keywordId);
  if (isLoading) return <div className="py-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 rounded" />)}</div>;
  const sorted = [...(reports ?? [])].sort(
    (a, b) => new Date(b.date ?? b.createdAt).getTime() - new Date(a.date ?? a.createdAt).getTime(),
  );
  if (sorted.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No ranking checks recorded yet.</p>;
  return (
    <div className="py-4">
      <div className="rounded-lg border divide-y max-h-[480px] overflow-y-auto">
        {sorted.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="w-24 text-xs text-muted-foreground shrink-0">
              {format(new Date(r.date ?? r.createdAt), "MMM d, yyyy")}
            </span>
            <span className="w-20 text-xs font-medium shrink-0">{r.platform ? PLATFORM_LABELS[r.platform as Platform] ?? r.platform : "—"}</span>
            <span className="flex-1 text-xs">
              {r.status !== "success" ? (
                <span className="text-destructive">Failed{r.failureStep ? ` — ${r.failureStep}` : ""}</span>
              ) : r.rankingPosition == null ? (
                <span className="text-destructive">Absent</span>
              ) : (
                <span className={r.rankingPosition <= 3 ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>
                  Rank {r.rankingPosition}
                </span>
              )}
            </span>
            <span className="text-[11px] text-muted-foreground shrink-0">{r.status === "success" ? "Valid" : "Failed"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionHealthTab({ keywordId }: { keywordId: number }) {
  const { data: reports, isLoading } = useKeywordReports(keywordId);
  if (isLoading) return <div className="py-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 rounded" />)}</div>;
  const list = reports ?? [];
  const successful = list.filter((r) => r.status === "success").length;
  const failed = list.filter((r) => r.status !== "success").length;
  const lastError = [...list]
    .filter((r) => r.status !== "success" && (r.error || r.failureStep))
    .sort((a, b) => new Date(b.date ?? b.createdAt).getTime() - new Date(a.date ?? a.createdAt).getTime())[0];
  const latestByDate = [...list].sort((a, b) => new Date(b.date ?? b.createdAt).getTime() - new Date(a.date ?? a.createdAt).getTime())[0];

  const rows: [string, string][] = [
    ["Successful sessions", String(successful)],
    ["Failed sessions", String(failed)],
    ["Last technical error", lastError ? (lastError.error ?? lastError.failureStep ?? "—") : "None recorded"],
    ["Last error date", lastError ? format(new Date(lastError.date ?? lastError.createdAt), "MMM d, yyyy") : "—"],
    ["Device (most recent)", latestByDate?.deviceIdentifier ?? "—"],
    [
      "Location (most recent)",
      latestByDate && (latestByDate.proxyCity || latestByDate.proxyRegion || latestByDate.proxyCountry)
        ? [latestByDate.proxyCity, latestByDate.proxyRegion, latestByDate.proxyCountry].filter(Boolean).join(", ")
        : "—",
    ],
  ];
  return (
    <div className="space-y-4 py-4">
      <div className="rounded-lg border divide-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
            <span className="text-muted-foreground shrink-0">{label}</span>
            <span className="font-medium text-right truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionHistoryTab({ record }: { record: LockedKeywordRecord }) {
  const { data: events, isLoading } = useKeywordEvents(record.id);
  if (isLoading) return <div className="py-4 space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 rounded" />)}</div>;
  return (
    <div className="py-4 space-y-3">
      <div className="flex items-start gap-3 rounded-lg border px-4 py-3">
        <Lock className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium">Locked</p>
          <p className="text-xs text-muted-foreground">
            {record.lockedAt ? format(new Date(record.lockedAt), "MMM d, yyyy 'at' h:mm a") : "Not recorded — locked before lock-date tracking began"}
          </p>
        </div>
      </div>
      {(events ?? []).map((e) => (
        <div key={e.id} className="flex items-start gap-3 rounded-lg border px-4 py-3">
          <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium capitalize">{e.action.replace(/_/g, " ")}</p>
            {e.reason && <p className="text-xs text-muted-foreground">{e.reason}</p>}
            {e.note && <p className="text-xs text-muted-foreground italic">"{e.note}"</p>}
            <p className="text-[11px] text-muted-foreground mt-1">
              {format(new Date(e.createdAt), "MMM d, yyyy 'at' h:mm a")}
              {e.actorEmail ? ` · ${e.actorEmail}` : ""}
            </p>
          </div>
        </div>
      ))}
      {(events ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No further actions recorded yet.
        </p>
      )}
    </div>
  );
}

export function LockedKeywordDetailDrawer({
  record,
  onOpenChange,
  onUnlockClick,
}: {
  record: LockedKeywordRecord | null;
  onOpenChange: (open: boolean) => void;
  onUnlockClick: (record: LockedKeywordRecord) => void;
}) {
  const [, navigate] = useLocation();

  return (
    <Sheet open={record != null} onOpenChange={onOpenChange}>
      <SheetContent className="w-[560px] sm:max-w-[560px] overflow-y-auto">
        {record && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{record.keywordText}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span>{record.clientName ?? "—"}{record.businessName ? ` · ${record.businessName}` : ""}</span>
                  {(record.city || record.state) && <span>· {[record.city, record.state].filter(Boolean).join(", ")}</span>}
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <StatusBadge status={record.status} />
              <span className="text-xs text-muted-foreground">
                Locked {record.lockedAt ? format(new Date(record.lockedAt), "MMM d, yyyy") : "— not recorded"}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => onUnlockClick(record)}>
                  <Unlock className="w-3.5 h-3.5" /> Unlock Keyword
                </Button>
                {record.businessId != null && record.aeoPlanId != null && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => navigate(`/clients/${record.clientId}/businesses/${record.businessId}/campaigns/${record.aeoPlanId}`)}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open Campaign
                  </Button>
                )}
              </div>
            </div>

            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="platform-history">Platform History</TabsTrigger>
                <TabsTrigger value="session-health">Session Health</TabsTrigger>
                <TabsTrigger value="decision-history">Decision History</TabsTrigger>
              </TabsList>
              <TabsContent value="overview"><OverviewTab record={record} /></TabsContent>
              <TabsContent value="platform-history"><PlatformHistoryTab keywordId={record.id} /></TabsContent>
              <TabsContent value="session-health"><SessionHealthTab keywordId={record.id} /></TabsContent>
              <TabsContent value="decision-history"><DecisionHistoryTab record={record} /></TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
