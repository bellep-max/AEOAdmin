/**
 * Always-visible business selector for the chatbot. Client + optional business,
 * both populated by the role-scoped /api/clients and /api/businesses endpoints
 * — a user only ever sees entities they're allowed to query. Switching the
 * selection rescopes the conversation (the parent clears the transcript).
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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await rawFetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

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

  const clientOptions = (clients ?? [])
    .map((c) => ({ value: String(c.id), label: c.businessName }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const businessOptions = (businesses ?? [])
    .map((b) => ({ value: String(b.id), label: b.name }))
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
    });
  };

  const handleBusiness = (value: string | null): void => {
    if (!scope) return;
    if (!value) {
      onChange({ ...scope, businessId: null, businessName: null });
      return;
    }
    const id = Number(value);
    const biz = (businesses ?? []).find((b) => b.id === id);
    onChange({
      ...scope,
      businessId: id,
      businessName: biz?.name ?? `Business ${id}`,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">
        Business:
      </span>
      <SearchableSelect
        value={scope ? String(scope.clientId) : null}
        onChange={handleClient}
        options={clientOptions}
        placeholder="Select a client…"
        allLabel="Clear"
        width="w-64"
      />
      <SearchableSelect
        value={scope?.businessId != null ? String(scope.businessId) : null}
        onChange={handleBusiness}
        options={businessOptions}
        placeholder="All businesses"
        allLabel="All businesses"
        disabled={!scope}
        width="w-56"
      />
      {scope ? (
        <span
          className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          data-testid="active-scope"
        >
          {scope.businessName
            ? `${scope.clientName} · ${scope.businessName}`
            : `${scope.clientName} · all businesses`}
        </span>
      ) : null}
    </div>
  );
}
