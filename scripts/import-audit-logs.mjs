/**
 * Import audit_log.csv into audit_logs.
 *
 * CSV header (24 cols):
 *   timestamp, client_id, biz_name, campaign_id, campaign_name, keyword,
 *   platform, mode, device, status, duration_s, rank_position, rank_total,
 *   mentioned, rank_context, screenshot, response_text, error,
 *   proxy_ip, proxy_city, proxy_region, proxy_zip, prompt, variant_id
 *
 * Quirks of the CSV vs the admin schema:
 *   - client_id is "0" for every row → backfill from keywords table
 *   - campaign_id is empty → backfill from keywords.aeo_plan_id
 *   - variant_id is keyword_variants.id (FK) → resolve to variant_text snapshot
 *   - platform is TitleCase → lowercase before insert
 *
 * Lookup: by (keyword_text, biz_name) since campaign_id is missing in the CSV.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/import-audit-logs.mjs <csv-file>
 */
import fs from "fs";
import pg from "pg";

const csvPath = process.argv[2];
if (!csvPath) { console.error("Usage: node import-audit-logs.mjs <csv-file>"); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }

const { Client } = pg;
const client = new Client({
  connectionString: url,
  ssl: url.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/* The CSV has multi-line response_text fields. We need a parser that walks
   character-by-character across the whole file rather than line-splitting first. */
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
const headerIdx = {};
for (let i = 0; i < header.length; i++) headerIdx[header[i]] = i;
function v(row, col) { return (row[headerIdx[col]] ?? "").trim(); }

console.log(`Parsed ${allRows.length - 1} data rows from CSV`);

/* keyword lookup keyed by (keyword_text + biz_name) since CSV lacks campaign_id.
   Falls back to keyword_text alone if biz match fails. */
const kwRes = await client.query(`
  SELECT k.id AS keyword_id, k.keyword_text, k.business_id, k.client_id, k.aeo_plan_id, b.name AS biz_name
  FROM keywords k
  LEFT JOIN businesses b ON b.id = k.business_id
`);
const kwByTextBiz = new Map();
const kwByText = new Map();
for (const k of kwRes.rows) {
  const t = (k.keyword_text ?? "").toLowerCase().trim();
  const b = (k.biz_name ?? "").toLowerCase().trim();
  const tb = `${t}|${b}`;
  kwByTextBiz.set(tb, k);
  if (!kwByText.has(t)) kwByText.set(t, k);
}

/* variant_id (CSV) → variant_text (admin) */
const varRes = await client.query("SELECT id, variant_text FROM keyword_variants");
const variantById = new Map();
for (const v of varRes.rows) variantById.set(String(v.id), v.variant_text);

let inserted = 0;
let missingKw = 0;
let missingVariant = 0;
const missingExamples = [];
const BATCH = 50;
let batch = [];

for (let i = 1; i < allRows.length; i++) {
  const row = allRows[i];
  if (row.length < 2) continue;

  const keyword     = v(row, "keyword");
  const bizName     = v(row, "biz_name");
  const tb = `${keyword.toLowerCase()}|${bizName.toLowerCase()}`;
  const kw = kwByTextBiz.get(tb) ?? kwByText.get(keyword.toLowerCase());

  if (!kw) {
    missingKw++;
    if (missingExamples.length < 5) missingExamples.push(`${keyword} | ${bizName}`);
    continue;
  }

  const variantId   = v(row, "variant_id");
  const variantText = variantId ? variantById.get(variantId) ?? null : null;
  if (variantId && !variantText) missingVariant++;

  const platformRaw = v(row, "platform");
  const platform    = platformRaw ? platformRaw.toLowerCase() : null;
  const status      = v(row, "status") || null;
  const ts          = v(row, "timestamp");
  // Pass timestamp as a UTC ISO string so pg writes the UTC components
  // verbatim into a `timestamp without time zone` column. Wrapping in a
  // JS Date causes pg-node to emit local-time components, leaking the
  // client TZ into the stored value.
  const timestamp   = ts ? ts.replace(" ", "T") + "Z" : null;
  const durSec      = v(row, "duration_s");
  const rank        = v(row, "rank_position");
  const rankTot     = v(row, "rank_total");

  const auditRecord = {
    client_id:        kw.client_id,
    business_id:      kw.business_id,
    campaign_id:      kw.aeo_plan_id,
    keyword_id:       kw.keyword_id,
    biz_name:         bizName || kw.biz_name || null,
    campaign_name:    v(row, "campaign_name") || null,
    keyword_text:     keyword,
    keyword_variant:  variantText,
    timestamp,
    platform,
    mode:             v(row, "mode") || null,
    device:           v(row, "device") || null,
    status,
    duration_seconds: durSec ? parseFloat(durSec) : null,
    rank_position:    rank && /^\d+$/.test(rank)    ? parseInt(rank, 10)    : null,
    rank_total:       rankTot && /^\d+$/.test(rankTot) ? parseInt(rankTot, 10) : null,
    mentioned:        v(row, "mentioned") || null,
    rank_context:     v(row, "rank_context") || null,
    screenshot_path:  v(row, "screenshot") || null,
    response_text:    v(row, "response_text") || null,
    prompt:           v(row, "prompt") || null,
    error:            v(row, "error") || null,
    proxy_ip:         v(row, "proxy_ip") || null,
    proxy_city:       v(row, "proxy_city") || null,
    proxy_region:     v(row, "proxy_region") || null,
    proxy_zip:        v(row, "proxy_zip") || null,
  };

  // ranking_reports row: same data, mapped to that schema. This is what the
  // Rankings page reads to compute "current vs initial" — must be written for
  // the comparison to surface the audit run.
  const dateOnly = ts ? ts.slice(0, 10) : null;
  const rankingRecord = {
    client_id:         kw.client_id,
    business_id:       kw.business_id,
    keyword_id:        kw.keyword_id,
    client_name:       null,
    biz_name:          bizName || kw.biz_name || null,
    search_address:    null,
    keyword:           keyword,
    timestamp,
    date:              dateOnly,
    platform,
    device_identifier: v(row, "device") || null,
    status,
    duration_seconds:  durSec ? parseFloat(durSec) : null,
    ranking_position:  rank && /^\d+$/.test(rank) ? parseInt(rank, 10) : null,
    ranking_total:     rankTot || null,
    proxy_ip:          v(row, "proxy_ip") || null,
    proxy_city:        v(row, "proxy_city") || null,
    proxy_region:      v(row, "proxy_region") || null,
    proxy_zip:         v(row, "proxy_zip") || null,
    is_initial_ranking: false,
  };

  batch.push({ audit: auditRecord, ranking: rankingRecord });
  if (batch.length >= BATCH) { await flush(); }
}
if (batch.length > 0) await flush();

async function flushTable(table, records) {
  const cols = Object.keys(records[0]);
  const values = [];
  const placeholders = records.map((r, ri) => {
    const vs = cols.map((c, ci) => `$${ri * cols.length + ci + 1}`);
    cols.forEach((c) => values.push(r[c]));
    return `(${vs.join(",")})`;
  });
  await client.query(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES ${placeholders.join(",")}`,
    values,
  );
}

async function flush() {
  await flushTable("audit_logs",      batch.map((b) => b.audit));
  await flushTable("ranking_reports", batch.map((b) => b.ranking));
  inserted += batch.length;
  batch = [];
}

console.log(`Inserted: ${inserted}`);
console.log(`Skipped (missing keyword): ${missingKw}`);
if (missingExamples.length > 0) {
  console.log(`  examples:`);
  for (const e of missingExamples) console.log(`    ${e}`);
}
console.log(`Variant_id without matching keyword_variants row: ${missingVariant}`);
await client.end();
