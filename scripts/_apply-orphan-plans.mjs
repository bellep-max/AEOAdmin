/* Backfill aeo_plan_id on the 45 active orphan keywords. DRY-RUN BY DEFAULT.
 *
 *   node scripts/_apply-orphan-plans.mjs           # show plan, write nothing
 *   node scripts/_apply-orphan-plans.mjs --apply   # execute in one transaction
 *
 * Reads orphan-plan-proposal-2026-08-01.csv (produced by
 * _propose-orphan-plans.mjs) plus the three sibling-context resolutions below.
 * Before updating it snapshots the current value of every touched row to
 * orphan-plan-revert-2026-08-01.csv so the change can be undone exactly.
 *
 * Only ever sets aeo_plan_id, and only where it is currently NULL — it cannot
 * move a keyword that already belongs to a campaign.
 */
import fs from "node:fs";
import pg from "pg";
import { execSync } from "node:child_process";

const PROPOSAL = "orphan-plan-proposal-2026-08-01.csv";
const REVERT = "orphan-plan-revert-2026-08-01.csv";
const APPLY = process.argv.includes("--apply");

/* Resolved from batch context — see _diag-ambiguous-3.mjs */
const MANUAL = { 4861: 420, 4882: 421, 4887: 421 };

function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i+1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f); f = ""; if (row.length > 1) rows.push(row); row = []; }
    else if (ch !== "\r") f += ch; }
  if (row.length > 1) rows.push(row); return rows;
}
const raw = parseCsv(fs.readFileSync(PROPOSAL, "utf8"));
const hdr = raw[0];
const proposal = raw.slice(1).map((r) => Object.fromEntries(hdr.map((h, i) => [h, (r[i] ?? "").trim()])));

const targets = [];
for (const p of proposal) {
  const kid = parseInt(p.keyword_id, 10);
  const planId = p.proposed_plan_id ? parseInt(p.proposed_plan_id, 10) : MANUAL[kid];
  if (!planId) { console.log(`  UNRESOLVED kw ${kid} "${p.keyword_text}" — skipping`); continue; }
  targets.push({ keywordId: kid, planId, text: p.keyword_text, biz: p.biz, via: p.via === "AMBIGUOUS" ? "SIBLING" : p.via });
}
console.log(`resolved targets: ${targets.length} / ${proposal.length}`);

const s = JSON.parse(execSync("aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --query SecretString --output text", { encoding: "utf8" }));
const c = new pg.Client({ connectionString: s.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

/* Validate every destination plan belongs to the same business as the keyword. */
let invalid = 0;
for (const t of targets) {
  const r = await c.query(
    `SELECT k.business_id kb, k.aeo_plan_id cur, p.business_id pb, p.name
     FROM keywords k, client_aeo_plans p WHERE k.id = $1 AND p.id = $2`,
    [t.keywordId, t.planId],
  );
  if (r.rows.length === 0) { console.log(`  INVALID kw ${t.keywordId} -> plan ${t.planId} (missing)`); invalid++; continue; }
  const row = r.rows[0];
  if (row.cur !== null) { console.log(`  SKIP kw ${t.keywordId} already on plan ${row.cur}`); t.skip = true; continue; }
  if (row.kb !== row.pb) { console.log(`  INVALID kw ${t.keywordId} business ${row.kb} != plan business ${row.pb}`); invalid++; t.skip = true; }
  t.planName = row.name;
}
const go = targets.filter((t) => !t.skip);
console.log(`validated: ${go.length} to update, ${invalid} invalid`);
if (invalid > 0) { console.log("ABORT — fix invalid rows first."); await c.end(); process.exit(1); }

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. ${go.length} keywords would get aeo_plan_id set.`);
  const byPlan = {};
  for (const t of go) byPlan[`${t.planId} ${String(t.planName).slice(0, 44)}`] = (byPlan[`${t.planId} ${String(t.planName).slice(0, 44)}`] ?? 0) + 1;
  for (const [k, n] of Object.entries(byPlan)) console.log(`   plan ${k}: ${n}`);
  await c.end(); process.exit(0);
}

/* snapshot for exact revert */
const snap = await c.query(
  `SELECT id, aeo_plan_id FROM keywords WHERE id = ANY($1::int[])`,
  [go.map((t) => t.keywordId)],
);
fs.writeFileSync(REVERT, ["keyword_id,previous_aeo_plan_id", ...snap.rows.map((r) => `${r.id},${r.aeo_plan_id ?? ""}`)].join("\n"));
console.log(`revert snapshot written: ${REVERT}`);

await c.query("BEGIN");
try {
  let n = 0;
  for (const t of go) {
    const r = await c.query(
      `UPDATE keywords SET aeo_plan_id = $1 WHERE id = $2 AND aeo_plan_id IS NULL`,
      [t.planId, t.keywordId],
    );
    n += r.rowCount;
  }
  await c.query("COMMIT");
  console.log(`updated: ${n}`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLED BACK:", e.message);
  await c.end();
  process.exit(1);
}

const left = await c.query(`SELECT COUNT(*)::int n FROM keywords WHERE aeo_plan_id IS NULL AND is_active`);
console.log(`active orphans remaining: ${left.rows[0].n}`);
await c.end();
