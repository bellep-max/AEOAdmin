/**
 * Summary Report page. Reads the client from the route, lets the user pick a
 * scope (client / business / campaign) and a date (all-time or a single run),
 * then presents a fixed "hero" (client-facing Summary Overview + headline
 * metrics + overall/trend narrative) followed by the deep-dive sections behind
 * sticky tabs: Platforms, Movers, Won, Watch, Declines, How AEO works, Glossary.
 *
 * Tabs keep the summary in view instead of forcing a long scroll. Each tab's AI
 * narrative is folded into its own panel. Panels use forceMount so every section
 * stays in the DOM — an @media print rule (index.css) expands them all, so a
 * future "Export PDF" renders the whole report, not just the active tab.
 *
 * The four admin endpoints all take ?clientId=; empty AI narrative sections are
 * hidden and numbers are never invented — every figure comes from the payload.
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useGetClient } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { OverviewNarrative } from "@/components/summary/OverviewNarrative";
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

  // Build the tab set from what the payload actually has: data-bearing tabs are
  // only shown when non-empty; reference tabs (How it works, Glossary) are shown
  // when their content exists. Each entry carries the count badge and its panel.
  const tabs = useMemo(() => {
    if (!report) return [];
    const defs: {
      key: string;
      label: string;
      count?: number;
      node: React.ReactNode;
    }[] = [];

    if (report.platforms?.length)
      defs.push({
        key: "platforms",
        label: "Platforms",
        count: report.platforms.length,
        node: (
          <PlatformAggregates
            platforms={report.platforms}
            narrative={sections?.platforms}
            narrativeLoading={narrativeLoading}
          />
        ),
      });
    if (report.movers?.length)
      defs.push({
        key: "movers",
        label: "Movers",
        count: report.movers.length,
        node: (
          <MoversList
            movers={report.movers}
            narrative={sections?.movers}
            narrativeLoading={narrativeLoading}
          />
        ),
      });
    if (report.locked?.length)
      defs.push({
        key: "won",
        label: "Won",
        count: report.locked.length,
        node: (
          <LockedList
            locked={report.locked}
            narrative={sections?.locked}
            narrativeLoading={narrativeLoading}
          />
        ),
      });
    if (report.watch?.length)
      defs.push({
        key: "watch",
        label: "Watch",
        count: report.watch.length,
        node: <WatchList watch={report.watch} />,
      });
    if (report.declines?.length)
      defs.push({
        key: "declines",
        label: "Declines",
        count: report.declines.length,
        node: (
          <DeclinesList
            declines={report.declines}
            narrative={sections?.declines}
            narrativeLoading={narrativeLoading}
          />
        ),
      });
    if (narrative?.howAeoWorks?.length)
      defs.push({
        key: "how",
        label: "How it works",
        node: <HowAeoWorks steps={narrative.howAeoWorks} />,
      });
    if (glossary)
      defs.push({
        key: "glossary",
        label: "Glossary",
        node: <GlossaryPanel glossary={glossary} />,
      });

    return defs;
  }, [report, narrative, glossary, sections, narrativeLoading]);

  // Keep the active tab valid as the scope/date (and thus the tab set) changes.
  const [tab, setTab] = useState<string>("");
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((t) => t.key === tab)) setTab(tabs[0].key);
  }, [tabs, tab]);

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
          {/* ── Hero: always-visible summary ── */}
          <OverviewNarrative
            blocks={narrative?.overview ?? []}
            isLoading={narrativeLoading}
          />
          <MetricsCards
            metrics={report.metrics}
            narrative={sections?.overall}
            narrativeLoading={narrativeLoading}
          />

          {/* ── Deep-dive tabs ── */}
          {tabs.length > 0 && (
            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
              <TabsList className="report-tabs-list sticky top-0 z-20 flex h-auto w-full flex-wrap justify-start gap-1 bg-background/85 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                {tabs.map((t) => (
                  <TabsTrigger key={t.key} value={t.key} className="gap-2">
                    {t.label}
                    {t.count != null && (
                      <span className="rounded-full bg-muted px-1.5 text-xs font-bold text-muted-foreground data-[active]:bg-primary/15">
                        {t.count}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              {tabs.map((t) => (
                <TabsContent
                  key={t.key}
                  value={t.key}
                  forceMount
                  className="report-tab mt-0 focus-visible:outline-none data-[state=inactive]:hidden"
                >
                  {t.node}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
