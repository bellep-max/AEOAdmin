/**
 * Reconcile the historical sustained-win winners under the new rotation rule.
 *
 * For each ACTIVE ORIGINAL keyword that now passes the 2-run rule (top-3 on the
 * same platform across its 2 most recent bi-weekly runs), this:
 *   1. Locks it "won-but-rankable" (status='locked', stays is_active=true / not
 *      archived so it keeps getting ranked), and
 *   2. Revives its EXISTING parked replacement (the June cascade already
 *      generated one) instead of generating a new keyword. If several exist,
 *      revives the gen-1 (earliest-created) and leaves the rest parked.
 *
 * DRY RUN by default. Set EXECUTE=1 to write (single transaction).
 *
 *   node scripts/reconcile-337-winners.mjs          # preview
 *   EXECUTE=1 node scripts/reconcile-337-winners.mjs # apply
 */
import pg from "pg";

const EXECUTE = process.env.EXECUTE === "1";
const TOP3 = 3;
const SUSTAINED = 2;

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

// ── 1. Recompute winners: active originals passing the 2-run rule ────────────
const origins = (
  await db.query(`
    SELECT id, keyword_text, aeo_plan_id
    FROM keywords
    WHERE is_active = true AND archived_at IS NULL
      AND (notes IS NULL OR notes NOT ILIKE 'Auto-rotated replacement%')`)
).rows;

function passesTwoRun(reports) {
  const byPlatform = new Map();
  for (const r of reports) {
    if (r.platform == null || r.pos == null || r.pos < 1) continue;
    const day = (
      r.date ?? (r.createdat ? new Date(r.createdat).toISOString().slice(0, 10) : "")
    ).slice(0, 10);
    if (!day) continue;
    const list = byPlatform.get(r.platform) ?? [];
    if (list.some((x) => x.day === day)) continue;
    list.push({ pos: r.pos, day });
    byPlatform.set(r.platform, list);
  }
  for (const [, runs] of byPlatform) {
    const last = runs
      .slice()
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
      .slice(0, SUSTAINED);
    if (last.length >= SUSTAINED && last.every((x) => x.pos <= TOP3)) return true;
  }
  return false;
}

const winners = [];
for (const kw of origins) {
  const reports = (
    await db.query(
      `SELECT platform, ranking_position pos, date, created_at createdat
       FROM ranking_reports WHERE keyword_id = $1
       ORDER BY created_at DESC, id DESC`,
      [kw.id],
    )
  ).rows;
  if (reports.length && passesTwoRun(reports)) winners.push(kw);
}

// ── 2. Match each winner to its parked replacement (gen-1 if several) ─────────
const plan = []; // { winner, replacementId }
let noRep = 0,
  multi = 0;
for (const w of winners) {
  const reps = (
    await db.query(
      `SELECT id, keyword_text, created_at
       FROM keywords
       WHERE notes ILIKE 'Auto-rotated replacement for locked %'
         AND lower(notes) LIKE '%"' || lower($1) || '"%'
         AND aeo_plan_id IS NOT DISTINCT FROM $2
         AND is_active = false
       ORDER BY created_at ASC, id ASC`,
      [w.keyword_text, w.aeo_plan_id],
    )
  ).rows;
  if (reps.length === 0) {
    noRep++;
    continue;
  }
  if (reps.length > 1) multi++;
  plan.push({ winner: w, replacementId: reps[0].id, replacementText: reps[0].keyword_text });
}

console.log(`Mode: ${EXECUTE ? "EXECUTE (writing)" : "DRY RUN (no writes)"}`);
console.log(`Winners (2-run rule): ${winners.length}`);
console.log(`  with a parked replacement to revive: ${plan.length}`);
console.log(`    of those, had multiple (revived gen-1): ${multi}`);
console.log(`  winners with NO parked replacement (lock only, no revive): ${noRep}`);
console.log("\nSample plan (first 8):");
for (const p of plan.slice(0, 8)) {
  console.log(`  LOCK "${p.winner.keyword_text}"  →  REVIVE replacement #${p.replacementId} "${p.replacementText}"`);
}

if (!EXECUTE) {
  console.log("\nDRY RUN complete — nothing written. Re-run with EXECUTE=1 to apply.");
  await db.end();
  process.exit(0);
}

// ── 3. Apply (transaction) ───────────────────────────────────────────────────
await db.query("BEGIN");
let locked = 0,
  revived = 0;
for (const p of plan) {
  const l = await db.query(
    `UPDATE keywords SET
       status = 'locked',
       archive_reason = 'locked (won): sustained top-3 — reconciled 2026-06-12'
     WHERE id = $1 AND coalesce(status,'new') <> 'locked'
     RETURNING id`,
    [p.winner.id],
  );
  locked += l.rowCount;
  const r = await db.query(
    `UPDATE keywords SET
       is_active = true, status = 'new', archived_at = NULL,
       archive_reason = NULL
     WHERE id = $1
     RETURNING id`,
    [p.replacementId],
  );
  revived += r.rowCount;
}
await db.query("COMMIT");
console.log(`\nAPPLIED: locked ${locked} winners, revived ${revived} replacements.`);
await db.end();
