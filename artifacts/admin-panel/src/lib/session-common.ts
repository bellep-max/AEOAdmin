import { useQuery } from "@tanstack/react-query";
import { rawFetch } from "./period-comparison";

export interface ClientLite { id: number; businessName: string }
export interface BusinessLite { id: number; clientId: number; name: string }
export interface CampaignLite { id: number; clientId: number; businessId: number | null; name: string | null; planType: string }

export function useClients() {
  return useQuery<ClientLite[]>({
    queryKey: ["/api/clients/lite"],
    queryFn: async () => {
      const res = await rawFetch("/api/clients");
      if (!res.ok) throw new Error("Failed to load clients");
      return res.json();
    },
  });
}

export function useBusinesses(clientId: number | null) {
  return useQuery<BusinessLite[]>({
    queryKey: ["/api/businesses/lite", clientId],
    queryFn: async () => {
      const path = clientId != null ? `/api/businesses?clientId=${clientId}` : `/api/businesses`;
      const res = await rawFetch(path);
      if (!res.ok) throw new Error("Failed to load businesses");
      return res.json();
    },
    enabled: true,
  });
}

export function useCampaigns(clientId: number | null) {
  return useQuery<CampaignLite[]>({
    queryKey: ["/api/aeo-plans/lite", clientId],
    queryFn: async () => {
      const res = await rawFetch("/api/aeo-plans");
      if (!res.ok) throw new Error("Failed to load campaigns");
      const all = (await res.json()) as CampaignLite[];
      return clientId != null ? all.filter((c) => c.clientId === clientId) : all;
    },
  });
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { timeZone: "America/New_York" });
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${s}s`;
}

export function fmtBool(v: boolean | null | undefined): string {
  if (v == null) return "—";
  return v ? "Yes" : "No";
}

export function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "success": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "error":   return "bg-destructive/15 text-destructive";
    case "pending": return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    default:        return "bg-muted text-muted-foreground";
  }
}
