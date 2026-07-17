import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import { rawFetch, fmtShortET } from "@/lib/period-comparison";
import { ordinal, placeText } from "@/lib/plain-language";

/** AI platforms drawn as separate lines, in a fixed order with hex colors that
 *  match the platform chips used elsewhere (emerald / blue / purple). */
const PLATFORM_LINES = [
  { key: "chatgpt", label: "ChatGPT", color: "#10b981" },
  { key: "gemini", label: "Gemini", color: "#3b82f6" },
  { key: "perplexity", label: "Perplexity", color: "#8b5cf6" },
] as const;

interface Report {
  platform: string | null;
  rankingPosition: number | null;
  date: string | null;
  createdAt: string | null;
}

interface ChartPoint {
  key: string;
  date: string;
  chatgpt?: number;
  gemini?: number;
  perplexity?: number;
}

/** Scope of the chart, used both to build the query and to label the card so a
 *  non-technical reader always knows which level they're looking at. */
export type RankTrendScope = "client" | "business" | "campaign";

const SCOPE_BADGE: Record<RankTrendScope, string> = {
  client: "This client",
  business: "This business",
  campaign: "This campaign",
};

const SCOPE_BLURB: Record<RankTrendScope, string> = {
  client: "averaged across all of this client's keywords",
  business: "averaged across this business's keywords",
  campaign: "averaged across this campaign's keywords",
};

interface ScopeIds {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

function useScopedReports(scope: ScopeIds) {
  const { clientId, businessId, aeoPlanId } = scope;
  const enabled = clientId != null || businessId != null || aeoPlanId != null;
  return useQuery({
    queryKey: ["rank-trend", clientId, businessId, aeoPlanId],
    enabled,
    queryFn: async (): Promise<Report[]> => {
      const params = new URLSearchParams({ status: "success", limit: "5000" });
      if (clientId != null) params.set("clientId", String(clientId));
      if (businessId != null) params.set("businessId", String(businessId));
      if (aeoPlanId != null) params.set("aeoPlanId", String(aeoPlanId));
      const res = await rawFetch(`/api/ranking-reports?${params}`);
      if (!res.ok) throw new Error(`ranking-reports ${res.status}`);
      const body = await res.json();
      return (body.data ?? body) as Report[];
    },
  });
}

/** Build one point per audit date, each carrying the AVERAGE rank per platform
 *  on that date (rounded). Averaging across the scope's keywords gives a single
 *  readable "how is this trending" line per platform instead of a tangle of
 *  per-keyword zig-zags. */
function buildChartData(reports: Report[]): ChartPoint[] {
  const byDate = new Map<string, Record<string, { sum: number; n: number }>>();
  for (const r of reports) {
    if (r.rankingPosition == null || r.rankingPosition < 1) continue;
    const raw = r.date ?? r.createdAt;
    if (!raw) continue;
    const key = raw.slice(0, 10);
    const plat = (r.platform ?? "").toLowerCase();
    if (plat !== "chatgpt" && plat !== "gemini" && plat !== "perplexity")
      continue;
    let sums = byDate.get(key);
    if (!sums) {
      sums = {};
      byDate.set(key, sums);
    }
    const acc = sums[plat] ?? { sum: 0, n: 0 };
    acc.sum += r.rankingPosition;
    acc.n += 1;
    sums[plat] = acc;
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, sums]) => {
      const pt: ChartPoint = { key, date: fmtShortET(key) };
      for (const { key: plat } of PLATFORM_LINES) {
        const acc = sums[plat];
        if (acc) pt[plat] = Math.round(acc.sum / acc.n);
      }
      return pt;
    });
}

interface Props {
  scope: RankTrendScope;
  clientId?: number | null;
  businessId?: number | null;
  aeoPlanId?: number | null;
}

/** "Ranking over time" line chart, designed to be understood at a glance: #1
 *  sits at the TOP of the chart (axis reversed) so a line climbing upward
 *  always means rankings are getting better. One line per AI platform. Works at
 *  client / business / campaign scope and labels itself so the reader always
 *  knows which level the data is for. */
export function RankTrendChart({
  scope,
  clientId = null,
  businessId = null,
  aeoPlanId = null,
}: Props) {
  const { data: reports, isLoading } = useScopedReports({
    clientId,
    businessId,
    aeoPlanId,
  });
  const chartData = useMemo(() => buildChartData(reports ?? []), [reports]);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap">
          <TrendingUp className="w-4 h-4 text-primary" />
          Ranking over time
          <Badge
            variant="outline"
            className="text-[10px] font-semibold text-primary border-primary/40 bg-primary/5"
          >
            {SCOPE_BADGE[scope]}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Higher is better —{" "}
          <span className="font-medium">#1 is the top spot</span>. Each line is
          an AI platform ({SCOPE_BLURB[scope]}); a line climbing upward means
          rankings are improving.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-10 text-center">
            Loading…
          </p>
        ) : chartData.length < 2 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">
            Not enough ranking history yet to chart — the trend appears once
            there are at least two audit dates.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  reversed
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  domain={[1, "auto"]}
                  tickFormatter={(v: number) => ordinal(v)}
                  label={{
                    value: "Position (1st = top answer)",
                    angle: -90,
                    position: "insideLeft",
                    style: {
                      fontSize: 11,
                      fill: "hsl(var(--muted-foreground))",
                    },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.375rem",
                    fontSize: "0.75rem",
                  }}
                  formatter={(value: number, name: string) => [
                    placeText(value),
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                {PLATFORM_LINES.map((p) => (
                  <Line
                    key={p.key}
                    type="monotone"
                    dataKey={p.key}
                    name={p.label}
                    stroke={p.color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
