import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";

type MomentumStatus =
  | "needs_attention"
  | "review_recommended"
  | "on_track"
  | "ramping_up";

interface BusinessMomentum {
  businessId: number;
  businessName: string | null;
  clientId: number;
  clientName: string | null;
  activeCampaigns: number;
  losingMomentum: number;
  status: MomentumStatus;
}

interface MomentumSummary {
  counts: Record<MomentumStatus, number>;
  businesses: BusinessMomentum[];
}

/* Status colours follow the flagging spec: red = needs attention, orange =
   review, green = on track, blue = ramping up. (This is the internal ops
   dashboard — unlike the client-facing reports, red is wanted here.) */
const STATUS_META: Record<
  MomentumStatus,
  { label: string; cls: string; hint: string }
> = {
  needs_attention: {
    label: "Needs attention",
    cls: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
    hint: "Half or more of its campaigns stalled for two checks in a row",
  },
  review_recommended: {
    label: "Review recommended",
    cls: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
    hint: "At least one campaign stalled, but under half of them",
  },
  on_track: {
    label: "On track",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    hint: "Every campaign is still making progress",
  },
  ramping_up: {
    label: "Ramping up",
    cls: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    hint: "Too new to judge — needs three rounds of checks first",
  },
};

const ORDER: MomentumStatus[] = [
  "needs_attention",
  "review_recommended",
  "on_track",
  "ramping_up",
];

const MAX_LISTED = 5;

/** Plain-English read of the portfolio, so the numbers mean something without
 *  hovering a tooltip or knowing the rule. */
function buildNarrative(
  counts: Record<MomentumStatus, number>,
  total: number,
): string {
  const n = (s: MomentumStatus) => counts[s] ?? 0;
  const biz = (c: number) => `${c} business${c === 1 ? "" : "es"}`;

  const lead =
    n("needs_attention") > 0
      ? `${biz(n("needs_attention"))} need${n("needs_attention") === 1 ? "s" : ""} a look now — half or more of their campaigns have stalled for two checks running.`
      : `Nothing needs attention right now — no business has half or more of its campaigns stalled.`;

  const rest: string[] = [];
  if (n("review_recommended") > 0)
    rest.push(
      `${biz(n("review_recommended"))} worth a review (some campaigns stalled, but under half)`,
    );
  if (n("on_track") > 0) rest.push(`${n("on_track")} on track`);
  if (n("ramping_up") > 0)
    rest.push(
      `${n("ramping_up")} still ramping up — too new to judge, they need three rounds of checks first`,
    );

  const tail = rest.length ? ` Of the rest: ${rest.join(", ")}.` : "";
  return `${lead}${tail} ${total} business${total === 1 ? "" : "es"} have audit history.`;
}

/** Business-level momentum flag for the dashboard. A business is flagged when
 *  its growth cycle stalls across campaigns — never because one keyword moved.
 *  Shows the whole portfolio (all four states), leading with what needs a human. */
export function NeedsAttentionCard() {
  const { data, isLoading, isError, error } = useQuery<MomentumSummary>({
    queryKey: ["/api/businesses/momentum"],
    queryFn: async () => {
      const res = await rawFetch("/api/businesses/momentum");
      if (!res.ok) throw new Error(`momentum ${res.status}`);
      return res.json();
    },
  });

  const flagged = (data?.businesses ?? []).filter(
    (b) => b.status === "needs_attention",
  );
  const total = ORDER.reduce((n, s) => n + (data?.counts?.[s] ?? 0), 0);

  return (
    <Card className="border-border/50 card-hover">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base">Needs attention</CardTitle>
        </div>
        <CardDescription className="mt-0.5 text-xs">
          Businesses whose growth cycle has stalled — no keyword reaching the
          top 3 and most keywords flat or slipping, two audits running.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : isError ? (
          /* Never let a failed request masquerade as "no data" — say it broke. */
          <p className="py-6 text-center text-sm text-muted-foreground">
            Couldn&rsquo;t load momentum
            {error instanceof Error ? ` (${error.message})` : ""}. This needs the
            latest API deployed.
          </p>
        ) : total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No businesses with audit history yet.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-foreground">
              {buildNarrative(data!.counts, total)}
            </p>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {ORDER.map((s) => {
                const m = STATUS_META[s];
                return (
                  <div key={s} className={`rounded-lg border p-3 ${m.cls}`}>
                    <p className="text-2xl font-bold tabular-nums leading-none">
                      {data?.counts?.[s] ?? 0}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold leading-tight">
                      {m.label}
                    </p>
                    {/* Spelled out, not a tooltip — nobody hovers a tile. */}
                    <p className="mt-1 text-[10px] leading-snug opacity-80">
                      {m.hint}
                    </p>
                  </div>
                );
              })}
            </div>

            {flagged.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border/40">
                {flagged.slice(0, MAX_LISTED).map((b) => (
                  <Link
                    key={b.businessId}
                    href={`/clients/${b.clientId}/businesses/${b.businessId}`}
                    className="flex items-center gap-3 border-b border-border/40 px-3 py-2 last:border-b-0 hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {b.businessName ?? `Business ${b.businessId}`}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {b.losingMomentum} of {b.activeCampaigns} campaign
                      {b.activeCampaigns === 1 ? "" : "s"} stalled
                    </span>
                  </Link>
                ))}
                {flagged.length > MAX_LISTED && (
                  <p className="px-3 py-1.5 text-[11px] text-muted-foreground">
                    +{flagged.length - MAX_LISTED} more
                  </p>
                )}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">
                How this is decided:
              </span>{" "}
              a campaign counts as stalled when no keyword reached the top 3 and
              most of its keywords were flat or slipping — and that happened two
              bi-weekly checks in a row. One bad round is normal; two is a
              pattern. A business is flagged when half or more of its campaigns
              are stalled.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
