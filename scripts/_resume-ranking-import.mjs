/* Resume the interrupted 2026-08-01 stale ranking import. DRY-RUN BY DEFAULT.
 *
 *   node scripts/_resume-ranking-import.mjs [--apply]
 *
 * The first run was killed after ~735 of 1810 rows. POST /api/audit-logs
 * APPENDS (no upsert), so re-running the whole file would duplicate every row
 * already in. This posts each table independently, skipping rows already
 * present:
 *   audit_logs      matched on (keyword_id, platform, timestamp)
 *   ranking_reports matched on (keyword_id, platform, date)
 * They are checked separately because the kill left them out of step (Jul 23
 * had 159 audit_logs against 158 ranking_reports).
 *
 * Keyword resolution uses the same decode as the patched importer.
 */
import fs from "node:fs";
import pg from "pg";
import { execSync } from "node:child_process";

const CSV = process.env.HOME + "/Desktop/Rankings/ranking_stale_2026-08-01_consolidated.csv";
const APPLY = process.argv.includes("--apply");

function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); f = ""; if (row.length > 1) rows.push(row); row = []; }
    else if (c !== "\r") f += c; }
  if (row.length > 1) rows.push(row); return rows;
}
const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const hdr = raw[0].map((h) => h.trim());
const rows = raw.slice(1).map((r) => Object.fromEntries(hdr.map((h, i) => [h, (r[i] ?? "").trim()])));
const v = (r, k) => (r[k] ?? "").trim();
const toIsoZ = (ts) => { if (!ts) return null; const s = ts.trim().replace(" ", "T"); return /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z"; };
const toRankingStatus = (r) => (!r ? null : r === "success" || r === "error" ? r : r === "no_rank" ? "success" : "error");

const secret = JSON.parse(execSync("aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --query SecretString --output text", { encoding: "utf8" }));
const API_BASE = process.env.API_BASE ?? "https://jjm59vpn3y.us-east-1.awsapprunner.com";
const TOKEN = secret.EXECUTOR_TOKEN;
const db = new pg.Client({ connectionString: secret.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const kwRes = await db.query(
  `SELECT k.id AS keyword_id, k.keyword_text, k.business_id, k.client_id, k.aeo_plan_id, b.name AS biz_name
   FROM keywords k LEFT JOIN businesses b ON b.id = k.business_id`,
);
const bySynth = new Map();
for (const k of kwRes.rows) bySynth.set(`${k.business_id}${String(k.keyword_id).padStart(4, "0")}`, k);
const variantById = new Map(
  (await db.query("SELECT id, variant_text FROM keyword_variants")).rows.map((r) => [String(r.id), r.variant_text]),
);

const dates = [...new Set(rows.map((r) => v(r, "date").slice(0, 10)))];
const haveRr = new Set((await db.query(
  `SELECT keyword_id, lower(platform) p, date FROM ranking_reports WHERE date = ANY($1::text[])`, [dates],
)).rows.map((r) => `${r.keyword_id}|${r.p}|${r.date}`));
const haveAl = new Set((await db.query(
  `SELECT keyword_id, lower(platform) p, to_char(timestamp,'YYYY-MM-DD"T"HH24:MI:SS') ts FROM audit_logs
   WHERE to_char(timestamp,'YYYY-MM-DD') = ANY($1::text[])`, [dates],
)).rows.map((r) => `${r.keyword_id}|${r.p}|${r.ts}`));

const work = [];
let unresolved = 0;
for (const r of rows) {
  const kw = bySynth.get(String(parseInt(v(r, "campaign_id"), 10)));
  const text = v(r, "keyword").toLowerCase();
  if (!kw || (kw.keyword_text ?? "").toLowerCase().trim() !== text) { unresolved++; continue; }
  const platform = v(r, "platform").toLowerCase();
  const date = v(r, "date").slice(0, 10);
  const tsKey = toIsoZ(v(r, "timestamp")).replace(/Z$/, "").slice(0, 19);
  work.push({
    r, kw, platform, date,
    needAl: !haveAl.has(`${kw.keyword_id}|${platform}|${tsKey}`),
    needRr: !haveRr.has(`${kw.keyword_id}|${platform}|${date}`),
  });
}
const nAl = work.filter((w) => w.needAl).length, nRr = work.filter((w) => w.needRr).length;
console.log(`rows ${rows.length}  unresolved ${unresolved}`);
console.log(`already present: audit_logs ${work.length - nAl}, ranking_reports ${work.length - nRr}`);
console.log(`to post:        audit_logs ${nAl}, ranking_reports ${nRr}`);
if (!APPLY) { console.log("\nDRY RUN — nothing sent."); await db.end(); process.exit(0); }

async function postJson(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Executor-Token": TOKEN },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
  return res.json();
}

let alOk = 0, alFail = 0, rrOk = 0, rrFail = 0; const errs = [];
let i = 0;
for (const w of work) {
  i++;
  const { r, kw, platform } = w;
  const ts = v(r, "timestamp");
  const timestamp = toIsoZ(ts);
  const variantId = v(r, "variant_id");
  const variantText = variantId ? (variantById.get(variantId) ?? null) : null;
  const rank = v(r, "rank_position"), rankTotal = v(r, "rank_total"), dur = v(r, "duration_s");
  const common = {
    clientId: kw.client_id, businessId: kw.business_id, keywordId: kw.keyword_id,
    bizName: v(r, "biz_name") || kw.biz_name || null, keywordVariant: variantText, timestamp,
    platform, durationSeconds: dur ? parseFloat(dur) : null,
    rankPosition: rank && /^\d+$/.test(rank) ? parseInt(rank, 10) : null,
    proxyIp: v(r, "proxy_ip") || null, proxyCity: v(r, "proxy_city") || null,
    proxyRegion: v(r, "proxy_region") || null, proxyZip: v(r, "proxy_zip") || null,
  };
  if (w.needAl) {
    try {
      await postJson("/api/audit-logs", {
        ...common, campaignId: kw.aeo_plan_id, campaignName: v(r, "campaign_name") || null,
        keywordText: v(r, "keyword"), mode: v(r, "mode") || null, device: v(r, "device") || null,
        status: v(r, "status") || null,
        rankTotal: rankTotal && /^\d+$/.test(rankTotal) ? parseInt(rankTotal, 10) : null,
        mentioned: v(r, "mentioned") || null, rankContext: v(r, "rank_context") || null,
        screenshotPath: v(r, "screenshot") || null, responseText: v(r, "response_text") || null,
        prompt: v(r, "prompt") || null, error: v(r, "error") || null,
      });
      alOk++;
    } catch (e) { alFail++; if (errs.length < 8) errs.push(`audit ${i}: ${e.message}`); }
  }
  if (w.needRr) {
    try {
      await postJson("/api/ranking-reports", {
        ...common, keyword: v(r, "keyword"), date: w.date,
        deviceIdentifier: v(r, "device") || null, status: toRankingStatus(v(r, "status")),
        rankingPosition: rank && /^\d+$/.test(rank) ? parseInt(rank, 10) : null,
        rankingTotal: rankTotal || null, isInitialRanking: false,
        createdAt: w.date + "T12:00:00Z",
      });
      rrOk++;
    } catch (e) { rrFail++; if (errs.length < 8) errs.push(`ranking ${i}: ${e.message}`); }
  }
  if (i % 200 === 0) console.log(`  progress ${i}/${work.length}  al+${alOk} rr+${rrOk}`);
}
console.log(`\naudit_logs:      ${alOk} ok, ${alFail} failed`);
console.log(`ranking_reports: ${rrOk} ok, ${rrFail} failed`);
for (const e of errs) console.log(`   ${e}`);
await db.end();
