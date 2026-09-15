export type Platform = "chatgpt" | "gemini" | "perplexity";

export type LockedKeywordStatus =
  | "healthy"
  | "monitor"
  | "unlock_recommended"
  | "unlock_now"
  | "insufficient_data";

export interface PlatformCheckSummary {
  platform: Platform;
  latestPosition: number | null;
  latestValidCheckAt: string | null;
  checkedInCycle: boolean;
}

export interface LockedKeywordRecord {
  id: number;
  clientId: number;
  clientName: string | null;
  businessId: number | null;
  businessName: string | null;
  city: string | null;
  state: string | null;
  aeoPlanId: number | null;
  campaignName: string | null;
  keywordText: string;
  lockedAt: string | null;
  maintenanceLevel: "minimum" | "recommended" | "custom";
  platformChecks: PlatformCheckSummary[];
  validChecks: number;
  topThreeChecks: number;
  absentChecks: number;
  totalChecksInCycle: number;
  consecutiveAbsentChecks: number;
  retentionRate: number | null;
  lastValidCheckAt: string | null;
  nextCheckDueAt: string | null;
  nextCheckDueNow: boolean;
  status: LockedKeywordStatus;
}

export interface LockedKeywordSummary {
  totalLocked: number;
  healthy: number;
  monitor: number;
  unlockRecommended: number;
  unlockNow: number;
  insufficientData: number;
}

export interface LockedKeywordListResponse {
  items: LockedKeywordRecord[];
  summary: LockedKeywordSummary;
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

export const STATUS_META: Record<
  LockedKeywordStatus,
  { label: string; tooltip: string }
> = {
  healthy: {
    label: "Healthy",
    tooltip: "Retaining a Top 1–3 result with sufficient maintenance checks.",
  },
  monitor: {
    label: "Monitor",
    tooltip: "Still locked, but retention is 50–69%, a check is overdue, or a platform hasn't been checked this cycle.",
  },
  unlock_recommended: {
    label: "Unlock Recommended",
    tooltip: "Retention has fallen below 50%. Consider returning this to active rotation.",
  },
  unlock_now: {
    label: "Unlock Now",
    tooltip: "Absent in two consecutive valid checks. Recommend unlocking immediately.",
  },
  insufficient_data: {
    label: "Insufficient Data",
    tooltip: "Not enough valid ranking data yet to make a lock/unlock decision.",
  },
};
