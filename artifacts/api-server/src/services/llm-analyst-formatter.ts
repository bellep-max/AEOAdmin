/**
 * Turns an AnalystContext into a markdown brief that DeepSeek-R1 can read.
 *
 * Design choice: short markdown tables, not raw JSON. R1 reads tables
 * better and tokens are cheaper. We trim to "interesting" rows (top
 * declines, top improvers, biggest similarity, mismatches only) so the
 * full prompt stays under ~30K tokens even on a 14-day audit window.
 */
import type {
  AnalystContext,
  RankChangeRow,
  WindowActivityRow,
  SimilarityRow,
  GmbMismatchRow,
  MovementCohortRow,
} from "./daily-analyst";

const MAX_DECLINES_SHOWN  = 25;
const MAX_IMPROVERS_SHOWN = 10;
const MAX_SIMILARITY_PAIRS = 15;
const MAX_GMB_MISMATCHES   = 25;

function table(headers: string[], rows: (string | number | null)[][]): string {
  if (rows.length === 0) return "_(no rows)_";
  const head = `| ${headers.join(" | ")} |`;
  const sep  = `|${headers.map(() => "---").join("|")}|`;
  const body = rows
    .map((r) => `| ${r.map((v) => (v == null ? "—" : String(v))).join(" | ")} |`)
    .join("\n");
  return `${head}\n${sep}\n${body}`;
}

function fmtRank(v: number | null): string {
  return v == null ? "off" : String(v);
}

function trim<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

function findActivity(
  windowActivity: WindowActivityRow[],
  keyword_id: number,
  platform: string | null,
): WindowActivityRow | undefined {
  return windowActivity.find(
    (w) => w.keyword_id === keyword_id && w.platform === platform,
  );
}

/** Decline rows joined to the matching window activity for the same key. */
function joinDeclinesWithActivity(
  rankChanges: RankChangeRow[],
  windowActivity: WindowActivityRow[],
  limit: number,
): { rc: RankChangeRow; wa: WindowActivityRow | undefined }[] {
  return rankChanges
    .filter((r) => r.movement === "declined" || r.movement === "lost_ranking")
    .slice(0, limit)
    .map((rc) => ({ rc, wa: findActivity(windowActivity, rc.keyword_id, rc.platform) }));
}

function joinImprovementsWithActivity(
  rankChanges: RankChangeRow[],
  windowActivity: WindowActivityRow[],
  limit: number,
): { rc: RankChangeRow; wa: WindowActivityRow | undefined }[] {
  return rankChanges
    .filter((r) => r.movement === "improved" || r.movement === "gained_ranking")
    .slice(0, limit)
    .map((rc) => ({ rc, wa: findActivity(windowActivity, rc.keyword_id, rc.platform) }));
}

function renderRankAndActivityTable(
  rows: { rc: RankChangeRow; wa: WindowActivityRow | undefined }[],
): string {
  return table(
    ["kid", "keyword", "business", "platform", "prev", "now", "Δ", "movement", "sessions", "bl%", "pass%", "variants", "hour σ"],
    rows.map(({ rc, wa }) => [
      rc.keyword_id,
      rc.keyword,
      rc.business,
      rc.platform,
      fmtRank(rc.prev_rank),
      fmtRank(rc.current_rank),
      rc.delta_position == null ? "—" : (rc.delta_position > 0 ? `+${rc.delta_position}` : String(rc.delta_position)),
      rc.movement,
      wa?.sessions_in_window ?? 0,
      wa?.backlink_inject_pct ?? "—",
      wa?.pass_pct ?? "—",
      wa?.distinct_variants ?? 0,
      wa?.hour_stddev ?? "—",
    ]),
  );
}

function renderCohort(rows: MovementCohortRow[]): string {
  return table(
    ["movement", "keywords", "total sessions", "avg backlink-inject %", "avg pass %", "avg hour σ"],
    rows.map((r) => [
      r.movement,
      r.keyword_count,
      r.total_sessions,
      r.avg_backlink_inject_pct ?? "—",
      r.avg_pass_pct ?? "—",
      r.avg_hour_stddev ?? "—",
    ]),
  );
}

function renderSimilarity(rows: SimilarityRow[]): string {
  return table(
    ["kid_a", "keyword A", "kid_b", "keyword B", "similarity"],
    trim(rows, MAX_SIMILARITY_PAIRS).map((r) => [
      r.keyword_a_id,
      r.keyword_a,
      r.keyword_b_id,
      r.keyword_b,
      r.sim,
    ]),
  );
}

function renderGmbMismatches(rows: GmbMismatchRow[]): string {
  const mismatches = rows.filter((r) => r.gmb_match === "mismatch");
  return table(
    ["kid", "keyword", "business", "GMB address", "search address"],
    trim(mismatches, MAX_GMB_MISMATCHES).map((r) => [
      r.keyword_id,
      r.keyword,
      r.business,
      r.gmb_address,
      r.search_address,
    ]),
  );
}

/** Render the full audit-context as a markdown brief for the LLM. */
export function formatAuditContext(ctx: AnalystContext): string {
  const declineRows = joinDeclinesWithActivity(ctx.rankChanges, ctx.windowActivity, MAX_DECLINES_SHOWN);
  const improvers   = joinImprovementsWithActivity(ctx.rankChanges, ctx.windowActivity, MAX_IMPROVERS_SHOWN);
  const totalDeclines    = ctx.rankChanges.filter((r) => r.movement === "declined" || r.movement === "lost_ranking").length;
  const totalImprovements = ctx.rankChanges.filter((r) => r.movement === "improved" || r.movement === "gained_ranking").length;

  const sections: string[] = [];

  sections.push(`# Audit Context — ${ctx.reportDate}`);
  sections.push(
    `Lookback window: **${ctx.lookbackDays} days**.` +
    ` Total keyword × platform pairs that moved: declined=${totalDeclines}, improved=${totalImprovements},` +
    ` similarity flags=${ctx.similarityFlags.length},` +
    ` GMB mismatches=${ctx.inputSummary.gmbMismatches}.`,
  );

  sections.push(`## Cohort Comparison (per movement bucket)`);
  sections.push(`These averages collapse session activity within each cohort. Look for differences between improvers and decliners.`);
  sections.push(renderCohort(ctx.movementCohort));

  sections.push(`## Top Declines (showing ${declineRows.length} of ${totalDeclines})`);
  sections.push(`Each row joins the rank change with that key's session activity in the lookback window.`);
  sections.push(`\`prev\` = previous in-top-50 rank, \`now\` = current in-top-50 rank ("off" = not in top 50). \`Δ\` is positive when rank dropped.`);
  sections.push(renderRankAndActivityTable(declineRows));

  sections.push(`## Top Improvements (showing ${improvers.length} of ${totalImprovements})`);
  sections.push(renderRankAndActivityTable(improvers));

  sections.push(`## Keyword Similarity Flags (potential cannibalization)`);
  sections.push(`Pairs of active keywords on the SAME business with high textual overlap.`);
  sections.push(renderSimilarity(ctx.similarityFlags));

  sections.push(`## GMB vs Search Address Mismatches`);
  sections.push(`Keywords whose business's published GMB address differs from the campaign's search address.`);
  sections.push(renderGmbMismatches(ctx.gmbMismatches));

  return sections.join("\n\n");
}
