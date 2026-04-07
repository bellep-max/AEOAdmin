export interface PlanMeta {
  name: string;
  tier: string;
  /** Tailwind classes for the coloured pill/badge */
  badgeClass: string;
  /** Tailwind classes for the tier pill (same palette, same colour) */
  tierClass: string;
}

export const PLAN_META: PlanMeta[] = [
  {
    name: "The AEO Suite",
    tier: "Enterprise",
    badgeClass: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700",
    tierClass:  "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700",
  },
  {
    name: "Agency Solutions",
    tier: "Agency",
    badgeClass: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
    tierClass:  "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
  },
  {
    name: "Performance Tiers",
    tier: "Scalable",
    badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700",
    tierClass:  "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700",
  },
  {
    name: "Growth Bundles",
    tier: "Growth",
    badgeClass: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
    tierClass:  "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
  },
  {
    name: "Optimization Tracks",
    tier: "Professional",
    badgeClass: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
    tierClass:  "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  },
  {
    name: "Success Roadmaps",
    tier: "Starter",
    badgeClass: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-700",
    tierClass:  "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-700",
  },
];

/** Look up meta for any planType string; falls back to a neutral grey */
export function getPlanMeta(planType: string): PlanMeta {
  return (
    PLAN_META.find((p) => p.name === planType) ?? {
      name: planType,
      tier: "—",
      badgeClass: "bg-muted text-muted-foreground border-border",
      tierClass:  "bg-muted text-muted-foreground border-border",
    }
  );
}

export const PLAN_NAMES = PLAN_META.map((p) => p.name);
