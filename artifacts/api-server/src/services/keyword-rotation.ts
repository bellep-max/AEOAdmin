/**
 * Auto-lock-on-win rotation engine.
 *
 * A keyword whose CURRENT ranking shows top-3 (position 1, 2, or 3) on ANY ONE
 * of the platforms (chatgpt OR gemini OR perplexity) is considered "won" — the
 * lock is IMMEDIATE, no sustained window or multi-run requirement. "Current
 * ranking" = the most recent ranking_reports row per (keyword, platform); take
 * the latest position per platform and if any is in [1,3] → lock. We LOCK the
 * keyword (archive → isActive=false, so build-session stops enriching it and it
 * drops out of future ranking sessions) and ROTATE in a fresh replacement
 * keyword for the same business/campaign.
 *
 * The detection rule lives here (server-side) — not in the dashboard — so it can
 * run from a cron/the orchestrator and produce the same result headless.
 */
import { db } from "@workspace/db";
import { keywordsTable, rankingReportsTable, businessesTable } from "@workspace/db/schema";
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import { generateVariants } from "./variant-generator";
import { logger } from "../lib/logger";

export const TOP3_THRESHOLD = 3;

export interface RotationLock {
  keywordId: number;
  keywordText: string;
  clientId: number;          // for grouping winners by client in the bulk-lock UI
  triggerPlatform: string;   // platform that triggered the lock, e.g. "perplexity"
  triggerPosition: number;   // the top-3 position on that platform (1..3)
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
export async function rotateWinners(opts: { clientId?: number; businessId?: number; aeoPlanId?: number; keywordId?: number; keywordIds?: number[]; dryRun?: boolean } = {}): Promise<RotationResult> {
  const dryRun = opts.dryRun === true;
  const conds = [eq(keywordsTable.isActive, true), isNull(keywordsTable.archivedAt)];
  if (opts.clientId != null) conds.push(eq(keywordsTable.clientId, opts.clientId));
  // Lock an explicit set of keywords — used by the "lock selected" bulk action.
  if (opts.keywordIds != null && opts.keywordIds.length > 0) conds.push(inArray(keywordsTable.id, opts.keywordIds));
  // Scope to a single business/campaign (aeoPlan) so rotation can run at the
  // campaign level, not just per client.
  if (opts.businessId != null) conds.push(eq(keywordsTable.businessId, opts.businessId));
  if (opts.aeoPlanId != null) conds.push(eq(keywordsTable.aeoPlanId, opts.aeoPlanId));
  // Scope to a single keyword — used by the auto-lock-on-win hook that fires
  // when a ranking report lands a top-3 for one keyword.
  if (opts.keywordId != null) conds.push(eq(keywordsTable.id, opts.keywordId));

  const keywords = await db.select().from(keywordsTable).where(and(...conds));
  const locked: RotationLock[] = [];

  for (const kw of keywords) {
    const recent = await db
      .select({ platform: rankingReportsTable.platform, pos: rankingReportsTable.rankingPosition })
      .from(rankingReportsTable)
      .where(eq(rankingReportsTable.keywordId, kw.id))
      .orderBy(desc(rankingReportsTable.createdAt), desc(rankingReportsTable.id));

    if (recent.length === 0) continue; // no reports → cannot win

    // Most recent *valid* ranking position per platform. Reports are ordered
    // createdAt desc (id desc as a deterministic tie-break), so the first row
    // with a real position for a platform is its latest. Rows with a null
    // platform or a null/<1 position (failed scans) are skipped so a failed run
    // can't mask a genuine top-3 — this matches the dashboard's lock detection.
    const latestByPlatform = new Map<string, number>();
    for (const r of recent) {
      if (r.platform == null || r.pos == null || r.pos < 1) continue;
      if (!latestByPlatform.has(r.platform)) latestByPlatform.set(r.platform, r.pos);
    }

    // pick the strongest current top-3 across platforms (smallest position wins)
    let triggerPlatform: string | null = null;
    let triggerPosition = Infinity;
    for (const [platform, pos] of latestByPlatform) {
      if (pos <= TOP3_THRESHOLD && pos < triggerPosition) {
        triggerPlatform = platform;
        triggerPosition = pos;
      }
    }
    if (triggerPlatform == null) continue; // not currently top-3 on any platform

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
          status: "locked", // distinct "Locked/Won" state (vs a manual archive)
          archivedAt: new Date(),
          archiveReason: `locked (won): top-3 on ${triggerPlatform} (#${triggerPosition}) — auto-rotation`,
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

    locked.push({ keywordId: kw.id, keywordText: kw.keywordText, clientId: kw.clientId, triggerPlatform, triggerPosition, replacement, newKeywordId });
  }

  return { scanned: keywords.length, locked, dryRun };
}
