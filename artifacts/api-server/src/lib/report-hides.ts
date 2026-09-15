/* Admin-hidden report data: which audit dates are hidden for a given view.
 * Cascade is downward-only — a client-level hide applies everywhere under the
 * client, a business-level hide to that business + its campaigns, a
 * campaign-level hide to that campaign's view only. Keyword hiding lives on
 * keywords.hidden_from_reports and is filtered where each endpoint queries. */
import { db } from "@workspace/db";
import {
  hiddenReportDatesTable,
  hiddenKeywordPlatformsTable,
  keywordsTable,
  clientAeoPlansTable,
  businessesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

export interface HideScope {
  clientId?: number | null;
  businessId?: number | null;
  aeoPlanId?: number | null;
}

interface ResolvedScope {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

/** Fill in the missing ancestors (campaign → business → client) so cascade
 *  checks work no matter which single id the caller filtered by. */
async function resolveScope(scope: HideScope): Promise<ResolvedScope> {
  let clientId = scope.clientId ?? null;
  let businessId = scope.businessId ?? null;
  const aeoPlanId = scope.aeoPlanId ?? null;
  if (aeoPlanId != null && (businessId == null || clientId == null)) {
    const [plan] = await db
      .select({
        businessId: clientAeoPlansTable.businessId,
        clientId: clientAeoPlansTable.clientId,
      })
      .from(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.id, aeoPlanId))
      .limit(1);
    businessId = businessId ?? plan?.businessId ?? null;
    clientId = clientId ?? plan?.clientId ?? null;
  }
  if (businessId != null && clientId == null) {
    const [biz] = await db
      .select({ clientId: businessesTable.clientId })
      .from(businessesTable)
      .where(eq(businessesTable.id, businessId))
      .limit(1);
    clientId = biz?.clientId ?? null;
  }
  return { clientId, businessId, aeoPlanId };
}

export interface HiddenDateRow {
  id: number;
  clientId: number;
  businessId: number | null;
  aeoPlanId: number | null;
  date: string;
}

/** All hide rows that APPLY to this view (cascade-resolved). With no scope at
 *  all (global lists), only client-level hides apply. */
export async function hiddenDateRowsForScope(
  scope: HideScope,
): Promise<HiddenDateRow[]> {
  const s = await resolveScope(scope);
  const rows = await db
    .select({
      id: hiddenReportDatesTable.id,
      clientId: hiddenReportDatesTable.clientId,
      businessId: hiddenReportDatesTable.businessId,
      aeoPlanId: hiddenReportDatesTable.aeoPlanId,
      date: hiddenReportDatesTable.date,
    })
    .from(hiddenReportDatesTable)
    .where(
      s.clientId != null
        ? eq(hiddenReportDatesTable.clientId, s.clientId)
        : undefined,
    );
  return rows.filter((r) => {
    if (r.businessId == null && r.aeoPlanId == null) return true; // client-level
    if (r.aeoPlanId == null)
      return s.businessId != null && r.businessId === s.businessId;
    return s.aeoPlanId != null && r.aeoPlanId === s.aeoPlanId;
  });
}

/** "clientId|date" keys hidden for this view — for cross-client queries. */
export async function hiddenDatePairs(scope: HideScope): Promise<string[]> {
  const rows = await hiddenDateRowsForScope(scope);
  return [...new Set(rows.map((r) => `${r.clientId}|${r.date}`))];
}

/** Just the YYYY-MM-DD dates hidden for a single-client view. */
export async function hiddenDatesForScope(scope: HideScope): Promise<string[]> {
  const rows = await hiddenDateRowsForScope(scope);
  return [...new Set(rows.map((r) => r.date))];
}

/** SQL fragment for the raw bi-weekly queries: excludes hidden keywords.
 *  Safe under the CTE `rr.` prefix rewrite (only the outer keyword_id is a
 *  rewritable bare column). */
export const HIDDEN_KEYWORDS_SQL =
  "keyword_id NOT IN (SELECT id FROM keywords WHERE hidden_from_reports = true)";

/** "keywordId|platform" pairs hidden for this view (platform lowercase).
 *  Scoped through the keywords table when any id is given; global otherwise. */
export async function hiddenKeywordPlatformPairs(
  scope: HideScope,
): Promise<string[]> {
  const s = await resolveScope(scope);
  const rows = await db
    .select({
      keywordId: hiddenKeywordPlatformsTable.keywordId,
      platform: hiddenKeywordPlatformsTable.platform,
    })
    .from(hiddenKeywordPlatformsTable)
    .innerJoin(
      keywordsTable,
      eq(hiddenKeywordPlatformsTable.keywordId, keywordsTable.id),
    )
    .where(
      and(
        s.clientId != null
          ? eq(keywordsTable.clientId, s.clientId)
          : undefined,
        scope.businessId != null
          ? eq(keywordsTable.businessId, scope.businessId)
          : undefined,
        scope.aeoPlanId != null
          ? eq(keywordsTable.aeoPlanId, scope.aeoPlanId)
          : undefined,
      ),
    );
  return rows.map((r) => `${r.keywordId}|${r.platform.toLowerCase()}`);
}
