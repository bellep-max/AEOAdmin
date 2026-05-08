/**
 * Daily analyst — Phase 1 data layer.
 *
 * Assembles 7 datasets the LLM analyst will read from. No LLM work here.
 * Source spec: aeo-appium/docs/AEO_ANALYST_SPEC.md.
 *
 * Notes vs spec:
 * - Sessions store status as 'success'/'error' (not 'pass'/'fail'/'error').
 *   Aggregations report `passes` for 'success' rows and roll 'fail' into 'errors'.
 * - businesses uses publishedAddress for the GMB address (no `address` column).
 */
import { db } from "@workspace/db";
import { dailyReportsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { chatCompletion } from "./llm-client";
import { formatAuditContext } from "./llm-analyst-formatter";
import { AUDIT_ANALYST_SYSTEM_PROMPT } from "./prompts/audit-analyst";

export interface AnalystScope {
  clientId?: number;
  businessId?: number;
  campaignId?: number;
}

export interface SessionSummaryRow {
  keyword_id: number;
  keyword: string | null;
  business: string | null;
  campaign: string | null;
  platform: string | null;
  runs: number;
  passes: number;
  fails: number;
  errors: number;
  avg_duration_s: string | null;
  backlinks_injected: number;
  backlinks_found: number;
  backlink_inject_pct: string | null;
}

export interface RankChangeRow {
  keyword_id: number;
  keyword: string | null;
  business: string | null;
  platform: string | null;
  current_rank: number | null;
  current_date: string | null;
  prev_rank: number | null;
  prev_date: string | null;
  delta_position: number | null;
  movement: "improved" | "declined" | "flat" | "gained_ranking" | "lost_ranking" | "not_ranked";
}

export interface RankHistoryRow {
  keyword_id: number;
  keyword: string | null;
  business: string | null;
  platform: string | null;
  rank_date: string;
  rank: number;
}

export interface SimilarityRow {
  business_id: number;
  keyword_a_id: number;
  keyword_a: string;
  keyword_b_id: number;
  keyword_b: string;
  sim: string;
}

export interface TimeOfDayRow {
  hour_utc: number;
  platform: string | null;
  runs: number;
}

export interface PlatformSkewRow {
  date: string;
  platform: string | null;
  runs: number;
}

export interface GmbMismatchRow {
  keyword_id: number;
  keyword: string | null;
  business: string | null;
  gmb_address: string | null;
  search_address: string | null;
  gmb_match: "match" | "mismatch" | "no_search_addr" | "no_gmb_addr";
}

/** Per (keyword × platform) session activity in the audit lookback window. */
export interface WindowActivityRow {
  keyword_id: number;
  keyword: string | null;
  business: string | null;
  platform: string | null;
  sessions_in_window: number;
  pass_pct: string | null;
  backlink_inject_pct: string | null;
  backlink_found_pct: string | null;
  distinct_variants: number;
  hour_stddev: string | null;       // null if <2 sessions in window
  distinct_errors: number;
}

/** Aggregated session-activity metrics per movement bucket. Improver vs decliner cohort. */
export interface MovementCohortRow {
  movement: "improved" | "declined" | "flat" | "gained_ranking" | "lost_ranking" | "not_ranked";
  keyword_count: number;
  total_sessions: number;
  avg_backlink_inject_pct: string | null;
  avg_pass_pct: string | null;
  avg_hour_stddev: string | null;
}

export interface AnalystContext {
  reportDate: string;
  scope: AnalystScope;
  lookbackDays: number;
  sessionSummary: SessionSummaryRow[];
  rankChanges: RankChangeRow[];
  rankHistory: RankHistoryRow[];
  similarityFlags: SimilarityRow[];
  timeOfDay: TimeOfDayRow[];
  platformSkew: PlatformSkewRow[];
  gmbMismatches: GmbMismatchRow[];
  windowActivity: WindowActivityRow[];
  movementCohort: MovementCohortRow[];
  inputSummary: {
    sessionCount: number;
    declineCount: number;
    improvementCount: number;
    similarPairs: number;
    gmbMismatches: number;
    windowSessionCount: number;
  };
}

function scopeParams(scope: AnalystScope) {
  return {
    clientId: scope.clientId ?? null,
    businessId: scope.businessId ?? null,
    campaignId: scope.campaignId ?? null,
  };
}

async function runSessionSummary(reportDate: string, scope: AnalystScope): Promise<SessionSummaryRow[]> {
  const { clientId, businessId, campaignId } = scopeParams(scope);
  const result = await db.execute(sql`
    SELECT
      k.id                                              AS keyword_id,
      k.keyword_text                                    AS keyword,
      s.biz_name                                        AS business,
      s.campaign_name                                   AS campaign,
      LOWER(s.ai_platform)                              AS platform,
      COUNT(*)::int                                     AS runs,
      SUM(CASE WHEN s.status = 'success' THEN 1 ELSE 0 END)::int AS passes,
      SUM(CASE WHEN s.status = 'fail'    THEN 1 ELSE 0 END)::int AS fails,
      SUM(CASE WHEN s.status = 'error'   THEN 1 ELSE 0 END)::int AS errors,
      ROUND(AVG(s.duration_seconds)::numeric, 1)        AS avg_duration_s,
      SUM(CASE WHEN s.backlink_injected THEN 1 ELSE 0 END)::int AS backlinks_injected,
      SUM(CASE WHEN s.backlink_found    THEN 1 ELSE 0 END)::int AS backlinks_found,
      ROUND(
        100.0 * SUM(CASE WHEN s.backlink_injected THEN 1 ELSE 0 END)
              / NULLIF(COUNT(*), 0),
        1
      ) AS backlink_inject_pct
    FROM sessions s
    JOIN keywords k ON k.id = s.keyword_id
    WHERE s.date = ${reportDate}
      AND (${clientId}::int IS NULL OR s.client_id = ${clientId}::int)
      AND (${businessId}::int IS NULL OR s.business_id = ${businessId}::int)
      AND (${campaignId}::int IS NULL OR s.campaign_id = ${campaignId}::int)
    GROUP BY k.id, k.keyword_text, s.biz_name, s.campaign_name, LOWER(s.ai_platform)
    ORDER BY business, keyword, platform
  `);
  return result.rows as unknown as SessionSummaryRow[];
}

async function runRankChanges(reportDate: string, scope: AnalystScope): Promise<RankChangeRow[]> {
  const { clientId, businessId } = scopeParams(scope);
  // Ranking semantics:
  //   - Positions > 50 are treated as "not in top 50" (NULL).
  //   - Sentinel values like 150000 and bot-detection junk like 1242, 8400 are
  //     all collapsed into the same "not_ranked" bucket so deltas stay meaningful.
  //   - movement = 'lost_ranking' when previously ranked but now off the list,
  //                'gained_ranking' when newly on the list,
  //                'improved' / 'declined' / 'flat' for in-list moves.
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        rr.keyword_id,
        LOWER(rr.platform) AS platform,
        rr.biz_name,
        rr.keyword,
        CASE WHEN rr.ranking_position BETWEEN 1 AND 50 THEN rr.ranking_position ELSE NULL END
          AS rank_capped,
        rr.ranking_position AS rank_raw,
        rr.date::date AS rank_date,
        ROW_NUMBER() OVER (
          PARTITION BY rr.keyword_id, LOWER(rr.platform)
          ORDER BY rr.date::date DESC, rr.timestamp DESC
        ) AS rn
      FROM ranking_reports rr
      WHERE rr.ranking_position IS NOT NULL
        AND rr.date::date <= ${reportDate}::date
        AND (${clientId}::int IS NULL OR rr.client_id = ${clientId}::int)
        AND (${businessId}::int IS NULL OR rr.business_id = ${businessId}::int)
    )
    SELECT
      curr.keyword_id,
      curr.keyword,
      curr.biz_name AS business,
      curr.platform,
      curr.rank_capped      AS current_rank,
      curr.rank_date::text  AS current_date,
      prev.rank_capped      AS prev_rank,
      prev.rank_date::text  AS prev_date,
      (curr.rank_capped - prev.rank_capped) AS delta_position,
      CASE
        WHEN prev.rank_capped IS NULL AND curr.rank_capped IS NULL THEN 'not_ranked'
        WHEN prev.rank_capped IS NULL AND curr.rank_capped IS NOT NULL THEN 'gained_ranking'
        WHEN prev.rank_capped IS NOT NULL AND curr.rank_capped IS NULL THEN 'lost_ranking'
        WHEN curr.rank_capped < prev.rank_capped THEN 'improved'
        WHEN curr.rank_capped > prev.rank_capped THEN 'declined'
        ELSE 'flat'
      END AS movement
    FROM ranked curr
    LEFT JOIN ranked prev
      ON prev.keyword_id = curr.keyword_id
     AND prev.platform   = curr.platform
     AND prev.rn         = 2
    WHERE curr.rn = 1
    ORDER BY ABS(COALESCE(curr.rank_capped - prev.rank_capped, 0)) DESC
  `);
  return result.rows as unknown as RankChangeRow[];
}

async function runRankHistory(reportDate: string, scope: AnalystScope): Promise<RankHistoryRow[]> {
  const { clientId, businessId } = scopeParams(scope);
  // Only include in-top-50 positions; sentinel values like 150000 are filtered out
  // so the trajectory the LLM sees reflects real ranking changes, not noise.
  const result = await db.execute(sql`
    SELECT
      rr.keyword_id,
      rr.keyword,
      rr.biz_name AS business,
      LOWER(rr.platform) AS platform,
      rr.date::date::text AS rank_date,
      MIN(rr.ranking_position)::int AS rank
    FROM ranking_reports rr
    WHERE rr.ranking_position BETWEEN 1 AND 50
      AND rr.date::date >= (${reportDate}::date - INTERVAL '30 days')
      AND rr.date::date <= ${reportDate}::date
      AND (${clientId}::int IS NULL OR rr.client_id = ${clientId}::int)
      AND (${businessId}::int IS NULL OR rr.business_id = ${businessId}::int)
    GROUP BY rr.keyword_id, rr.keyword, rr.biz_name, LOWER(rr.platform), rr.date::date
    ORDER BY rr.biz_name, rr.keyword, platform, rank_date
  `);
  return result.rows as unknown as RankHistoryRow[];
}

async function runSimilarityFlags(scope: AnalystScope): Promise<SimilarityRow[]> {
  const { clientId, businessId } = scopeParams(scope);
  const result = await db.execute(sql`
    SELECT
      a.business_id,
      a.id           AS keyword_a_id,
      a.keyword_text AS keyword_a,
      b.id           AS keyword_b_id,
      b.keyword_text AS keyword_b,
      ROUND(similarity(a.keyword_text, b.keyword_text)::numeric, 3) AS sim
    FROM keywords a
    JOIN keywords b
      ON a.business_id = b.business_id
     AND a.id < b.id
    WHERE a.is_active AND b.is_active
      AND similarity(a.keyword_text, b.keyword_text) > 0.6
      AND (${clientId}::int IS NULL OR a.client_id = ${clientId}::int)
      AND (${businessId}::int IS NULL OR a.business_id = ${businessId}::int)
    ORDER BY sim DESC
  `);
  return result.rows as unknown as SimilarityRow[];
}

async function runTimeOfDay(reportDate: string, scope: AnalystScope): Promise<TimeOfDayRow[]> {
  const { clientId, businessId, campaignId } = scopeParams(scope);
  const result = await db.execute(sql`
    SELECT
      EXTRACT(HOUR FROM s.timestamp)::int AS hour_utc,
      LOWER(s.ai_platform) AS platform,
      COUNT(*)::int AS runs
    FROM sessions s
    WHERE s.date = ${reportDate}
      AND (${clientId}::int IS NULL OR s.client_id = ${clientId}::int)
      AND (${businessId}::int IS NULL OR s.business_id = ${businessId}::int)
      AND (${campaignId}::int IS NULL OR s.campaign_id = ${campaignId}::int)
    GROUP BY hour_utc, LOWER(s.ai_platform)
    ORDER BY hour_utc, platform
  `);
  return result.rows as unknown as TimeOfDayRow[];
}

async function runPlatformSkew(reportDate: string, scope: AnalystScope): Promise<PlatformSkewRow[]> {
  const { clientId, businessId, campaignId } = scopeParams(scope);
  const result = await db.execute(sql`
    SELECT
      s.date::text AS date,
      LOWER(s.ai_platform) AS platform,
      COUNT(*)::int AS runs
    FROM sessions s
    WHERE s.date >= (${reportDate}::date - INTERVAL '7 days')
      AND s.date <= ${reportDate}::date
      AND (${clientId}::int IS NULL OR s.client_id = ${clientId}::int)
      AND (${businessId}::int IS NULL OR s.business_id = ${businessId}::int)
      AND (${campaignId}::int IS NULL OR s.campaign_id = ${campaignId}::int)
    GROUP BY s.date, LOWER(s.ai_platform)
    ORDER BY s.date, platform
  `);
  return result.rows as unknown as PlatformSkewRow[];
}

async function runGmbMismatches(scope: AnalystScope): Promise<GmbMismatchRow[]> {
  const { clientId, businessId } = scopeParams(scope);
  const result = await db.execute(sql`
    SELECT
      k.id                AS keyword_id,
      k.keyword_text      AS keyword,
      b.name              AS business,
      b.published_address AS gmb_address,
      cap.search_address  AS search_address,
      CASE
        WHEN b.published_address IS NULL OR TRIM(b.published_address) = '' THEN 'no_gmb_addr'
        WHEN cap.search_address  IS NULL OR TRIM(cap.search_address)  = '' THEN 'no_search_addr'
        WHEN LOWER(TRIM(b.published_address)) = LOWER(TRIM(cap.search_address)) THEN 'match'
        ELSE 'mismatch'
      END AS gmb_match
    FROM keywords k
    JOIN businesses b              ON b.id  = k.business_id
    LEFT JOIN client_aeo_plans cap ON cap.id = k.aeo_plan_id
    WHERE k.is_active
      AND (${clientId}::int IS NULL OR k.client_id = ${clientId}::int)
      AND (${businessId}::int IS NULL OR k.business_id = ${businessId}::int)
  `);
  return result.rows as unknown as GmbMismatchRow[];
}

/**
 * Per-keyword session activity in the audit-window lookback (default 14 days).
 * Lets the LLM correlate session behavior with rank movement on the same key.
 * Joined to rankChanges by (keyword_id, platform) at prompt-render time.
 */
async function runWindowActivity(
  reportDate: string,
  scope: AnalystScope,
  lookbackDays: number,
): Promise<WindowActivityRow[]> {
  const { clientId, businessId, campaignId } = scopeParams(scope);
  const result = await db.execute(sql`
    SELECT
      s.keyword_id,
      k.keyword_text                     AS keyword,
      s.biz_name                         AS business,
      LOWER(s.ai_platform)               AS platform,
      COUNT(*)::int                      AS sessions_in_window,
      ROUND(
        100.0 * SUM(CASE WHEN s.status = 'success' THEN 1 ELSE 0 END)
              / NULLIF(COUNT(*), 0),
        1
      ) AS pass_pct,
      ROUND(
        100.0 * SUM(CASE WHEN s.backlink_injected THEN 1 ELSE 0 END)
              / NULLIF(COUNT(*), 0),
        1
      ) AS backlink_inject_pct,
      ROUND(
        100.0 * SUM(CASE WHEN s.backlink_found THEN 1 ELSE 0 END)
              / NULLIF(COUNT(*), 0),
        1
      ) AS backlink_found_pct,
      COUNT(DISTINCT s.keyword_variant)::int AS distinct_variants,
      ROUND(STDDEV(EXTRACT(HOUR FROM s.timestamp))::numeric, 1) AS hour_stddev,
      COUNT(DISTINCT s.error_class)::int AS distinct_errors
    FROM sessions s
    LEFT JOIN keywords k ON k.id = s.keyword_id
    WHERE s.date >= (${reportDate}::date - (${lookbackDays}::int * INTERVAL '1 day'))
      AND s.date <= ${reportDate}::date
      AND s.keyword_id IS NOT NULL
      AND (${clientId}::int   IS NULL OR s.client_id   = ${clientId}::int)
      AND (${businessId}::int IS NULL OR s.business_id = ${businessId}::int)
      AND (${campaignId}::int IS NULL OR s.campaign_id = ${campaignId}::int)
    GROUP BY s.keyword_id, k.keyword_text, s.biz_name, LOWER(s.ai_platform)
    HAVING COUNT(*) > 0
    ORDER BY business, keyword, platform
  `);
  return result.rows as unknown as WindowActivityRow[];
}

/**
 * Cohort comparison: for each movement bucket, average session-activity metrics
 * across all keywords in that bucket. Lets the LLM say things like
 * "decliners ran with 28% backlink rate vs improvers at 60%."
 */
async function runMovementCohort(
  reportDate: string,
  scope: AnalystScope,
  lookbackDays: number,
): Promise<MovementCohortRow[]> {
  const { clientId, businessId, campaignId } = scopeParams(scope);
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        rr.keyword_id,
        LOWER(rr.platform) AS platform,
        CASE WHEN rr.ranking_position BETWEEN 1 AND 50 THEN rr.ranking_position ELSE NULL END
          AS rank_capped,
        ROW_NUMBER() OVER (
          PARTITION BY rr.keyword_id, LOWER(rr.platform)
          ORDER BY rr.date::date DESC, rr.timestamp DESC
        ) AS rn
      FROM ranking_reports rr
      WHERE rr.ranking_position IS NOT NULL
        AND rr.date::date <= ${reportDate}::date
        AND (${clientId}::int   IS NULL OR rr.client_id   = ${clientId}::int)
        AND (${businessId}::int IS NULL OR rr.business_id = ${businessId}::int)
    ),
    movements AS (
      SELECT
        curr.keyword_id,
        curr.platform,
        CASE
          WHEN prev.rank_capped IS NULL AND curr.rank_capped IS NULL THEN 'not_ranked'
          WHEN prev.rank_capped IS NULL AND curr.rank_capped IS NOT NULL THEN 'gained_ranking'
          WHEN prev.rank_capped IS NOT NULL AND curr.rank_capped IS NULL THEN 'lost_ranking'
          WHEN curr.rank_capped < prev.rank_capped THEN 'improved'
          WHEN curr.rank_capped > prev.rank_capped THEN 'declined'
          ELSE 'flat'
        END AS movement
      FROM ranked curr
      LEFT JOIN ranked prev
        ON prev.keyword_id = curr.keyword_id
       AND prev.platform   = curr.platform
       AND prev.rn         = 2
      WHERE curr.rn = 1
    ),
    activity AS (
      SELECT
        s.keyword_id,
        LOWER(s.ai_platform) AS platform,
        COUNT(*)::int AS sessions,
        100.0 * SUM(CASE WHEN s.backlink_injected THEN 1 ELSE 0 END)
              / NULLIF(COUNT(*), 0) AS bl_pct,
        100.0 * SUM(CASE WHEN s.status = 'success' THEN 1 ELSE 0 END)
              / NULLIF(COUNT(*), 0) AS pass_pct,
        STDDEV(EXTRACT(HOUR FROM s.timestamp)) AS hour_sd
      FROM sessions s
      WHERE s.date >= (${reportDate}::date - (${lookbackDays}::int * INTERVAL '1 day'))
        AND s.date <= ${reportDate}::date
        AND s.keyword_id IS NOT NULL
        AND (${clientId}::int   IS NULL OR s.client_id   = ${clientId}::int)
        AND (${businessId}::int IS NULL OR s.business_id = ${businessId}::int)
        AND (${campaignId}::int IS NULL OR s.campaign_id = ${campaignId}::int)
      GROUP BY s.keyword_id, LOWER(s.ai_platform)
    )
    SELECT
      m.movement,
      COUNT(*)::int                                    AS keyword_count,
      COALESCE(SUM(a.sessions), 0)::int                AS total_sessions,
      ROUND(AVG(a.bl_pct)::numeric, 1)                 AS avg_backlink_inject_pct,
      ROUND(AVG(a.pass_pct)::numeric, 1)               AS avg_pass_pct,
      ROUND(AVG(a.hour_sd)::numeric, 1)                AS avg_hour_stddev
    FROM movements m
    LEFT JOIN activity a
      ON a.keyword_id = m.keyword_id
     AND a.platform   = m.platform
    GROUP BY m.movement
    ORDER BY m.movement
  `);
  return result.rows as unknown as MovementCohortRow[];
}

/**
 * Default audit-window lookback. Audits run every 14 days, so 14 is the
 * natural window for "what happened between audits." Override via
 * GET /api/analytics/...?lookbackDays=N when iterating.
 */
const DEFAULT_LOOKBACK_DAYS = 14;

export async function assembleContext(
  reportDate: string,
  scope: AnalystScope = {},
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): Promise<AnalystContext> {
  const [
    sessionSummary,
    rankChanges,
    rankHistory,
    similarityFlags,
    timeOfDay,
    platformSkew,
    gmbMismatches,
    windowActivity,
    movementCohort,
  ] = await Promise.all([
    runSessionSummary(reportDate, scope),
    runRankChanges(reportDate, scope),
    runRankHistory(reportDate, scope),
    runSimilarityFlags(scope),
    runTimeOfDay(reportDate, scope),
    runPlatformSkew(reportDate, scope),
    runGmbMismatches(scope),
    runWindowActivity(reportDate, scope, lookbackDays),
    runMovementCohort(reportDate, scope, lookbackDays),
  ]);

  return {
    reportDate,
    scope,
    lookbackDays,
    sessionSummary,
    rankChanges,
    rankHistory,
    similarityFlags,
    timeOfDay,
    platformSkew,
    gmbMismatches,
    windowActivity,
    movementCohort,
    inputSummary: {
      sessionCount:       sessionSummary.reduce((acc, r) => acc + Number(r.runs ?? 0), 0),
      declineCount:       rankChanges.filter((r) => r.movement === "declined").length,
      improvementCount:   rankChanges.filter((r) => r.movement === "improved").length,
      similarPairs:       similarityFlags.length,
      gmbMismatches:      gmbMismatches.filter((r) => r.gmb_match === "mismatch").length,
      windowSessionCount: windowActivity.reduce((acc, r) => acc + Number(r.sessions_in_window ?? 0), 0),
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
   Phase 2 — LLM analyst orchestration
   ════════════════════════════════════════════════════════════════════════ */

export interface AuditReportRecommendation {
  keyword_id: number;
  platform: string;
  movement: string;
  action: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  evidence: string;
}

export interface AuditReportResult {
  id: number;
  reportDate: string;
  scope: string;
  scopeId: number | null;
  modelUsed: string;
  reportMarkdown: string;
  recommendations: AuditReportRecommendation[];
  inputSummary: AnalystContext["inputSummary"];
  generatedAt: Date;
  durationMs: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
}

const SECTION_SEPARATOR = "---RECS---";

function describeScope(scope: AnalystScope): { kind: string; id: number | null } {
  if (scope.campaignId != null) return { kind: "campaign", id: scope.campaignId };
  if (scope.businessId != null) return { kind: "business", id: scope.businessId };
  if (scope.clientId   != null) return { kind: "client",   id: scope.clientId };
  return { kind: "all", id: null };
}

/**
 * Splits the LLM response into the markdown report and the JSON
 * recommendations array. Tolerant of small formatting drift — the model
 * sometimes wraps the JSON in a fenced block.
 */
function parseAnalystOutput(raw: string): { markdown: string; recs: AuditReportRecommendation[] } {
  const idx = raw.indexOf(SECTION_SEPARATOR);
  if (idx === -1) {
    // Model didn't emit the separator. Treat whole response as markdown
    // and return empty recs — caller logs a warning.
    return { markdown: raw.trim(), recs: [] };
  }
  const markdownPart = raw.slice(0, idx).trim();
  let jsonPart = raw.slice(idx + SECTION_SEPARATOR.length).trim();

  // Strip markdown fences if the model wrapped JSON in ```json ... ```.
  jsonPart = jsonPart
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let recs: AuditReportRecommendation[] = [];
  try {
    const parsed = JSON.parse(jsonPart);
    if (Array.isArray(parsed)) recs = parsed as AuditReportRecommendation[];
  } catch {
    // Leave recs empty; markdown is still useful.
  }
  return { markdown: markdownPart, recs };
}

/** Strip the report's leading "## Summary" sentence for storage as a teaser. */
export interface RunAuditReportOptions {
  reportDate: string;
  scope?: AnalystScope;
  lookbackDays?: number;
  /** If true, do not insert into daily_reports; useful for prompt iteration. */
  dryRun?: boolean;
}

/**
 * End-to-end audit report run:
 *   1. Assemble the audit context (SQL only)
 *   2. Format it into a markdown brief
 *   3. Send to DeepSeek-R1 with the audit-analyst system prompt
 *   4. Parse the response into markdown + structured recommendations
 *   5. Store in daily_reports unless dryRun
 */
export async function runAuditReport(opts: RunAuditReportOptions): Promise<AuditReportResult> {
  const scope = opts.scope ?? {};
  const lookbackDays = opts.lookbackDays ?? 14;
  const start = Date.now();

  const ctx = await assembleContext(opts.reportDate, scope, lookbackDays);
  const brief = formatAuditContext(ctx);

  const completion = await chatCompletion({
    model: "deepseek-reasoner",
    messages: [
      { role: "system", content: AUDIT_ANALYST_SYSTEM_PROMPT },
      { role: "user",   content: brief },
    ],
    temperature: 0.3,
  });

  const { markdown, recs } = parseAnalystOutput(completion.content);
  const durationMs = Date.now() - start;
  const { kind: scopeKind, id: scopeId } = describeScope(scope);

  // Pack chart-ready data into inputSummary alongside the existing counts.
  // The detail page renders donut + cohort bars + top-declines table from these.
  // We slice to keep the jsonb payload small (~3-5KB per report).
  const declineMovements: ReadonlyArray<RankChangeRow["movement"]> = ["declined", "lost_ranking"];
  const improveMovements: ReadonlyArray<RankChangeRow["movement"]> = ["improved", "gained_ranking"];
  const enrichedInputSummary = {
    ...ctx.inputSummary,
    lookbackDays: ctx.lookbackDays,
    cohort: ctx.movementCohort,
    topDeclines: ctx.rankChanges
      .filter((r) => declineMovements.includes(r.movement))
      .slice(0, 15),
    topImprovements: ctx.rankChanges
      .filter((r) => improveMovements.includes(r.movement))
      .slice(0, 15),
    recommendationsCount: recs.length,
  };

  if (opts.dryRun) {
    return {
      id: -1,
      reportDate: opts.reportDate,
      scope: scopeKind,
      scopeId,
      modelUsed: completion.model,
      reportMarkdown: markdown,
      recommendations: recs,
      inputSummary: ctx.inputSummary,
      generatedAt: new Date(),
      durationMs,
      costUsd: completion.costUsd,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
    };
  }

  const [row] = await db
    .insert(dailyReportsTable)
    .values({
      reportDate:      opts.reportDate,
      scope:           scopeKind,
      scopeId:         scopeId,
      modelUsed:       completion.model,
      inputSummary:    enrichedInputSummary,
      reportMarkdown:  markdown,
      recommendations: recs,
      durationMs,
      costUsd:         completion.costUsd.toFixed(4),
    })
    .returning();

  return {
    id: row.id,
    reportDate: row.reportDate,
    scope: row.scope,
    scopeId: row.scopeId,
    modelUsed: row.modelUsed ?? completion.model,
    reportMarkdown: row.reportMarkdown ?? markdown,
    recommendations: (row.recommendations as AuditReportRecommendation[] | null) ?? recs,
    inputSummary: ctx.inputSummary,
    generatedAt: row.generatedAt ?? new Date(),
    durationMs: row.durationMs ?? durationMs,
    costUsd: completion.costUsd,
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
  };
}
