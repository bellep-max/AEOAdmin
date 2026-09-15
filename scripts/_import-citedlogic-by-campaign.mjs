/**
 * One-off Citedlogic (client 259) import.
 *
 * WHY a special importer: this client has ~84 keywords that SHARE their text
 * (same wording, different campaigns/plans). The standard importer resolves
 * keyword_id by TEXT, so it would collapse those into one and lose rows. This
 * CSV instead encodes the real keyword_id in campaign_id: keyword_id =
 * campaign_id - 2800000. We resolve by that, so every row maps to its true
 * keyword. Verified: all 125 derived keyword_ids exist and belong to client 259,
 * and all 372 rows are unique (keyword_id, platform).
 *
 * Also pins every row's date to PIN_DATE (baseline / "initial rank"), preserving
 * the HH:MM:SS. Safe: no (keyword_id, platform) collisions even on one date.
 *
 * Usage: API_BASE=… EXECUTOR_TOKEN=… DATABASE_URL=… node scripts/_import-citedlogic-by-campaign.mjs <csv>
 */
import fs from "fs";
import pg from "pg";

const CAMPAIGN_OFFSET = 2800000;
const PIN_DATE = "2026-06-30";
const csvPath = process.argv[2];
if (!csvPath) { console.error("Usage: node _import-citedlogic-by-campaign.mjs <csv>"); process.exit(1); }
const apiBase = (process.env.API_BASE ?? "").replace(/\/$/, "");
const token = process.env.EXECUTOR_TOKEN;
const dbUrl = process.env.DATABASE_URL;
if (!apiBase || !token || !dbUrl) { console.error("API_BASE, EXECUTOR_TOKEN, DATABASE_URL required"); process.exit(1); }

const { Client } = pg;
const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await db.connect();

function parseCSV(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

const allRows = parseCSV(fs.readFileSync(csvPath, "utf-8")).filter((r) => r.length > 1 || (r.length === 1 && r[0].length > 0));
const header = allRows[0];
const H = Object.fromEntries(header.map((h, i) => [h, i]));
const v = (r, c) => (r[H[c]] ?? "").trim();
console.log(`Parsed ${allRows.length - 1} data rows; pinning date -> ${PIN_DATE}`);

const kwRes = await db.query(
  `SELECT k.id AS keyword_id, k.keyword_text, k.business_id, k.client_id, k.aeo_plan_id, b.name AS biz_name
     FROM keywords k LEFT JOIN businesses b ON b.id = k.business_id
    WHERE k.client_id = 259`,
);
const kwById = new Map(kwRes.rows.map((k) => [k.keyword_id, k]));

const varRes = await db.query("SELECT id, variant_text FROM keyword_variants");
const variantById = new Map(varRes.rows.map((x) => [String(x.id), x.variant_text]));
await db.end();

function toIsoZ(s) { s = s.trim().replace(" ", "T"); return /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z"; }
function toRankingStatus(raw) { if (!raw) return null; if (raw === "success" || raw === "error") return raw; return raw === "no_rank" ? "success" : "error"; }
async function postJson(path, payload) {
  const res = await fetch(`${apiBase}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Executor-Token": token }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const createdAt = `${PIN_DATE}T12:00:00Z`;
let auditOk = 0, auditFail = 0, rankOk = 0, rankFail = 0, missingKw = 0;
const failures = [];

for (let i = 1; i < allRows.length; i++) {
  const row = allRows[i];
  if (row.length < 2) continue;

  const campaignId = parseInt(v(row, "campaign_id"), 10);
  const kid = campaignId - CAMPAIGN_OFFSET;
  const kw = kwById.get(kid);
  if (!kw) { missingKw++; if (failures.length < 10) failures.push(`row ${i}: keyword_id ${kid} (campaign ${campaignId}) not found for client 259`); continue; }

  const keyword = v(row, "keyword");
  const bizName = v(row, "biz_name");
  const variantId = v(row, "variant_id");
  const variantText = variantId ? (variantById.get(variantId) ?? null) : null;
  const platform = v(row, "platform") || null;
  const hhmmss = v(row, "timestamp").slice(11); // keep clock, swap date
  const timestamp = toIsoZ(`${PIN_DATE}T${hhmmss}`);
  const rank = v(row, "rank_position");
  const rankTotal = v(row, "rank_total");
  const dur = v(row, "duration_s");

  const auditPayload = {
    clientId: kw.client_id, businessId: kw.business_id, campaignId: kw.aeo_plan_id, keywordId: kw.keyword_id,
    bizName: bizName || kw.biz_name || null, campaignName: v(row, "campaign_name") || null,
    keywordText: keyword, keywordVariant: variantText, timestamp, platform,
    mode: v(row, "mode") || null, device: v(row, "device") || null, status: v(row, "status") || null,
    durationSeconds: dur ? parseFloat(dur) : null,
    rankPosition: rank && /^\d+$/.test(rank) ? parseInt(rank, 10) : null,
    rankTotal: rankTotal && /^\d+$/.test(rankTotal) ? parseInt(rankTotal, 10) : null,
    mentioned: v(row, "mentioned") || null, rankContext: v(row, "rank_context") || null,
    screenshotPath: v(row, "screenshot") || null, responseText: v(row, "response_text") || null,
    prompt: v(row, "prompt") || null, error: v(row, "error") || null,
    proxyIp: v(row, "proxy_ip") || null, proxyCity: v(row, "proxy_city") || null,
    proxyRegion: v(row, "proxy_region") || null, proxyZip: v(row, "proxy_zip") || null,
  };
  const rankingPayload = {
    clientId: kw.client_id, businessId: kw.business_id, keywordId: kw.keyword_id,
    bizName: bizName || kw.biz_name || null, keyword, keywordVariant: variantText,
    timestamp, date: PIN_DATE, platform, deviceIdentifier: v(row, "device") || null,
    status: toRankingStatus(v(row, "status")), durationSeconds: dur ? parseFloat(dur) : null,
    rankingPosition: rank && /^\d+$/.test(rank) ? parseInt(rank, 10) : null,
    rankingTotal: rankTotal || null,
    proxyIp: v(row, "proxy_ip") || null, proxyCity: v(row, "proxy_city") || null,
    proxyRegion: v(row, "proxy_region") || null, proxyZip: v(row, "proxy_zip") || null,
    isInitialRanking: false, createdAt,
  };

  if (process.env.SKIP_AUDIT_LOGS !== "1") {
    try { await postJson("/api/audit-logs", auditPayload); auditOk++; }
    catch (e) { auditFail++; if (failures.length < 10) failures.push(`audit row ${i}: ${e.message}`); }
  }
  if (process.env.SKIP_RANKING_REPORTS !== "1") {
    try { await postJson("/api/ranking-reports", rankingPayload); rankOk++; }
    catch (e) { rankFail++; if (failures.length < 10) failures.push(`ranking row ${i}: ${e.message}`); }
  }
  if (i % 50 === 0) console.log(`  progress: ${i}/${allRows.length - 1}`);
}

console.log("\n=== summary ===");
console.log(`audit_logs:      ${auditOk} ok, ${auditFail} failed`);
console.log(`ranking_reports: ${rankOk} ok, ${rankFail} failed`);
console.log(`missing keyword: ${missingKw}`);
if (failures.length) { console.log("\nfailures:"); for (const f of failures) console.log(`  ${f}`); }
