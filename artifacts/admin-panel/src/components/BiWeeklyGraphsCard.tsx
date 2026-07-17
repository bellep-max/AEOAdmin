import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import {
  rawFetch,
  fmtDayET,
  fmtShortET,
  platformLabel,
} from "@/lib/period-comparison";

/* Colours deliberately avoid red — a client reads red as "something is broken".
   Green = good, yellow = slipped, grey = neutral / no data. */
const GOOD = "#10b981";
const NEUTRAL = "#94a3b8";
const SLIPPED = "#eab308";
const FAINT = "#cbd5e1";
const MID = "#3b82f6";
const FAR = "#f59e0b";

interface Bucket {
  count: number;
  pct: number;
}

/** The slice of /api/ranking-reports/bi-weekly-report this card charts. */
interface BiWeeklyReportShape {
  currentBatch: {
    batchDate: string;
    nextDueDate: string;
    uniqueBusinesses: number;
    newCombos: number;
  } | null;
  rankingTrend: {
    eligibleCombos: number;
    improved: number;
    declined: number;
    noChange: number;
    notRanked: number;
  } | null;
  initialRanking: {
    totalNewCombos: number;
    buckets: {
      top3: Bucket;
      top4to10: Bucket;
      top11to30: Bucket;
      beyond30: Bucket;
      notRanked: Bucket;
    };
  } | null;
  clientMatrix?: Array<{
    client_id: number;
    batches: Array<{ date: string; in_top3: number; total: number }>;
  }>;
  details?: {
    platformTrend: Array<{
      platform: string;
      total: number;
      improved: number;
      declined: number;
      no_change: number;
      not_ranked: number;
    }>;
  };
}

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
} as const;

function Panel({
  title,
  caption,
  children,
  height,
}: {
  title: string;
  caption: string;
  children: React.ReactElement;
  height: number;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{caption}</p>
      <div className="mt-2 w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

interface Row {
  name: string;
  value: number;
  color: string;
}

/** Which level the card is rendered at — drives the wording only; the endpoint
 *  scopes itself off whichever id is passed. */
export type BiWeeklyScope = "client" | "business" | "campaign";

const SCOPE_BLURB: Record<BiWeeklyScope, string> = {
  client: "across all of this client's businesses",
  business: "for this business",
  campaign: "for this campaign",
};

interface Props {
  scope: BiWeeklyScope;
  clientId?: number | null;
  businessId?: number | null;
  aeoPlanId?: number | null;
}

/** Bi-weekly report drawn as plain-language graphs — the same numbers the
 *  report table shows, answering the questions a client actually asks: did my
 *  phrases move, how is each AI doing, and are more of them reaching the top 3
 *  over time. Works at client / business / campaign scope. */
export function BiWeeklyGraphsCard({
  scope,
  clientId = null,
  businessId = null,
  aeoPlanId = null,
}: Props) {
  const params = new URLSearchParams();
  if (clientId != null) params.set("clientId", String(clientId));
  if (businessId != null) params.set("businessId", String(businessId));
  if (aeoPlanId != null) params.set("aeoPlanId", String(aeoPlanId));
  const qs = params.toString();

  const { data, isLoading } = useQuery<BiWeeklyReportShape>({
    enabled: qs.length > 0,
    queryKey: ["/api/ranking-reports/bi-weekly-report", "graphs", qs],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/ranking-reports/bi-weekly-report?${qs}`,
      );
      if (!res.ok) throw new Error(`bi-weekly-report ${res.status}`);
      return res.json();
    },
  });

  const trend = data?.rankingTrend;
  const buckets = data?.initialRanking?.buckets;
  const platforms = data?.details?.platformTrend ?? [];
  // Client scope → the matrix has this client's row; its batches carry the
  // top-3 count at each check, which is the clearest "are we winning" trend.
  const batches = [...(data?.clientMatrix?.[0]?.batches ?? [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const movedRows: Row[] = trend
    ? [
        { name: "Moved up", value: trend.improved, color: GOOD },
        { name: "Stayed the same", value: trend.noChange, color: NEUTRAL },
        { name: "Slipped", value: trend.declined, color: SLIPPED },
        { name: "Not ranking yet", value: trend.notRanked, color: FAINT },
      ]
    : [];

  const placeRows: Row[] = buckets
    ? [
        { name: "In the top 3", value: buckets.top3.count, color: GOOD },
        { name: "4th – 10th", value: buckets.top4to10.count, color: MID },
        { name: "11th – 30th", value: buckets.top11to30.count, color: FAR },
        { name: "Past 30th", value: buckets.beyond30.count, color: NEUTRAL },
        {
          name: "Not ranking yet",
          value: buckets.notRanked.count,
          color: FAINT,
        },
      ]
    : [];

  const platformRows = platforms.map((p) => ({
    name: platformLabel(p.platform),
    "Moved up": p.improved,
    "Stayed the same": p.no_change,
    Slipped: p.declined,
    "Not ranking yet": p.not_ranked,
  }));

  const topTrendRows = batches.map((b) => ({
    date: fmtShortET(b.date),
    inTop3: b.in_top3,
  }));

  const hasMoved = movedRows.some((r) => r.value > 0);
  const hasPlace = placeRows.some((r) => r.value > 0);
  const hasPlatforms = platformRows.length > 0;
  const hasTopTrend = topTrendRows.length >= 2;

  const latestTop3 = batches.length
    ? batches[batches.length - 1].in_top3
    : null;
  const latestTotal = batches.length ? batches[batches.length - 1].total : null;

  const nothing = !hasMoved && !hasPlace && !hasPlatforms && !hasTopTrend;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" />
          Every-two-weeks report
          {data?.currentBatch?.batchDate && (
            <span className="font-normal text-muted-foreground">
              · latest check {fmtDayET(data.currentBatch.batchDate)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : nothing ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No two-week check yet — the graphs appear after the first round of
            checks.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-foreground">
              We check every phrase again about every two weeks. This is what
              happened {SCOPE_BLURB[scope]} in the latest round.
            </p>

            <div
              className={`grid grid-cols-2 gap-3 ${scope === "client" ? "md:grid-cols-4" : "md:grid-cols-3"}`}
            >
              <Stat
                label="Phrases checked"
                value={String(trend?.eligibleCombos ?? latestTotal ?? 0)}
                sub="in the latest round"
              />
              <Stat
                label="In the top 3 now"
                value={latestTop3 != null ? String(latestTop3) : "—"}
                sub={
                  latestTop3 != null && latestTotal
                    ? `${Math.round((latestTop3 / latestTotal) * 100)}% of what we checked`
                    : undefined
                }
              />
              {/* Only meaningful when the scope actually spans businesses. */}
              {scope === "client" && (
                <Stat
                  label="Businesses covered"
                  value={String(data?.currentBatch?.uniqueBusinesses ?? 0)}
                  sub="under this client"
                />
              )}
              <Stat
                label="Next check due"
                value={
                  data?.currentBatch?.nextDueDate
                    ? fmtShortET(data.currentBatch.nextDueDate)
                    : "—"
                }
                sub="about every 2 weeks"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {hasMoved && (
                <Panel
                  title="How your phrases moved"
                  caption={`Compared with the check before, across ${trend!.eligibleCombos} phrase${trend!.eligibleCombos === 1 ? "" : "s"}.`}
                  height={Math.max(140, movedRows.length * 34 + 20)}
                >
                  <BarChart
                    data={movedRows}
                    layout="vertical"
                    margin={{ top: 4, right: 28, bottom: 4, left: 4 }}
                  >
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={112}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v: number) => [
                        `${v} phrase${v === 1 ? "" : "s"}`,
                        "",
                      ]}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
                      {movedRows.map((r) => (
                        <Cell key={r.name} fill={r.color} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="right"
                        style={{
                          fontSize: 11,
                          fill: "hsl(var(--foreground))",
                        }}
                      />
                    </Bar>
                  </BarChart>
                </Panel>
              )}

              {hasPlatforms && (
                <Panel
                  title="How each AI moved"
                  caption="The same phrases, split by AI assistant — so you can see which one is pulling ahead."
                  height={Math.max(140, platformRows.length * 44 + 40)}
                >
                  <BarChart
                    data={platformRows}
                    layout="vertical"
                    margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
                  >
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={112}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Legend wrapperStyle={{ fontSize: "0.65rem" }} />
                    <Bar
                      dataKey="Moved up"
                      stackId="a"
                      fill={GOOD}
                      barSize={18}
                    />
                    <Bar
                      dataKey="Stayed the same"
                      stackId="a"
                      fill={NEUTRAL}
                      barSize={18}
                    />
                    <Bar
                      dataKey="Slipped"
                      stackId="a"
                      fill={SLIPPED}
                      barSize={18}
                    />
                    <Bar
                      dataKey="Not ranking yet"
                      stackId="a"
                      fill={FAINT}
                      barSize={18}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </Panel>
              )}
            </div>

            {hasTopTrend && (
              <Panel
                title="Phrases reaching the top 3 over time"
                caption="Each point is one round of checks. Higher is better — it means more of your phrases are showing up in the top 3 answers."
                height={200}
              >
                <LineChart
                  data={topTrendRows}
                  margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => [
                      `${v} phrase${v === 1 ? "" : "s"} in the top 3`,
                      "",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="inTop3"
                    name="In the top 3"
                    stroke={GOOD}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </Panel>
            )}

            {hasPlace && (
              <Panel
                title="Where new phrases landed"
                caption={`The first result for ${data!.initialRanking!.totalNewCombos} newly added phrase${data!.initialRanking!.totalNewCombos === 1 ? "" : "s"}. 1st place is the top answer.`}
                height={Math.max(140, placeRows.length * 34 + 20)}
              >
                <BarChart
                  data={placeRows}
                  layout="vertical"
                  margin={{ top: 4, right: 28, bottom: 4, left: 4 }}
                >
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={112}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => [
                      `${v} phrase${v === 1 ? "" : "s"}`,
                      "",
                    ]}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
                    {placeRows.map((r) => (
                      <Cell key={r.name} fill={r.color} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      style={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
                    />
                  </Bar>
                </BarChart>
              </Panel>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
