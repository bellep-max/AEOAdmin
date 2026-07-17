/**
 * Business momentum flagging.
 *
 * A business is flagged "Needs Attention" when the AEO growth cycle stops
 * producing forward progress — NOT because one keyword dropped.
 *
 * Rule (v1, deliberately simple and explainable):
 *
 *   A campaign's bi-weekly audit is NEGATIVE when BOTH are true:
 *     1. no active keyword reached Top 1-3 in that audit, and
 *     2. the majority of its active keywords were flat or declining vs the
 *        previous audit.
 *   A campaign is LOSING MOMENTUM when the two most recent audits are both
 *   negative (one bad round is noise; two in a row is a trend).
 *
 *   A business NEEDS ATTENTION when >= 50% of its active campaigns are
 *   confirmed losing momentum.
 *
 * Why "reached Top 1-3" stands in for "locked": the spec's decision flow asks
 * "did at least one keyword reach Top 1-3 and get locked?", but keywords carry
 * no per-keyword lock timestamp — only a current status — so "locked in THAT
 * audit" is not answerable from the data. Top-3-in-that-audit is the same
 * forward-progress signal, is derivable per audit, and needs no schema change.
 */
import { pool } from "@workspace/db";

export const TOP3 = 3;
/** Audits needed before a business can be judged: two to confirm the pattern,
 *  plus one earlier round to measure movement against. */
const MIN_AUDITS = 3;

export type MomentumStatus =
  | "needs_attention"
  | "review_recommended"
  | "on_track"
  | "ramping_up";

export interface BusinessMomentum {
  businessId: number;
  businessName: string | null;
  clientId: number;
  clientName: string | null;
  activeCampaigns: number;
  losingMomentum: number;
  /** Share of active campaigns losing momentum, 0-1. */
  ratio: number;
  status: MomentumStatus;
}

export interface MomentumSummary {
  counts: Record<MomentumStatus, number>;
  businesses: BusinessMomentum[];
}

interface Row {
  campaign_id: number;
  business_id: number;
  business_name: string | null;
  client_id: number;
  client_name: string | null;
  keyword_id: number;
  d: string;
  best_rank: number | null;
}

/** Per keyword, per audit date: the best (lowest) rank it hit across the AI
 *  platforms that day. Only the active pool counts — locked/won keywords have
 *  already graduated and would mask a stalled campaign. */
const SQL = `
  SELECT
    k.aeo_plan_id                          AS campaign_id,
    k.business_id                          AS business_id,
    b.name                                 AS business_name,
    k.client_id                            AS client_id,
    c.business_name                        AS client_name,
    rr.keyword_id                          AS keyword_id,
    rr.date::text                          AS d,
    MIN(rr.ranking_position) FILTER (
      WHERE rr.ranking_position IS NOT NULL AND rr.ranking_position >= 1
    )                                      AS best_rank
  FROM ranking_reports rr
  JOIN keywords k          ON k.id = rr.keyword_id
  LEFT JOIN businesses b   ON b.id = k.business_id
  LEFT JOIN clients c      ON c.id = k.client_id
  WHERE k.is_active = true
    AND COALESCE(k.status, 'new') <> 'locked'
    AND k.aeo_plan_id IS NOT NULL
    AND k.business_id IS NOT NULL
    AND rr.status = 'success'
    AND rr.date IS NOT NULL
  GROUP BY k.aeo_plan_id, k.business_id, b.name, k.client_id, c.business_name,
           rr.keyword_id, rr.date
`;

interface AuditVerdict {
  negative: boolean;
  /** False when the round can't be judged (no comparable keywords). */
  judged: boolean;
}

/** One audit round for one campaign. `dates` are newest-first. */
function judgeAudit(
  byKeyword: Map<number, Map<string, number | null>>,
  at: string,
  prev: string,
): AuditVerdict {
  let anyTop3 = false;
  let comparable = 0;
  let flatOrDown = 0;

  for (const ranks of byKeyword.values()) {
    const cur = ranks.get(at) ?? null;
    if (cur != null && cur <= TOP3) anyTop3 = true;
    const before = ranks.get(prev) ?? null;
    if (cur != null && before != null) {
      comparable += 1;
      // Lower rank number is better; not-lower means flat or declining.
      if (cur >= before) flatOrDown += 1;
    }
  }

  // Forward progress this round — a top-3 is a win regardless of movement.
  if (anyTop3) return { negative: false, judged: true };
  // Nothing measurable to compare — don't manufacture a negative.
  if (comparable === 0) return { negative: false, judged: false };
  return { negative: flatOrDown > comparable / 2, judged: true };
}

function rollUp(ratio: number, losing: number): MomentumStatus {
  if (ratio >= 0.5) return "needs_attention";
  if (losing > 0) return "review_recommended";
  return "on_track";
}

export async function computeBusinessMomentum(
  clientIds: number[] | null,
): Promise<MomentumSummary> {
  // Scoped roles only see their slice; an empty slice means nothing to report.
  if (clientIds !== null && clientIds.length === 0)
    return { counts: emptyCounts(), businesses: [] };

  const where = clientIds !== null ? ` AND k.client_id = ANY($1::int[])` : "";
  const text = SQL.replace("GROUP BY", `${where}\n  GROUP BY`);
  const result = await pool.query<Row>(
    text,
    clientIds !== null ? [clientIds] : [],
  );

  /* campaign -> keyword -> (date -> best rank), plus each campaign's identity. */
  const campaigns = new Map<
    number,
    {
      businessId: number;
      businessName: string | null;
      clientId: number;
      clientName: string | null;
      dates: Set<string>;
      byKeyword: Map<number, Map<string, number | null>>;
    }
  >();

  for (const r of result.rows) {
    let c = campaigns.get(r.campaign_id);
    if (!c) {
      c = {
        businessId: r.business_id,
        businessName: r.business_name,
        clientId: r.client_id,
        clientName: r.client_name,
        dates: new Set(),
        byKeyword: new Map(),
      };
      campaigns.set(r.campaign_id, c);
    }
    c.dates.add(r.d);
    let ranks = c.byKeyword.get(r.keyword_id);
    if (!ranks) {
      ranks = new Map();
      c.byKeyword.set(r.keyword_id, ranks);
    }
    ranks.set(r.d, r.best_rank);
  }

  /* business -> campaign verdicts */
  const businesses = new Map<
    number,
    {
      businessName: string | null;
      clientId: number;
      clientName: string | null;
      active: number;
      losing: number;
      /** Campaigns with enough history to judge at all. */
      judged: number;
    }
  >();

  for (const c of campaigns.values()) {
    const dates = [...c.dates].sort((a, b) => b.localeCompare(a));
    let b = businesses.get(c.businessId);
    if (!b) {
      b = {
        businessName: c.businessName,
        clientId: c.clientId,
        clientName: c.clientName,
        active: 0,
        losing: 0,
        judged: 0,
      };
      businesses.set(c.businessId, b);
    }
    b.active += 1;

    // Not enough rounds yet — still ramping up, never a negative signal.
    if (dates.length < MIN_AUDITS) continue;

    const latest = judgeAudit(c.byKeyword, dates[0], dates[1]);
    const previous = judgeAudit(c.byKeyword, dates[1], dates[2]);
    if (!latest.judged || !previous.judged) continue;

    b.judged += 1;
    if (latest.negative && previous.negative) b.losing += 1;
  }

  const out: BusinessMomentum[] = [];
  for (const [businessId, b] of businesses) {
    const ratio = b.active > 0 ? b.losing / b.active : 0;
    const status: MomentumStatus =
      b.judged === 0 ? "ramping_up" : rollUp(ratio, b.losing);
    out.push({
      businessId,
      businessName: b.businessName,
      clientId: b.clientId,
      clientName: b.clientName,
      activeCampaigns: b.active,
      losingMomentum: b.losing,
      ratio,
      status,
    });
  }

  // Worst first, so the dashboard leads with what needs a human.
  const order: Record<MomentumStatus, number> = {
    needs_attention: 0,
    review_recommended: 1,
    ramping_up: 2,
    on_track: 3,
  };
  out.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      b.ratio - a.ratio ||
      (a.businessName ?? "").localeCompare(b.businessName ?? ""),
  );

  const counts = emptyCounts();
  for (const b of out) counts[b.status] += 1;
  return { counts, businesses: out };
}

function emptyCounts(): Record<MomentumStatus, number> {
  return {
    needs_attention: 0,
    review_recommended: 0,
    on_track: 0,
    ramping_up: 0,
  };
}
