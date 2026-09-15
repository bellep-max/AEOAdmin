import { useQuery } from "@tanstack/react-query";
import { rawFetch } from "@/lib/period-comparison";

/* Momentum labels for detail pages — the same states the dashboard's
   Needs-attention card shows, resolved per business or per campaign from
   GET /api/businesses/momentum (shared react-query cache with the card). */

export type MomentumStatus =
  | "needs_attention"
  | "review_recommended"
  | "on_track"
  | "ramping_up";

type CampaignMomentumStatus = "stalled" | "progressing" | "ramping_up";

interface MomentumSummary {
  counts: Record<MomentumStatus, number>;
  businesses: Array<{
    businessId: number;
    clientId: number;
    status: MomentumStatus;
  }>;
  campaigns: Array<{ campaignId: number; status: CampaignMomentumStatus }>;
}

const BUSINESS_META: Record<MomentumStatus, { label: string; cls: string }> = {
  needs_attention: {
    label: "Needs attention",
    cls: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  review_recommended: {
    label: "Review recommended",
    cls: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  },
  on_track: {
    label: "On track",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  ramping_up: {
    label: "Ramping up",
    cls: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
};

const CAMPAIGN_META: Record<
  CampaignMomentumStatus,
  { label: string; cls: string }
> = {
  stalled: {
    label: "Stalled",
    cls: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  progressing: {
    label: "Making progress",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  ramping_up: {
    label: "Ramping up",
    cls: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
};

/** Momentum-filter dropdown options, shared by the Clients/Businesses pages. */
export const MOMENTUM_FILTER_OPTIONS: Array<{
  value: MomentumStatus;
  label: string;
}> = [
  { value: "needs_attention", label: "Needs attention" },
  { value: "review_recommended", label: "Review recommended" },
  { value: "on_track", label: "On track" },
  { value: "ramping_up", label: "Ramping up" },
];

export function useMomentum() {
  return useQuery<MomentumSummary>({
    queryKey: ["/api/businesses/momentum"],
    queryFn: async () => {
      const res = await rawFetch("/api/businesses/momentum");
      if (!res.ok) throw new Error(`momentum ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

/** Business-level momentum label. Renders nothing while loading, on error, or
 *  when the business has no audit history yet. */
export function BusinessMomentumBadge({ businessId }: { businessId: number }) {
  const { data } = useMomentum();
  const status = data?.businesses?.find(
    (b) => b.businessId === businessId,
  )?.status;
  if (!status) return null;
  const m = BUSINESS_META[status];
  return <Pill label={m.label} cls={m.cls} />;
}

/** Campaign-level momentum label (Stalled / Making progress / Ramping up). */
export function CampaignMomentumBadge({ campaignId }: { campaignId: number }) {
  const { data } = useMomentum();
  const status = data?.campaigns?.find(
    (c) => c.campaignId === campaignId,
  )?.status;
  if (!status) return null;
  const m = CAMPAIGN_META[status];
  return <Pill label={m.label} cls={m.cls} />;
}
