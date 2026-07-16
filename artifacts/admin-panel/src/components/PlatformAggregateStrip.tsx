import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendingUp, TrendingDown, Minus, Trophy, Info } from "lucide-react";
import { AIExplain } from "@/components/AIExplain";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  usePeriodComparison,
  aggregatePlatforms,
  periodLabel,
  PLATFORM_COLORS,
  type Period,
} from "@/lib/period-comparison";
import { ordinal, movementText } from "@/lib/plain-language";

/** Proper display names — CSS `capitalize` would render "Chatgpt". */
const PLATFORM_NAMES: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
};
const platformName = (p: string) => PLATFORM_NAMES[p] ?? p;

interface Props {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  title?: string;
  /** When true, renders its own period dropdown. When false, uses `period` prop and stays silent. */
  standalone?: boolean;
  period?: Period;
  /** Scope display name — enables the AI "what this means" blurb under the strip. */
  scopeName?: string | null;
}

export function PlatformAggregateStrip({
  clientId,
  businessId,
  aeoPlanId,
  title = "Overall ranking by platform",
  standalone = true,
  period: externalPeriod,
  scopeName,
}: Props) {
  const [internalPeriod, setInternalPeriod] = useState<Period>("weekly");
  const period = standalone ? internalPeriod : (externalPeriod ?? "weekly");

  const { data, isLoading } = usePeriodComparison({
    period,
    clientId,
    businessId,
    aeoPlanId,
  });
  const label = periodLabel(period);
  const aggregates = useMemo(
    () => aggregatePlatforms(data?.rows ?? []),
    [data],
  );

  return (
    <Card className="border-border/50">
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">{title}</h3>
            <span className="text-xs text-muted-foreground">
              · {label.long}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="How the average is calculated"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                <strong>Your average spot on this platform right now.</strong>{" "}
                We take where each of your keywords currently ranks and average
                them — keywords that aren&rsquo;t ranking yet don&rsquo;t count.
                Lower is better (#1 is the top).
              </TooltipContent>
            </Tooltip>
          </div>
          {standalone && (
            <Select
              value={internalPeriod}
              onValueChange={(v) => setInternalPeriod(v as Period)}
            >
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Biweekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="lifetime">Since start</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <p className="text-sm leading-relaxed text-foreground mb-3">
          This is your typical spot in the AI answers on each assistant. 1st
          place is the very top answer, so a smaller number is better.
        </p>

        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Loading…
          </p>
        ) : aggregates.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No ranking data yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {aggregates.map((a) => {
              const cls =
                PLATFORM_COLORS[a.platform] ??
                "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
              const change = a.change;
              return (
                <div
                  key={a.platform}
                  className="rounded-lg border border-border/50 bg-muted/20 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls}`}
                    >
                      {platformName(a.platform)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {a.keywordCount} phrase{a.keywordCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-2xl font-bold">
                      {a.avgCurrent != null ? ordinal(a.avgCurrent) : "—"}
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      average position
                    </span>
                  </div>
                  {change != null && (
                    <p
                      className={`text-xs font-semibold mt-1 inline-flex items-center gap-1 ${
                        change > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : change < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {change > 0 ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : change < 0 ? (
                        <TrendingDown className="w-3 h-3" />
                      ) : (
                        <Minus className="w-3 h-3" />
                      )}
                      {change === 0
                        ? "No change from 2 weeks ago"
                        : `${movementText(change)} vs 2 weeks ago`}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Two weeks ago:{" "}
                    {a.avgPrevious != null ? ordinal(a.avgPrevious) : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    When we started:{" "}
                    {a.avgFirst != null ? ordinal(a.avgFirst) : "—"}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-[10px]">
                    <span className="text-muted-foreground">
                      <strong className="text-foreground">{a.topRank}</strong> of{" "}
                      {a.keywordCount} in the top {a.topRankThreshold} answers
                    </span>
                    {a.improved > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {a.improved} improved
                      </span>
                    )}
                    {a.declined > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        {a.declined} slipped
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <AIExplain
          section="platforms"
          name={scopeName}
          clientId={clientId}
          businessId={businessId}
          aeoPlanId={aeoPlanId}
        />
      </CardContent>
    </Card>
  );
}
