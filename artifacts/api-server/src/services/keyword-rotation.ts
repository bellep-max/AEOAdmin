/**
 * Sustained-win rotation engine.
 *
 * A keyword is "won" only when its TWO most recent bi-weekly runs on the SAME
 * platform (chatgpt OR gemini OR perplexity) are BOTH top-3 (position 1, 2, or
 * 3). A single top-3 run no longer locks — the win must hold across two
 * consecutive cycles (one cycle ≈ 14 days). On a confirmed win we LOCK the
 * keyword (status='locked') and ROTATE in a fresh replacement keyword for the
 * same business/campaign. Won-but-rankable: a locked keyword STAYS is_active=true
 * and is NOT archived, so the bi-weekly pipeline keeps ranking it to confirm it
 * holds top-3 — it just moves to the "Locked/Won" view and is excluded from the
 * winner scan. (Truly retiring a keyword is a separate manual archive.)
 *
 * Why two runs: the previous immediate-on-single-top-3 rule, combined with
 * back-fill imports, cascade-locked ~1,457 keywords in June 2026 (every
 * historical top-3 fired an instant lock + replacement). SUSTAINED_RUNS
 * confirmation plus the call-site freshness guard (maybeAutoLock in
 * routes/ranking-reports.ts) make that class of cascade impossible.
 *
 * The detection rule lives here (server-side) — not in the dashboard — so it can
 * run from a cron/the orchestrator and produce the same result headless.
 */
import { db } from "@workspace/db";
import {
  keywordsTable,
  rankingReportsTable,
  businessesTable,
  keywordVariantsTable,
  clientsTable,
  clientAeoPlansTable,
} from "@workspace/db/schema";
import {
  and,
  eq,
  isNull,
  desc,
  inArray,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

// Plan type that opts a campaign out of rotation entirely. Free-trial clients
// never auto-lock and never get replacement keywords inserted; rotation is a
// retained-client behavior. Matches client_aeo_plans.plan_type values.
const FREE_TRIAL_PLAN_TYPE = "Free Trial Plans";
import { generateVariants } from "./variant-generator";
import { logger } from "../lib/logger";

export const TOP3_THRESHOLD = 3;

// A win must hold across this many consecutive bi-weekly runs on one platform
// before the keyword locks. Guards against single-run flukes on a bi-weekly
// cadence (one run ≈ every 14 days).
export const SUSTAINED_RUNS = 2;

export interface RotationLock {
  keywordId: number;
  keywordText: string;
  clientId: number; // for grouping winners by client in the bulk-lock UI
  triggerPlatform: string; // platform that triggered the lock, e.g. "perplexity"
  triggerPosition: number; // the top-3 position on that platform (1..3)
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
export async function rotateWinners(
  opts: {
    clientId?: number;
    businessId?: number;
    aeoPlanId?: number;
    keywordId?: number;
    keywordIds?: number[];
    dryRun?: boolean;
  } = {},
): Promise<RotationResult> {
  const dryRun = opts.dryRun === true;
  // Won-but-rankable model: a locked keyword stays is_active=true / not archived
  // so the bi-weekly pipeline keeps ranking it (to confirm it holds top-3). It
  // must NOT be re-scanned as a fresh winner, so exclude status='locked' here.
  const conds = [
    eq(keywordsTable.isActive, true),
    isNull(keywordsTable.archivedAt),
    sql`coalesce(${keywordsTable.status}, 'new') <> 'locked'`,
  ];
  if (opts.clientId != null)
    conds.push(eq(keywordsTable.clientId, opts.clientId));
  // Lock an explicit set of keywords — used by the "lock selected" bulk action.
  if (opts.keywordIds != null && opts.keywordIds.length > 0)
    conds.push(inArray(keywordsTable.id, opts.keywordIds));
  // Scope to a single business/campaign (aeoPlan) so rotation can run at the
  // campaign level, not just per client.
  if (opts.businessId != null)
    conds.push(eq(keywordsTable.businessId, opts.businessId));
  if (opts.aeoPlanId != null)
    conds.push(eq(keywordsTable.aeoPlanId, opts.aeoPlanId));
  // Scope to a single keyword — used by the auto-lock-on-win hook that fires
  // when a ranking report lands a top-3 for one keyword.
  if (opts.keywordId != null) conds.push(eq(keywordsTable.id, opts.keywordId));

  // Free-trial campaigns are excluded from rotation by policy. Pre-fetch the
  // free-trial plan IDs and filter out keywords belonging to them. Keywords
  // with a null aeo_plan_id (legacy / unassigned) stay eligible — we only
  // skip when we know the plan is free-trial.
  const freeTrialPlans = await db
    .select({ id: clientAeoPlansTable.id })
    .from(clientAeoPlansTable)
    .where(eq(clientAeoPlansTable.planType, FREE_TRIAL_PLAN_TYPE));
  const freeTrialPlanIds = freeTrialPlans.map((p) => p.id);
  if (freeTrialPlanIds.length > 0) {
    conds.push(
      or(
        isNull(keywordsTable.aeoPlanId),
        notInArray(keywordsTable.aeoPlanId, freeTrialPlanIds),
      )!,
    );
  }

  const keywords = await db
    .select()
    .from(keywordsTable)
    .where(and(...conds));
  const locked: RotationLock[] = [];

  for (const kw of keywords) {
    const recent = await db
      .select({
        platform: rankingReportsTable.platform,
        pos: rankingReportsTable.rankingPosition,
        date: rankingReportsTable.date,
        createdAt: rankingReportsTable.createdAt,
      })
      .from(rankingReportsTable)
      .where(eq(rankingReportsTable.keywordId, kw.id))
      .orderBy(
        desc(rankingReportsTable.createdAt),
        desc(rankingReportsTable.id),
      );

    if (recent.length === 0) continue; // no reports → cannot win

    // Collapse reports into per-platform RUNS. A run = one bi-weekly audit on a
    // given day; same-day duplicates (retries) collapse to the most recent row
    // (recent is createdAt desc, so the first row seen for a (platform, day) is
    // its latest). Rows with a null platform or null/<1 position (failed scans)
    // are skipped so a failed run can't mask a genuine top-3.
    const runsByPlatform = new Map<string, { pos: number; day: string }[]>();
    for (const r of recent) {
      if (r.platform == null || r.pos == null || r.pos < 1) continue;
      const day = (
        r.date ??
        r.createdAt?.toISOString().slice(0, 10) ??
        ""
      ).slice(0, 10);
      if (!day) continue;
      const list = runsByPlatform.get(r.platform) ?? [];
      if (list.some((x) => x.day === day)) continue; // already have this run-day
      list.push({ pos: r.pos, day });
      runsByPlatform.set(r.platform, list);
    }

    // Lock only when the SUSTAINED_RUNS most recent runs on the SAME platform are
    // all top-3 — a win held across consecutive bi-weekly cycles. Among platforms
    // that qualify, pick the strongest (lowest latest position) as the trigger.
    let triggerPlatform: string | null = null;
    let triggerPosition = Infinity;
    for (const [platform, runs] of runsByPlatform) {
      if (runs.length < SUSTAINED_RUNS) continue;
      const lastRuns = runs
        .slice()
        .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
        .slice(0, SUSTAINED_RUNS);
      const allTop3 = lastRuns.every((x) => x.pos <= TOP3_THRESHOLD);
      if (allTop3 && lastRuns[0].pos < triggerPosition) {
        triggerPlatform = platform;
        triggerPosition = lastRuns[0].pos;
      }
    }
    if (triggerPlatform == null) continue; // no sustained top-3 on any platform

    let replacement = `best ${kw.keywordText}`;
    let newKeywordId: number | null = null;

    if (!dryRun) {
      // business context for a better AI replacement
      let bizName: string | undefined,
        city: string | undefined,
        state: string | undefined;
      if (kw.businessId != null) {
        const [biz] = await db
          .select({
            name: businessesTable.name,
            city: businessesTable.city,
            state: businessesTable.state,
          })
          .from(businessesTable)
          .where(eq(businessesTable.id, kw.businessId));
        bizName = biz?.name ?? undefined;
        city = biz?.city ?? undefined;
        state = biz?.state ?? undefined;
      }
      try {
        const sug = await generateVariants({
          keyword: kw.keywordText,
          businessName: bizName,
          city,
          state,
          count: 5,
        });
        replacement = sug.variants?.[0] ?? replacement;
      } catch (err) {
        logger.warn(
          { err, keywordId: kw.id },
          "rotation: variant generation failed, using fallback replacement",
        );
      }

      // LOCK the winner atomically. Won-but-rankable: it stays is_active=true and
      // NOT archived so the bi-weekly pipeline keeps ranking it (to confirm it
      // holds top-3); only status flips to 'locked', which moves it to the
      // "Locked/Won" card and excludes it from the winner scan. The WHERE
      // re-checks status <> 'locked' so two concurrent rotation calls on the same
      // keyword don't both succeed (caught: a 504-timed-out POST + a retry batched
      // call locking the same parents twice and double-inserting replacements).
      // RETURNING .id lets us detect the conflict and skip the rest of the
      // per-keyword work if another caller already did it.
      const locked = await db
        .update(keywordsTable)
        .set({
          status: "locked", // "Locked/Won" — still rankable, just won
          archiveReason: `locked (won): top-3 on ${triggerPlatform} for ${SUSTAINED_RUNS} consecutive runs (#${triggerPosition}) — auto-rotation`,
          replacementSuggestion: replacement,
        })
        .where(
          and(
            eq(keywordsTable.id, kw.id),
            eq(keywordsTable.isActive, true),
            isNull(keywordsTable.archivedAt),
            sql`coalesce(${keywordsTable.status}, 'new') <> 'locked'`,
          ),
        )
        .returning({ id: keywordsTable.id });
      if (locked.length === 0) continue; // another concurrent caller won the race

      // Stamp the client's locked_at the first time any of its keywords wins.
      // COALESCE keeps the original stamp on subsequent wins so locked_at
      // reflects "first graduation," not "most recent win."
      await db
        .update(clientsTable)
        .set({ lockedAt: sql`COALESCE(${clientsTable.lockedAt}, now())` })
        .where(eq(clientsTable.id, kw.clientId));

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

      // Generate + store a variant set for the new keyword so it's audit-ready
      // immediately (the audit/ranking rotation cycles through these phrasings).
      if (nk?.id != null) {
        const nkId = nk.id;
        try {
          const vg = await generateVariants({
            keyword: replacement,
            businessName: bizName,
            city,
            state,
            count: 5,
          });
          const variants = (vg.variants ?? []).filter((v): v is string => !!v);
          if (variants.length > 0) {
            await db.insert(keywordVariantsTable).values(
              variants.map((v) => ({
                keywordId: nkId,
                variantText: v,
                isActive: true,
                sourceModel: "deepseek-chat",
                weekOf: new Date().toISOString().slice(0, 10),
              })),
            );
          }
        } catch (err) {
          logger.warn(
            { err, keywordId: nkId },
            "rotation: variant generation for replacement failed",
          );
        }
      }
    }

    locked.push({
      keywordId: kw.id,
      keywordText: kw.keywordText,
      clientId: kw.clientId,
      triggerPlatform,
      triggerPosition,
      replacement,
      newKeywordId,
    });
  }

  return { scanned: keywords.length, locked, dryRun };
}
