import { useQuery } from "@tanstack/react-query";
import { rawFetch } from "./period-comparison";

/**
 * The distinct plan types the current session may filter by. The server scopes
 * this by role: owners get every plan type; every other role gets only the
 * local plans ("AEO SEO Local Plan"). Powers the plan-type filter dropdowns on
 * the Rankings and Sent Emails pages, so the options themselves respect the
 * same visibility rule as the data.
 */
export function usePlanTypes() {
  return useQuery<string[]>({
    queryKey: ["/api/aeo-plans/plan-types"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await rawFetch("/api/aeo-plans/plan-types");
      if (!res.ok) throw new Error("Failed to load plan types");
      const data = (await res.json()) as { planTypes?: string[] };
      return data.planTypes ?? [];
    },
  });
}
