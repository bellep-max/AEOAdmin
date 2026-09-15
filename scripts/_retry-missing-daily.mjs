/* Generalized gap-filler for a daily-sessions CSV. DRY-RUN BY DEFAULT.
 *
 *   node scripts/_retry-missing-daily.mjs <csv> <YYYY-MM-DD> [--apply]
 *
 * Finds CSV rows with no matching session in prod and inserts only those.
 * Resolves each row's keyword the way the producer encodes it:
 *
 *   campaign_id IS a real client_aeo_plans.id
 *       -> keyword = (lower(keyword_text), aeo_plan_id = campaign_id)
 *   campaign_id is synthesized (keyword had no plan at run time)
 *       -> campaign_id = business_id ++ zero-padded-4 keyword_id
 *          decode it and use that exact keyword id
 *
 * The decode is what makes this exact: it names the keyword that actually ran,
 * rather than guessing from keyword text (which repeats across campaigns).
 */
import fs from "node:fs";
import pg from "pg";
import { execSync } from "node:child_process";

const CSV = process.argv[2];
const DATE = process.argv[3];
const APPLY = process.argv.includes("--apply");
if (!CSV || !/^\d{4}-\d{2}-\d{2}$/.test(DATE ?? "")) {
  console.error("usage: _retry-missing-daily.mjs <csv> <YYYY-MM-DD> [--apply]");
  process.exit(1);
}

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
const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const hdr = raw[0];
const csvRows = raw.slice(1).map((r, i) => ({
  ...Object.fromEntries(hdr.map((h, j) => [h, (r[j] ?? "").trim()])),
  _row: i + 1,
}));
const v = (row, k) => (row[k] ?? "").trim();

const secret = JSON.parse(execSync("aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --query SecretString --output text", { encoding: "utf8" }));
const API_BASE = process.env.API_BASE ?? "https://jjm59vpn3y.us-east-1.awsapprunner.com";
const TOKEN = secret.EXECUTOR_TOKEN;
const db = new pg.Client({ connectionString: secret.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const sess = await db.query(
  `SELECT client_id, lower(ai_platform) p, to_char(timestamp,'YYYY-MM-DD"T"HH24:MI:SS') ts
   FROM sessions WHERE timestamp >= $1::timestamp AND timestamp < ($1::timestamp + interval '1 day')`,
  [DATE],
);
const have = new Set(sess.rows.map((r) => `${r.client_id}|${r.p}|${r.ts}`));
const norm = (t) => t.replace(" ", "T").replace(/Z$/, "").slice(0, 19);
const missing = csvRows.filter(
  (r) => !have.has(`${parseInt(v(r, "client_id"), 10)}|${v(r, "platform").toLowerCase()}|${norm(v(r, "timestamp"))}`),
);
console.log(`${DATE}: csv=${csvRows.length} inProd=${sess.rows.length} missing=${missing.length}`);
if (missing.length === 0) { await db.end(); process.exit(0); }

const realPlans = new Set(
  (await db.query(`SELECT id FROM client_aeo_plans`)).rows.map((r) => r.id),
);
/* keyword lookup keyed both ways */
const kwRows = (await db.query(
  `SELECT id, client_id, business_id, aeo_plan_id, lower(keyword_text) t FROM keywords`,
)).rows;
const byPlanText = new Map();
const bySynth = new Map();
for (const k of kwRows) {
  if (k.aeo_plan_id != null) byPlanText.set(`${k.t}|${k.aeo_plan_id}`, k);
  bySynth.set(`${k.business_id}${String(k.id).padStart(4, "0")}`, k);
}

const planned = [], skipped = [];
for (const r of missing) {
  const cid = parseInt(v(r, "campaign_id"), 10);
  const text = v(r, "keyword").toLowerCase();
  let hit = null, via = null;
  if (Number.isFinite(cid) && realPlans.has(cid)) {
    hit = byPlanText.get(`${text}|${cid}`) ?? null;
    via = "PLAN";
  }
  if (!hit && Number.isFinite(cid)) {
    const dec = bySynth.get(String(cid));
    if (dec && dec.t === text) { hit = dec; via = "DECODE"; }
  }
  if (hit) planned.push({ row: r, hit, via });
  else skipped.push({ row: r, cid });
}
console.log(`resolvable: ${planned.length}  (PLAN=${planned.filter((p) => p.via === "PLAN").length} DECODE=${planned.filter((p) => p.via === "DECODE").length})`);
console.log(`unresolvable: ${skipped.length}`);
for (const s of skipped.slice(0, 20))
  console.log(`   SKIP row ${s.row._row} c${v(s.row, "client_id")} campaign_id=${s.cid} "${v(s.row, "keyword").slice(0, 44)}"`);

if (!APPLY) {
  console.log(`\nDRY RUN — nothing sent. --apply would POST ${planned.length} rows.`);
  await db.end(); process.exit(0);
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Executor-Token": TOKEN },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

let ok = 0, failed = 0; const errs = [];
for (const p of planned) {
  const row = p.row, status = v(row, "status");
  try {
    await postJson("/api/sessions", {
      clientId: parseInt(v(row, "client_id"), 10) || p.hit.client_id,
      businessId: p.hit.business_id,
      campaignId: p.hit.aeo_plan_id,
      keywordId: p.hit.id,
      clientName: v(row, "client_name") || null,
      bizName: v(row, "biz_name") || null,
      campaignName: v(row, "campaign_name") || null,
      keywordText: v(row, "keyword"),
      keywordVariant: v(row, "keyword_variant") || null,
      timestamp: v(row, "timestamp") || null,
      date: v(row, "date") || null,
      durationSeconds: parseFloat(v(row, "duration_s")) || null,
      promptText: v(row, "prompt") || null,
      followupText: v(row, "follow_up") || null,
      hasFollowUp: v(row, "has_follow_up") === "True",
      status,
      type: "aeo",
      aiPlatform: v(row, "platform") || "unknown",
      errorClass: status === "error" ? v(row, "failure_step") || "unknown" : null,
      errorMessage: status === "error" ? v(row, "error") || null : null,
      proxyStatus: v(row, "proxy_status") || null,
      proxyUsername: v(row, "proxy_username") || null,
      proxyHost: v(row, "proxy_host") || null,
      proxyPort: parseInt(v(row, "proxy_port"), 10) || null,
      deviceIdentifier: v(row, "device_id") || null,
      baseLatitude: parseFloat(v(row, "base_latitude")) || null,
      baseLongitude: parseFloat(v(row, "base_longitude")) || null,
      mockedLatitude: parseFloat(v(row, "mocked_latitude")) || null,
      mockedLongitude: parseFloat(v(row, "mocked_longitude")) || null,
      mockedTimezone: v(row, "mocked_timezone") || null,
      backlinksExpected: parseInt(v(row, "backlinks_expected"), 10) || 0,
      backlinkInjected: v(row, "backlink_injected") === "True",
      backlinkFound: v(row, "backlink_found") === "True",
      backlinkUrl: v(row, "backlink_url") || null,
    });
    ok++;
  } catch (e) { failed++; if (errs.length < 8) errs.push(`row ${row._row}: ${e.message}`); }
}
console.log(`\ninserted: ${ok}  failed: ${failed}`);
for (const e of errs) console.log(`   ${e}`);
const after = await db.query(
  `SELECT COUNT(*)::int n FROM sessions WHERE timestamp >= $1::timestamp AND timestamp < ($1::timestamp + interval '1 day')`,
  [DATE],
);
console.log(`prod sessions on ${DATE}: ${after.rows[0].n} / csv ${csvRows.length}`);
await db.end();
