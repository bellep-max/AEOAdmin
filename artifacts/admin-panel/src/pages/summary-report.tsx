/**
 * Summary Report page. Reads the client from the route, lets the user pick a
 * scope (client / business / campaign) and a date (all-time or a single run),
 * then renders the metrics, AI narrative, platform, movers, locked, watch, and
 * declines sections plus a static "How AEO works" and a collapsible glossary.
 *
 * The four admin endpoints all take ?clientId=; empty AI narrative sections are
 * hidden and numbers are never invented — every figure comes from the payload.
 */
import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { useGetClient } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, FileText } from "lucide-react";
import {
  useAvailableDates,
  useGlossary,
  useSummaryNarrative,
  useSummaryReport,
} from "@/lib/summary-report";
import {
  ScopeSelector,
  type ScopeState,
} from "@/components/summary/ScopeSelector";
import { DateCalendar } from "@/components/summary/DateCalendar";
import { MetricsCards } from "@/components/summary/MetricsCards";
import { NarrativeBlock } from "@/components/summary/NarrativeBlock";
import { PlatformAggregates } from "@/components/summary/PlatformAggregates";
import { MoversList } from "@/components/summary/MoversList";
import { LockedList } from "@/components/summary/LockedList";
import { WatchList } from "@/components/summary/WatchList";
import { DeclinesList } from "@/components/summary/DeclinesList";
import { HowAeoWorks } from "@/components/summary/HowAeoWorks";
import { GlossaryPanel } from "@/components/summary/GlossaryPanel";

export default function SummaryReport() {
  const [, params] = useRoute("/clients/:id/summary-report");
  const clientId = Number(params?.id);

  const [scope, setScope] = useState<ScopeState>({
    scope: "client",
    businessId: null,
    aeoPlanId: null,
  });
  const [date, setDate] = useState<string | null>(null);

  const { data: client } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: ["getClient", clientId] },
  });

  const scopeParams = {
    clientId,
    scope: scope.scope,
    businessId: scope.businessId,
    aeoPlanId: scope.aeoPlanId,
  };

  const { data: dates } = useAvailableDates(scopeParams);

  // Default to the latest available run, and — when the scope changes — fall
  // back to the latest if the currently-picked date has no data for the new
  // scope. Dates arrive newest-first from the endpoint.
  useEffect(() => {
    const list = dates?.dates;
    if (!list || list.length === 0) return;
    const stillAvailable = date != null && list.some((d) => d.date === date);
    if (!stillAvailable) setDate(list[0].date);
  }, [dates, date]);

  const { data: report, isLoading: reportLoading } = useSummaryReport({
    ...scopeParams,
    date,
  });
  const { data: narrative, isLoading: narrativeLoading } = useSummaryNarrative({
    ...scopeParams,
    date,
  });
  const { data: glossary } = useGlossary();

  const sections = narrative?.sections;

  return (
    <div className="space-y-6">
      {/* ── Breadcrumb + heading ── */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={`/clients/${clientId}`}
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {client?.businessName ?? "Client"}
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Summary Report</h1>
        {client?.businessName && (
          <span className="text-sm text-muted-foreground">
            · {client.businessName}
          </span>
        )}
      </div>

      {/* ── Controls ── */}
      <Card className="border-border/50">
        <CardContent className="flex flex-wrap items-center gap-4 py-3">
          <ScopeSelector
            clientId={clientId}
            value={scope}
            onChange={setScope}
          />
          <DateCalendar
            dates={dates?.dates ?? []}
            value={date}
            onChange={setDate}
          />
        </CardContent>
      </Card>

      {reportLoading || !report ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* 1 · Metrics */}
          <MetricsCards metrics={report.metrics} />

          {/* 2 · Narrative: overall + trend */}
          <div className="space-y-2">
            <NarrativeBlock
              text={sections?.overall}
              isLoading={narrativeLoading}
            />
            <NarrativeBlock
              text={sections?.trend}
              isLoading={narrativeLoading}
            />
          </div>

          {/* 3 · Platform aggregates */}
          <PlatformAggregates platforms={report.platforms} />

          {/* 4 · Movers + narrative */}
          <MoversList movers={report.movers} />
          <NarrativeBlock
            text={sections?.movers}
            isLoading={narrativeLoading}
          />

          {/* 5 · Locked + narrative */}
          <LockedList locked={report.locked} />
          <NarrativeBlock
            text={sections?.locked}
            isLoading={narrativeLoading}
          />

          {/* 6 · Watch */}
          <WatchList watch={report.watch} />

          {/* 7 · Declines + narrative */}
          <DeclinesList declines={report.declines} />
          <NarrativeBlock
            text={sections?.declines}
            isLoading={narrativeLoading}
          />

          {/* 8 · How AEO works */}
          {narrative && <HowAeoWorks steps={narrative.howAeoWorks} />}

          {/* 9 · Glossary (collapsible) */}
          {glossary && <GlossaryPanel glossary={glossary} />}
        </>
      )}
    </div>
  );
}
