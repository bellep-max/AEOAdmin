/**
 * Import audit_log.csv via the admin API (Option B path).
 *
 * Posts each row to:
 *   - POST /api/audit-logs        (X-Executor-Token)
 *   - POST /api/ranking-reports   (X-Executor-Token, upsert per kw+plat+date)
 *
 * Why this script (vs. the older direct-DB write):
 *   - The API already lowercases platform on write.
 *   - The API already upserts ranking_reports per (keyword, platform, date)
 *     so re-running this on the same CSV is idempotent — no dupes.
 *   - The API resolves keywordId / variantText / business linkage from the
 *     payload; we just pass strings + ids and rules apply uniformly.
 *
 * Usage:
 *   API_BASE=https://jjm59vpn3y.us-east-1.awsapprunner.com \
 *   EXECUTOR_TOKEN=... \
 *   DATABASE_URL=...           # only used to resolve keyword_id + variant_id
 *   node scripts/import-audit-logs-api.mjs <csv-file>
 */
import fs from "fs";
import pg from "pg";

const csvPath = process.argv[2];
if (!csvPath) { console.error("Usage: node import-audit-logs-api.mjs <csv-file>"); process.exit(1); }

const apiBase = (process.env.API_BASE ?? "").replace(/\/$/, "");
if (!apiBase) { console.error("API_BASE required"); process.exit(1); }
const token = process.env.EXECUTOR_TOKEN;
if (!token) { console.error("EXECUTOR_TOKEN required"); process.exit(1); }
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error("DATABASE_URL required (for keyword + variant lookup)"); process.exit(1); }

/* DB only used for FK resolution — never for INSERTs. */
const { Client } = pg;
const db = new Client({
  connectionString: dbUrl,
  ssl: dbUrl.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : undefined,
});
await db.connect();

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else { cur += ch; }
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

const csvText = fs.readFileSync(csvPath, "utf-8");
const allRows = parseCSV(csvText).filter((r) => r.length > 1 || (r.length === 1 && r[0].length > 0));
const header = allRows[0];
const headerIdx = Object.fromEntries(header.map((h, i) => [h, i]));
const v = (r, c) => (r[headerIdx[c]] ?? "").trim();
console.log(`Parsed ${allRows.length - 1} data rows`);

const kwRes = await db.query(`
  SELECT k.id AS keyword_id, k.keyword_text, k.business_id, k.client_id, k.aeo_plan_id, b.name AS biz_name
  FROM keywords k LEFT JOIN businesses b ON b.id = k.business_id
`);
const kwByTextBiz = new Map();
const kwByText = new Map();
for (const k of kwRes.rows) {
  const t = (k.keyword_text ?? "").toLowerCase().trim();
  const b = (k.biz_name ?? "").toLowerCase().trim();
  kwByTextBiz.set(`${t}|${b}`, k);
  if (!kwByText.has(t)) kwByText.set(t, k);
}

const varRes = await db.query("SELECT id, variant_text FROM keyword_variants");
const variantById = new Map();
for (const v of varRes.rows) variantById.set(String(v.id), v.variant_text);

await db.end();

async function postJson(path, payload) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Executor-Token": token },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

let auditOk = 0, auditFail = 0;
let rankOk = 0, rankFail = 0;
let missingKw = 0;
const failures = [];

const dateAuditRunCreatedAt = (() => {
  /* All audit rows from the same CSV share a single representative
     created_at (noon UTC of the run date) so the Rankings 'latest run'
     filter groups all rows together. Computed from the first row's date. */
  for (let i = 1; i < allRows.length; i++) {
    const ts = (allRows[i][headerIdx["timestamp"]] ?? "").trim();
    if (ts) return ts.slice(0, 10) + "T12:00:00Z";
  }
  return null;
})();

for (let i = 1; i < allRows.length; i++) {
  const row = allRows[i];
  if (row.length < 2) continue;

  const keyword = v(row, "keyword");
  const bizName = v(row, "biz_name");
  const tb = `${keyword.toLowerCase()}|${bizName.toLowerCase()}`;
  const kw = kwByTextBiz.get(tb) ?? kwByText.get(keyword.toLowerCase());

  if (!kw) {
    missingKw++;
    continue;
  }

  const variantId = v(row, "variant_id");
  const variantText = variantId ? (variantById.get(variantId) ?? null) : null;

  const platform = (v(row, "platform") || null);  // server lowercases
  const ts = v(row, "timestamp");
  const timestamp = ts ? ts.replace(" ", "T") + "Z" : null;
  const dateOnly = ts ? ts.slice(0, 10) : null;
  const rank = v(row, "rank_position");
  const rankTotal = v(row, "rank_total");
  const dur = v(row, "duration_s");

  const auditPayload = {
    clientId:        kw.client_id,
    businessId:      kw.business_id,
    campaignId:      kw.aeo_plan_id,
    keywordId:       kw.keyword_id,
    bizName:         bizName || kw.biz_name || null,
    campaignName:    v(row, "campaign_name") || null,
    keywordText:     keyword,
    keywordVariant:  variantText,
    timestamp,
    platform,
    mode:            v(row, "mode") || null,
    device:          v(row, "device") || null,
    status:          v(row, "status") || null,
    durationSeconds: dur ? parseFloat(dur) : null,
    rankPosition:    rank && /^\d+$/.test(rank) ? parseInt(rank, 10) : null,
    rankTotal:       rankTotal && /^\d+$/.test(rankTotal) ? parseInt(rankTotal, 10) : null,
    mentioned:       v(row, "mentioned") || null,
    rankContext:     v(row, "rank_context") || null,
    screenshotPath:  v(row, "screenshot") || null,
    responseText:    v(row, "response_text") || null,
    prompt:          v(row, "prompt") || null,
    error:           v(row, "error") || null,
    proxyIp:         v(row, "proxy_ip") || null,
    proxyCity:       v(row, "proxy_city") || null,
    proxyRegion:     v(row, "proxy_region") || null,
    proxyZip:        v(row, "proxy_zip") || null,
  };

  const rankingPayload = {
    clientId:         kw.client_id,
    businessId:       kw.business_id,
    keywordId:        kw.keyword_id,
    bizName:          bizName || kw.biz_name || null,
    keyword:          keyword,
    keywordVariant:   variantText,
    timestamp,
    date:             dateOnly,
    platform,
    deviceIdentifier: v(row, "device") || null,
    status:           v(row, "status") || null,
    durationSeconds:  dur ? parseFloat(dur) : null,
    rankingPosition:  rank && /^\d+$/.test(rank) ? parseInt(rank, 10) : null,
    rankingTotal:     rankTotal || null,
    proxyIp:          v(row, "proxy_ip") || null,
    proxyCity:        v(row, "proxy_city") || null,
    proxyRegion:      v(row, "proxy_region") || null,
    proxyZip:         v(row, "proxy_zip") || null,
    isInitialRanking: false,
    createdAt:        dateAuditRunCreatedAt,
  };

  if (process.env.SKIP_AUDIT_LOGS !== "1") {
    try { await postJson("/api/audit-logs", auditPayload); auditOk++; }
    catch (e) { auditFail++; if (failures.length < 5) failures.push(`audit row ${i}: ${e.message}`); }
  }

  if (process.env.SKIP_RANKING_REPORTS !== "1") {
    try { await postJson("/api/ranking-reports", rankingPayload); rankOk++; }
    catch (e) { rankFail++; if (failures.length < 10) failures.push(`ranking row ${i}: ${e.message}`); }
  }

  if (i % 50 === 0) console.log(`  progress: ${i} / ${allRows.length - 1}`);
}

console.log("\n=== summary ===");
console.log(`audit_logs:      ${auditOk} ok, ${auditFail} failed`);
console.log(`ranking_reports: ${rankOk} ok, ${rankFail} failed`);
console.log(`missing keyword: ${missingKw}`);
if (failures.length > 0) {
  console.log("\nfirst failures:");
  for (const f of failures) console.log(`  ${f}`);
}
