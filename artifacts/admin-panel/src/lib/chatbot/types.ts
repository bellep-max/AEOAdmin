/**
 * Shared types for the Chatbot page.
 *
 * The pipeline is: user message → intent routing (LLM, JSON) → clarification
 * (if ambiguous) → deterministic data fetch from real endpoints → visuals built
 * by code from that data → narrative (LLM, streaming) → guardrail validation.
 *
 * Every number/date the user sees is either rendered by code from `Dataset`
 * (visuals) or validated against `Dataset` (narrative). The LLM never invents
 * figures — it only classifies intent and writes prose over data we fetched.
 */

/** The three AI platforms this product tracks. Always lowercase server-side. */
export type Platform = "chatgpt" | "gemini" | "perplexity";

export const PLATFORMS: readonly Platform[] = [
  "chatgpt",
  "gemini",
  "perplexity",
] as const;

/** Active client/business the conversation is scoped to. */
export interface ChatScope {
  clientId: number;
  clientName: string;
  /** null = all businesses for the client. */
  businessId: number | null;
  businessName: string | null;
}

/** Relative time windows the router may resolve. Resolved to real dates by the
 *  data layer against the dataset's actual coverage — never fabricated. */
export type TimeframeToken =
  | "all"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "last_90d"
  | "this_month"
  | "last_month";

export interface TimeframeSpec {
  token: TimeframeToken | "custom";
  /** YYYY-MM-DD when token === "custom". */
  from?: string;
  to?: string;
}

/** What kind of analytical answer the user is asking for. */
export type IntentKind =
  | "business_summary"
  | "rank_trend"
  | "platform_comparison"
  | "keyword_list"
  | "top_movers"
  | "unsupported"
  | "smalltalk";

export interface IntentParams {
  timeframe?: TimeframeSpec;
  platform?: Platform | null;
  /** Free-text keyword the user referenced, if any. */
  keyword?: string | null;
}

/** Interactive clarification surfaced when intent is ambiguous. The user picks
 *  one option (or a date range) and the turn re-runs with resolved params. */
export interface Clarification {
  kind: "timeframe" | "metric" | "entity" | "platform";
  /** Human prompt shown above the selector. */
  question: string;
  /** Choices for chip/entity selectors. Omitted for a raw date-range picker. */
  options?: { value: string; label: string }[];
}

export interface Intent {
  kind: IntentKind;
  params: IntentParams;
  /** 0..1 model confidence in the classification. */
  confidence: number;
  needsClarification: boolean;
  clarification?: Clarification;
  /** Set when kind === "unsupported": why the data can't answer it. */
  unsupportedReason?: string;
  /** Short restatement of what the model understood, for transparency. */
  echo?: string;
}

/** One real ranking observation (from /api/ranking-reports). */
export interface RankingRow {
  keywordId: number;
  keyword: string;
  platform: string;
  date: string; // YYYY-MM-DD (ET calendar day)
  rankingPosition: number | null; // null = not found / not ranked
  status: string; // "success" | "error"
  /** Proxy search location. Distinct locations are distinct sessions, so this
   *  participates in combo grouping — a keyword's trend at one location isn't
   *  conflated with another's. */
  searchAddress: string | null;
}

/** Per-keyword initial→current comparison (from aeo-summary). */
export interface KeywordSummaryRow {
  keywordId: number;
  keywordText: string;
  initialDate: string | null;
  initialPosition: number | null;
  currentDate: string | null;
  currentPosition: number | null;
  /** initialPosition - currentPosition. Positive = moved up (improved). */
  change: number | null;
}

/** Actual date/row coverage of the fetched data — surfaced in every answer so
 *  the user knows exactly what the numbers are drawn from. */
export interface DataCoverage {
  earliest: string | null;
  latest: string | null;
  rowCount: number;
  platforms: string[];
}

export interface PlatformStat {
  platform: string;
  avgPosition: number | null;
  count: number;
  topThreeCount: number;
}

export interface SummaryBlock {
  keywords: KeywordSummaryRow[];
  totalKeywords: number;
  topThreeCount: number;
  improvedCount: number;
  declinedCount: number;
  steadyCount: number;
  avgCurrentPosition: number | null;
}

/** The single source of truth for a turn's visuals AND the narrative guardrail
 *  allowlist. If a value isn't derivable from here, it cannot be shown. */
export interface Dataset {
  intentKind: IntentKind;
  scope: ChatScope;
  coverage: DataCoverage;
  summary?: SummaryBlock;
  series?: RankingRow[];
  platformStats?: PlatformStat[];
  keywordList?: {
    keywordId: number;
    keywordText: string;
    isActive: boolean;
    status: string;
  }[];
  movers?: KeywordSummaryRow[];
  isEmpty: boolean;
}

export interface GuardrailViolation {
  value: string;
  kind: "number" | "date";
}

export interface GuardrailResult {
  ok: boolean;
  violations: GuardrailViolation[];
  /** How many distinct figures were checked. */
  checkedCount: number;
}

/** A rendered turn in the transcript. */
export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  /** User text, or assistant narrative (may stream in). */
  text: string;
  /** Assistant-only: the data the visuals + guardrail are built from. */
  dataset?: Dataset;
  /** Assistant-only: unverified figures flagged by the guardrail. */
  guardrail?: GuardrailResult;
  /** Assistant-only: a clarification request instead of an answer. */
  clarification?: Clarification;
  /** Assistant-only: intent echo for transparency. */
  intent?: Intent;
  status: "streaming" | "done" | "error" | "awaiting-clarification";
  error?: string;
}
