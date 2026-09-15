/**
 * Always-visible scope selector for the chatbot: client → business → campaign,
 * all cascading. Populated by the role-scoped /api/clients, /api/businesses, and
 * /api/aeo-plans endpoints — a user only sees entities they're allowed to query.
 * Switching any level rescopes the conversation (the parent clears the
 * transcript) and resets the deeper levels.
 *
 * /api/aeo-plans is viewer-tier only; for scoped roles (sales, etc.) it 403s and
 * the campaign dropdown simply stays empty — client/business scoping still works.
 */
import { useQuery } from "@tanstack/react-query";
import { SearchableSelect } from "@/components/SearchableSelect";
import { rawFetch } from "@/lib/period-comparison";
import type { ChatScope } from "@/lib/chatbot/types";

interface ClientRow {
  id: number;
  businessName: string;
}
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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await rawFetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

const campaignLabel = (p: PlanRow): string =>
  p.name ?? p.planType ?? `Campaign ${p.id}`;

export function ScopeBar({
  scope,
  onChange,
}: {
  scope: ChatScope | null;
  onChange: (scope: ChatScope | null) => void;
}) {
  const { data: clients } = useQuery<ClientRow[]>({
    queryKey: ["/api/clients", "chatbot"],
    queryFn: () => fetchJson<ClientRow[]>("/api/clients"),
  });

  const { data: businesses } = useQuery<BusinessRow[]>({
    queryKey: ["/api/businesses", scope?.clientId ?? null],
    queryFn: () =>
      fetchJson<BusinessRow[]>(`/api/businesses?clientId=${scope?.clientId}`),
    enabled: scope?.clientId != null,
  });

  const { data: plans } = useQuery<PlanRow[]>({
    queryKey: ["/api/aeo-plans", "chatbot"],
    // Tolerate 403 (scoped roles can't read plans) → no campaign options.
    queryFn: async () => {
      const res = await rawFetch("/api/aeo-plans");
      if (!res.ok) return [] as PlanRow[];
      return res.json() as Promise<PlanRow[]>;
    },
    enabled: scope?.clientId != null,
    retry: false,
  });

  const clientOptions = (clients ?? [])
    .map((c) => ({ value: String(c.id), label: c.businessName }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const businessOptions = (businesses ?? [])
    .map((b) => ({ value: String(b.id), label: b.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const campaignOptions = (plans ?? [])
    .filter(
      (p) =>
        (scope === null || p.clientId === scope.clientId) &&
        (scope?.businessId == null || p.businessId === scope.businessId),
    )
    .map((p) => ({ value: String(p.id), label: campaignLabel(p) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const handleClient = (value: string | null): void => {
    if (!value) {
      onChange(null);
      return;
    }
    const id = Number(value);
    const client = (clients ?? []).find((c) => c.id === id);
    onChange({
      clientId: id,
      clientName: client?.businessName ?? `Client ${id}`,
      businessId: null,
      businessName: null,
      aeoPlanId: null,
      campaignName: null,
    });
  };

  const handleBusiness = (value: string | null): void => {
    if (!scope) return;
    // Changing business always resets the campaign.
    if (!value) {
      onChange({
        ...scope,
        businessId: null,
        businessName: null,
        aeoPlanId: null,
        campaignName: null,
      });
      return;
    }
    const id = Number(value);
    const biz = (businesses ?? []).find((b) => b.id === id);
    onChange({
      ...scope,
      businessId: id,
      businessName: biz?.name ?? `Business ${id}`,
      aeoPlanId: null,
      campaignName: null,
    });
  };

  const handleCampaign = (value: string | null): void => {
    if (!scope) return;
    if (!value) {
      onChange({ ...scope, aeoPlanId: null, campaignName: null });
      return;
    }
    const id = Number(value);
    const plan = (plans ?? []).find((p) => p.id === id);
    onChange({
      ...scope,
      aeoPlanId: id,
      campaignName: plan ? campaignLabel(plan) : `Campaign ${id}`,
    });
  };

  const chip = scope
    ? [
        scope.clientName,
        scope.businessName ?? "all businesses",
        ...(scope.campaignName ? [scope.campaignName] : []),
      ].join(" · ")
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">Scope:</span>
      <SearchableSelect
        value={scope ? String(scope.clientId) : null}
        onChange={handleClient}
        options={clientOptions}
        placeholder="Select a client…"
        allLabel="Clear"
        width="w-60"
      />
      <SearchableSelect
        value={scope?.businessId != null ? String(scope.businessId) : null}
        onChange={handleBusiness}
        options={businessOptions}
        placeholder="All businesses"
        allLabel="All businesses"
        disabled={!scope}
        width="w-52"
      />
      <SearchableSelect
        value={scope?.aeoPlanId != null ? String(scope.aeoPlanId) : null}
        onChange={handleCampaign}
        options={campaignOptions}
        placeholder="All campaigns"
        allLabel="All campaigns"
        disabled={!scope || campaignOptions.length === 0}
        width="w-52"
      />
      {chip ? (
        <span
          className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          data-testid="active-scope"
        >
          {chip}
        </span>
      ) : null}
    </div>
  );
}
