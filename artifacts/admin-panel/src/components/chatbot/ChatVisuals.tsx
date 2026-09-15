/**
 * Visuals for a chatbot answer. EVERY value shown here is read directly from
 * the `Dataset` the data layer fetched — nothing is computed by or passed
 * through the LLM. This is what structurally guarantees a chart or card can
 * never display a number that isn't in the source data.
 */
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import type { Dataset, RankingRow } from "@/lib/chatbot/types";

const PLATFORM_COLORS: Record<string, string> = {
  chatgpt: "hsl(142,71%,47%)",
  gemini: "hsl(217,91%,62%)",
  perplexity: "hsl(43,96%,58%)",
};
const platformColor = (p: string): string =>
  PLATFORM_COLORS[p] ?? "hsl(215,16%,55%)";

function KpiCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "amber" | "blue";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-500"
      : tone === "amber"
        ? "text-amber-500"
        : tone === "blue"
          ? "text-blue-500"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function CoverageNote({ dataset }: { dataset: Dataset }) {
  const { earliest, latest, rowCount, platforms } = dataset.coverage;
  if (!earliest && !latest && rowCount === 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {rowCount.toLocaleString()} data point{rowCount === 1 ? "" : "s"}
      {earliest && latest ? ` · ${earliest} → ${latest}` : ""}
      {platforms.length ? ` · ${platforms.join(", ")}` : ""}
    </p>
  );
}

/** Pivot series rows into one point per date with a column per platform. */
function pivotSeries(series: RankingRow[]): {
  data: Record<string, number | string | null>[];
  platforms: string[];
} {
  const platforms = [...new Set(series.map((r) => r.platform))].sort();
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const r of series) {
    const point = byDate.get(r.date) ?? { date: r.date };
    point[r.platform] = r.rankingPosition;
    byDate.set(r.date, point);
  }
  const data = [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  return { data, platforms };
}

function TrendChart({ dataset }: { dataset: Dataset }) {
  if (!dataset.series || dataset.series.length === 0) return null;
  const { data, platforms } = pivotSeries(dataset.series);
  const keyword = dataset.series[0]?.keyword;
  return (
    <div>
      {keyword ? (
        <div className="mb-1 text-sm font-medium">
          Ranking trend — {keyword}
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          {/* Reversed: lower position (#1) is better, so it sits at the top. */}
          <YAxis reversed allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          {platforms.map((p) => (
            <Line
              key={p}
              type="monotone"
              dataKey={p}
              name={p}
              stroke={platformColor(p)}
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PlatformComparison({ dataset }: { dataset: Dataset }) {
  if (!dataset.platformStats || dataset.platformStats.length === 0) return null;
  const data = dataset.platformStats
    .filter((p) => p.avgPosition !== null)
    .map((p) => ({
      platform: p.platform,
      avg: p.avgPosition as number,
      top3: p.topThreeCount,
    }));
  if (data.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-sm font-medium">
        Average position by platform (lower is better)
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="platform" tick={{ fontSize: 12 }} />
          <YAxis reversed allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="avg" name="avg position" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.platform} fill={platformColor(d.platform)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MoversChart({ dataset }: { dataset: Dataset }) {
  if (!dataset.movers || dataset.movers.length === 0) return null;
  const data = dataset.movers.slice(0, 8).map((m, i) => ({
    id: `${m.keywordId}-${i}`,
    name: m.keywordText,
    change: m.change ?? 0,
  }));
  return (
    <div>
      <div className="mb-1 text-sm font-medium">
        Biggest movers (positions gained, since first tracked)
      </div>
      <ResponsiveContainer
        width="100%"
        height={Math.max(160, data.length * 28)}
      >
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            tick={{ fontSize: 11 }}
          />
          <Tooltip />
          <Bar dataKey="change" name="positions gained" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell
                key={d.id}
                fill={d.change >= 0 ? "hsl(142,71%,45%)" : "hsl(0,72%,55%)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SummaryCards({ dataset }: { dataset: Dataset }) {
  const s = dataset.summary;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard label="Keyword × platform" value={String(s.totalKeywords)} />
      <KpiCard
        label="In top 3"
        value={String(s.topThreeCount)}
        tone="emerald"
      />
      <KpiCard
        label="Improved"
        value={String(s.improvedCount)}
        tone="emerald"
      />
      <KpiCard label="Declined" value={String(s.declinedCount)} tone="amber" />
      <KpiCard
        label="Avg position"
        value={
          s.avgCurrentPosition === null ? "—" : String(s.avgCurrentPosition)
        }
        tone="blue"
      />
    </div>
  );
}

function KeywordTable({ dataset }: { dataset: Dataset }) {
  if (!dataset.keywordList || dataset.keywordList.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-sm font-medium">
        Tracked keywords ({dataset.keywordList.length})
      </div>
      <div className="max-h-72 overflow-auto rounded-lg border border-border/50">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Keyword</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {dataset.keywordList.map((k) => (
              <tr key={k.keywordId} className="border-t border-border/40">
                <td className="px-3 py-1.5">{k.keywordText}</td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {k.status}
                </td>
                <td className="px-3 py-1.5">{k.isActive ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Render whichever visuals the dataset supports. Order is intent-appropriate
 *  because the data layer only populates the relevant fields. */
export function ChatVisuals({ dataset }: { dataset: Dataset }) {
  if (dataset.isEmpty) return null;
  return (
    <div className="mt-2 space-y-3" data-testid="chat-visuals">
      <SummaryCards dataset={dataset} />
      <TrendChart dataset={dataset} />
      <PlatformComparison dataset={dataset} />
      <MoversChart dataset={dataset} />
      <KeywordTable dataset={dataset} />
      <CoverageNote dataset={dataset} />
    </div>
  );
}
