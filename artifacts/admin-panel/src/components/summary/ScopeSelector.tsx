/**
 * Scope selector for the Summary Report: Client (all) / Business / Campaign.
 * Client is fixed by the route; the business and campaign selects appear as the
 * scope narrows and are populated from the same /api/businesses and
 * /api/aeo-plans endpoints the rest of the client detail surface uses.
 */
import { useQuery } from "@tanstack/react-query";
import { SearchableSelect } from "@/components/SearchableSelect";
import { rawFetch } from "@/lib/period-comparison";
import type { SummaryScope } from "@/lib/summary-report";

interface BusinessRow {
  id: number;
  clientId: number;
  name: string;
}
interface PlanRow {
  id: number;
  clientId: number;
  businessId: number | null;
  name: string | null;
  planType: string | null;
}

export interface ScopeState {
  scope: SummaryScope;
  businessId: number | null;
  aeoPlanId: number | null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await rawFetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

const campaignLabel = (p: PlanRow): string =>
  p.name ?? p.planType ?? `Campaign ${p.id}`;

export function ScopeSelector({
  clientId,
  value,
  onChange,
}: {
  clientId: number;
  value: ScopeState;
  onChange: (next: ScopeState) => void;
}) {
  const { data: businesses } = useQuery<BusinessRow[]>({
    queryKey: ["/api/businesses", clientId, "summary"],
    queryFn: () =>
      fetchJson<BusinessRow[]>(`/api/businesses?clientId=${clientId}`),
    enabled: !!clientId,
  });

  const { data: plans } = useQuery<PlanRow[]>({
    queryKey: ["/api/aeo-plans", "summary"],
    // Tolerate 403 (scoped roles can't read plans) → no campaign options.
    queryFn: async () => {
      const res = await rawFetch("/api/aeo-plans");
      if (!res.ok) return [] as PlanRow[];
      return res.json() as Promise<PlanRow[]>;
    },
    enabled: !!clientId,
    retry: false,
  });

  const businessOptions = (businesses ?? [])
    .map((b) => ({ value: String(b.id), label: b.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const campaignOptions = (plans ?? [])
    .filter(
      (p) =>
        p.clientId === clientId &&
        (value.businessId == null || p.businessId === value.businessId),
    )
    .map((p) => ({ value: String(p.id), label: campaignLabel(p) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const handleBusiness = (v: string | null): void => {
    if (!v) {
      onChange({ scope: "client", businessId: null, aeoPlanId: null });
      return;
    }
    // Changing business always resets the campaign.
    onChange({ scope: "business", businessId: Number(v), aeoPlanId: null });
  };

  const handleCampaign = (v: string | null): void => {
    if (!v) {
      onChange({
        scope: value.businessId != null ? "business" : "client",
        businessId: value.businessId,
        aeoPlanId: null,
      });
      return;
    }
    const id = Number(v);
    const plan = (plans ?? []).find((p) => p.id === id);
    onChange({
      scope: "campaign",
      // A campaign implies its business — infer it if not already set.
      businessId: value.businessId ?? plan?.businessId ?? null,
      aeoPlanId: id,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">Scope:</span>
      <SearchableSelect
        value={value.businessId != null ? String(value.businessId) : null}
        onChange={handleBusiness}
        options={businessOptions}
        placeholder="All businesses (client)"
        allLabel="All businesses (client)"
        width="w-56"
      />
      <SearchableSelect
        value={value.aeoPlanId != null ? String(value.aeoPlanId) : null}
        onChange={handleCampaign}
        options={campaignOptions}
        placeholder="All campaigns"
        allLabel="All campaigns"
        disabled={campaignOptions.length === 0}
        width="w-52"
      />
    </div>
  );
}
