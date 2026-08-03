/* Propose a campaign (aeo_plan_id) for each ACTIVE orphan keyword.
 * READ-ONLY — writes a proposal CSV only, never touches the DB.
 *
 * Resolution order, strongest evidence first:
 *   1. TWIN      an identically-texted keyword on the same business that
 *                already has a plan — the admin already made this call.
 *   2. LOCATION  a city/neighbourhood token from the plan's name/address
 *                appears in the keyword text.
 *   3. ONLY_PLAN the business has exactly one campaign.
 *   else AMBIGUOUS — left for a human.
 *
 * Output: orphan-plan-proposal-<today>.csv
 */
import fs from "node:fs";
import pg from "pg";
import { execSync } from "node:child_process";

const OUT = "orphan-plan-proposal-2026-08-01.csv";
const s = JSON.parse(execSync("aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --query SecretString --output text", { encoding: "utf8" }));
const c = new pg.Client({ connectionString: s.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const orphans = (await c.query(
  `SELECT k.id, k.client_id, k.business_id, k.keyword_text, k.status, b.name biz
   FROM keywords k LEFT JOIN businesses b ON b.id = k.business_id
   WHERE k.aeo_plan_id IS NULL AND k.is_active
   ORDER BY k.business_id, k.id`,
)).rows;

const plans = (await c.query(
  `SELECT id, client_id, business_id, name, search_address FROM client_aeo_plans ORDER BY id`,
)).rows;
const plansByBiz = new Map();
for (const p of plans) {
  const arr = plansByBiz.get(p.business_id) ?? [];
  arr.push(p);
  plansByBiz.set(p.business_id, arr);
}

/* Location tokens for a plan: everything after the em-dash in the name, plus
   the search_address. Split into words so "Beverly Hills" and "Brickell" both
   become matchable phrases. */
const NEIGHBOURHOOD_PARENT = {
  // neighbourhood / sub-market in a keyword -> token that identifies its plan
  wynwood: "miami",
  brickell: "brickell",
  "coral gables": "miami",
  "santa monica": "beverly hills",
  "west la": "beverly hills",
  "west los angeles": "beverly hills",
  "los angeles": "beverly hills",
  la: "beverly hills",
};
const norm = (x) => (x ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function locationPhrases(plan) {
  const tail = norm(String(plan.name).split("—").slice(1).join(" "));
  const addr = norm(plan.search_address);
  const blob = `${tail} ${addr}`;
  /* keep multi-word place names: split on commas/street numbers */
  return blob
    .split(/[,/]|\d+[a-z]*\s/)
    .map((x) => norm(x).replace(/\b(st|ave|blvd|rd|dr|ste|pkwy|hwy|n|s|e|w|nw|ne|sw|se)\b/g, "").trim())
    .filter((x) => x.length >= 3);
}

const rows = [];
let twin = 0, loc = 0, only = 0, amb = 0;
for (const o of orphans) {
  const cands = plansByBiz.get(o.business_id) ?? [];
  let pick = null, via = null;

  // 1. twin
  const t = await c.query(
    `SELECT aeo_plan_id, COUNT(*)::int n FROM keywords
     WHERE business_id = $1 AND lower(keyword_text) = lower($2) AND aeo_plan_id IS NOT NULL
     GROUP BY 1`,
    [o.business_id, o.keyword_text],
  );
  if (t.rows.length === 1) { pick = t.rows[0].aeo_plan_id; via = "TWIN"; twin++; }

  // 2. location token in the keyword text
  if (!pick) {
    const kt = norm(o.keyword_text);
    let hint = null;
    for (const [nb, parent] of Object.entries(NEIGHBOURHOOD_PARENT))
      if (kt.includes(nb)) { hint = parent; break; }
    const hits = cands.filter((p) =>
      locationPhrases(p).some((ph) => kt.includes(ph) || (hint && ph.includes(hint))),
    );
    if (hits.length === 1) { pick = hits[0].id; via = "LOCATION"; loc++; }
  }

  // 3. business has exactly one plan
  if (!pick && cands.length === 1) { pick = cands[0].id; via = "ONLY_PLAN"; only++; }

  if (!pick) { via = "AMBIGUOUS"; amb++; }
  const planRow = plans.find((p) => p.id === pick);
  rows.push({
    keyword_id: o.id,
    client_id: o.client_id,
    business_id: o.business_id,
    biz: o.biz,
    keyword_text: o.keyword_text,
    status: o.status,
    proposed_plan_id: pick ?? "",
    proposed_plan_name: planRow ? planRow.name : "",
    via,
    plan_choices: cands.length,
  });
}

console.log(`active orphans: ${orphans.length}`);
console.log(`  TWIN=${twin}  LOCATION=${loc}  ONLY_PLAN=${only}  AMBIGUOUS=${amb}\n`);
for (const r of rows)
  console.log(
    `  kw ${String(r.keyword_id).padStart(4)} ${String(r.biz).slice(0, 16).padEnd(17)} ` +
      `"${String(r.keyword_text).slice(0, 44).padEnd(45)}" ${r.via.padEnd(10)} ` +
      `${r.proposed_plan_id ? `plan ${r.proposed_plan_id} — ${String(r.proposed_plan_name).split("—").slice(1).join("—").trim().slice(0, 34)}` : "** needs human **"}`,
  );

const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const hdr = Object.keys(rows[0]);
fs.writeFileSync(OUT, [hdr.join(","), ...rows.map((r) => hdr.map((h) => esc(r[h])).join(","))].join("\n"));
console.log(`\nproposal written: ${OUT}`);
await c.end();
