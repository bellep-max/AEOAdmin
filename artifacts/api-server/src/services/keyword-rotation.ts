/**
 * Auto-lock-on-win rotation engine.
 *
 * A keyword that has held a top-3 rank for >= MIN_TOP3 of its last WINDOW
 * ranking runs is considered "won": we LOCK it (archive → isActive=false, so
 * build-session stops enriching it and it drops out of future ranking sessions)
 * and ROTATE in a fresh replacement keyword for the same business/campaign.
 *
 * The detection rule lives here (server-side) — not in the dashboard — so it can
 * run from a cron/the orchestrator and produce the same result headless.
 */
import { db } from "@workspace/db";
import { keywordsTable, rankingReportsTable, businessesTable } from "@workspace/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { generateVariants } from "./variant-generator";
import { logger } from "../lib/logger";

export const TOP3_THRESHOLD = 3;
export const WINDOW_RUNS = 7;   // look at the last N ranking reports per keyword
export const MIN_TOP3_RUNS = 5; // >= this many in top-3 within the window → locked

export interface RotationLock {
  keywordId: number;
  keywordText: string;
  top3Runs: number;
  windowRuns: number;
  replacement: string;
  newKeywordId: number | null;
}
export interface RotationResult {
  scanned: number;
  locked: RotationLock[];
  dryRun: boolean;
}

/**
 * Scan active keywords (optionally for one client), lock the winners and rotate
 * in replacements. Pass dryRun=true to preview without mutating.
 */
export async function rotateWinners(opts: { clientId?: number; dryRun?: boolean } = {}): Promise<RotationResult> {
  const dryRun = opts.dryRun === true;
  const conds = [eq(keywordsTable.isActive, true), isNull(keywordsTable.archivedAt)];
  if (opts.clientId != null) conds.push(eq(keywordsTable.clientId, opts.clientId));

  const keywords = await db.select().from(keywordsTable).where(and(...conds));
  const locked: RotationLock[] = [];

  for (const kw of keywords) {
    const recent = await db
      .select({ pos: rankingReportsTable.rankingPosition })
      .from(rankingReportsTable)
      .where(eq(rankingReportsTable.keywordId, kw.id))
      .orderBy(desc(rankingReportsTable.createdAt))
      .limit(WINDOW_RUNS);

    if (recent.length < WINDOW_RUNS) continue; // not enough history to judge
    const top3 = recent.filter((r) => r.pos != null && r.pos >= 1 && r.pos <= TOP3_THRESHOLD).length;
    if (top3 < MIN_TOP3_RUNS) continue; // not a sustained winner

    let replacement = `best ${kw.keywordText}`;
    let newKeywordId: number | null = null;

    if (!dryRun) {
      // business context for a better AI replacement
      let bizName: string | undefined, city: string | undefined, state: string | undefined;
      if (kw.businessId != null) {
        const [biz] = await db
          .select({ name: businessesTable.name, city: businessesTable.city, state: businessesTable.state })
          .from(businessesTable)
          .where(eq(businessesTable.id, kw.businessId));
        bizName = biz?.name ?? undefined;
        city = biz?.city ?? undefined;
        state = biz?.state ?? undefined;
      }
      try {
        const sug = await generateVariants({ keyword: kw.keywordText, businessName: bizName, city, state, count: 5 });
        replacement = sug.variants?.[0] ?? replacement;
      } catch (err) {
        logger.warn({ err, keywordId: kw.id }, "rotation: variant generation failed, using fallback replacement");
      }

      // LOCK the winner (archive → drops out of ranking via build-session guard)
      await db
        .update(keywordsTable)
        .set({
          isActive: false,
          archivedAt: new Date(),
          archiveReason: `locked: top-3 in ${top3}/${WINDOW_RUNS} recent runs (auto-rotation)`,
          replacementSuggestion: replacement,
        })
        .where(eq(keywordsTable.id, kw.id));

      // ROTATE in the replacement, same business/campaign
      const [nk] = await db
        .insert(keywordsTable)
        .values({
          clientId: kw.clientId,
          businessId: kw.businessId,
          aeoPlanId: kw.aeoPlanId,
          keywordText: replacement,
          keywordType: kw.keywordType,
          isActive: true,
          status: "new",
          notes: `Auto-rotated replacement for locked "${kw.keywordText}"`,
        })
        .returning();
      newKeywordId = nk?.id ?? null;
    }

    locked.push({ keywordId: kw.id, keywordText: kw.keywordText, top3Runs: top3, windowRuns: WINDOW_RUNS, replacement, newKeywordId });
  }

  return { scanned: keywords.length, locked, dryRun };
}
