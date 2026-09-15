/** Metrics summary strip: tracked, in top 3, improved, slipped, steady, and
 *  average position now vs. at first measure. Lower position is better. Each
 *  stat carries a plain-language caption so a client can read the number and
 *  understand what it means without asking. */
import { Card, CardContent } from "@/components/ui/card";
import type { SummaryMetrics } from "@/lib/summary-report";
import { ordinal } from "@/lib/plain-language";

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "emerald" | "blue" | "amber";
}) {
  const valueCls =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "blue"
        ? "text-blue-600 dark:text-blue-400"
        : tone === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueCls}`}>
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {sub}
        </p>
      )}
    </div>
  );
}

export function MetricsCards({
  metrics,
  narrative,
  narrativeLoading,
}: {
  metrics: SummaryMetrics;
  narrative?: string;
  narrativeLoading?: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Phrases we track"
            value={String(metrics.tracked)}
            sub="Search phrases we monitor for you across the three AIs"
          />
          <Stat
            label="In the top 3"
            value={String(metrics.top3)}
            tone="emerald"
            sub="Named among the AI's first 3 picks — the spots people notice"
          />
          <Stat
            label="Moved up"
            value={String(metrics.improved)}
            tone="emerald"
            sub="Climbed since the last check"
          />
          <Stat
            label="Slipped"
            value={String(metrics.declined)}
            tone="amber"
            sub="Eased down a little since the last check — normal, and worked on"
          />
          <Stat
            label="No change"
            value={String(metrics.steady)}
            sub="Held the same spot as last time"
          />
          <Stat
            label="Average position"
            value={
              metrics.avgCurrent != null ? ordinal(metrics.avgCurrent) : "—"
            }
            tone="blue"
            sub={
              metrics.avgFirst != null
                ? `Started around ${ordinal(metrics.avgFirst)}. 1st is the top answer, so a smaller number is better.`
                : "1st is the top answer, so a smaller number is better."
            }
          />
        </div>

        {/* How you're doing — client-specific, written fresh each period. */}
        {narrative?.trim() ? (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {narrative.trim()}
          </p>
        ) : narrativeLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Writing…</p>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            We track the phrases your customers ask ChatGPT, Gemini, and
            Perplexity, and whether the AI names your business. Landing in the{" "}
            <strong className="font-semibold text-foreground">top 3</strong> is
            what matters most — that&rsquo;s usually all the AI reads out, so
            it&rsquo;s what gets you seen and chosen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
