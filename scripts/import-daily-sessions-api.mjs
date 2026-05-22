/**
 * Import daily-sessions CSV via the admin API (Option B path).
 *
 * Posts each row to:
 *   - POST /api/sessions  (X-Executor-Token)
 *
 * The route already lowercases platform, accepts ISO timestamp strings,
 * coerces booleans, and bumps keyword backlink counters when backlink_found.
 *
 * Why not idempotent: POST /api/sessions does NOT upsert (every call inserts).
 * If you re-run on the same CSV you'll dupe. Delete same-day rows first if
 * you need a clean re-import:
 *   DELETE FROM sessions WHERE date='YYYY-MM-DD' AND ...
 *
 * Usage:
 *   API_BASE=https://jjm59vpn3y.us-east-1.awsapprunner.com \
 *   EXECUTOR_TOKEN=... \
 *   DATABASE_URL=...    # for FK resolution only
 *   node scripts/import-daily-sessions-api.mjs <csv-file>
 */
import fs from "fs";
import pg from "pg";

const csvPath = process.argv[2];
if (!csvPath) { console.error("Usage: node import-daily-sessions-api.mjs <csv-file>"); process.exit(1); }

const apiBase = (process.env.API_BASE ?? "").replace(/\/$/, "");
const token   = process.env.EXECUTOR_TOKEN;
const dbUrl   = process.env.DATABASE_URL;
if (!apiBase || !token || !dbUrl) {
  console.error("API_BASE, EXECUTOR_TOKEN, DATABASE_URL all required");
  process.exit(1);
}

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

/* (keyword_text + campaign_id) → { keywordId, businessId, clientId }
   We also preload businesses so we can populate clientId when the CSV
   leaves client_id blank. */
const bizRes = await db.query(`SELECT id, client_id FROM businesses`);
const bizClient = new Map(bizRes.rows.map((b) => [b.id, b.client_id]));

const kwRes = await db.query(`
  SELECT id, keyword_text, aeo_plan_id, business_id FROM keywords
`);
const kwLookup = new Map();
for (const k of kwRes.rows) {
  const key = `${(k.keyword_text ?? "").toLowerCase().trim()}|${k.aeo_plan_id}`;
  kwLookup.set(key, {
    keywordId: k.id,
    businessId: k.business_id,
    clientId: bizClient.get(k.business_id) ?? null,
  });
}

await db.end();

/* Dispatcher generates CHILD keywords by appending these suffixes to the
   admin's PARENT keyword text. Mirrors push_sessions_to_admin.py:214. */
const PARENT_SUFFIXES = [
  " reviews",
  " recommendations",
  " near me",
  " close to me",
];

/* Resolve a CSV keyword to admin's (keywordId, businessId, clientId):
     1) exact match on (text, campaign)
     2) strip a known suffix → match on (parent_text, campaign)
   Returns null when no parent exists either. */
function resolveKeyword(keyword, campaignId) {
  const lc = keyword.toLowerCase().trim();
  const exact = kwLookup.get(`${lc}|${campaignId}`);
  if (exact) return { hit: exact, via: "exact" };
  for (const suffix of PARENT_SUFFIXES) {
    if (lc.endsWith(suffix)) {
      const parent = lc.slice(0, -suffix.length).trim();
      const fallback = kwLookup.get(`${parent}|${campaignId}`);
      if (fallback) return { hit: fallback, via: `suffix:${suffix.trim()}` };
    }
  }
  return null;
}

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

let ok = 0, failed = 0, missingKw = 0;
let exactMatches = 0, suffixMatches = 0;
const suffixHits = new Map(); // suffix → count
const failures = [];
const unresolvedSamples = [];

for (let i = 1; i < allRows.length; i++) {
  const row = allRows[i];
  if (row.length < 2) continue;

  const keyword = v(row, "keyword");
  const campaignId = parseInt(v(row, "campaign_id"), 10) || null;
  const resolved = resolveKeyword(keyword, campaignId);
  if (!resolved) {
    missingKw++;
    if (unresolvedSamples.length < 10) {
      unresolvedSamples.push(`"${keyword}" (campaign ${campaignId}, biz ${v(row, "biz_name")})`);
    }
    continue;
  }
  if (resolved.via === "exact") exactMatches++;
  else {
    suffixMatches++;
    suffixHits.set(resolved.via, (suffixHits.get(resolved.via) ?? 0) + 1);
  }

  const status = v(row, "status");
  const ts = v(row, "timestamp");
  /* CSV may have blank client_id; derive from the matched keyword's business. */
  const csvClientId = parseInt(v(row, "client_id"), 10) || null;
  const clientId = csvClientId ?? resolved.hit.clientId;

  const payload = {
    clientId,
    businessId:       resolved.hit.businessId,
    campaignId,
    keywordId:        resolved.hit.keywordId,
    clientName:       v(row, "client_name") || null,
    bizName:          v(row, "biz_name") || null,
    campaignName:     v(row, "campaign_name") || null,
    keywordText:      keyword,
    keywordVariant:   v(row, "keyword_variant") || null,
    timestamp:        ts || null,                       // ISO string; server parses
    date:             v(row, "date") || null,
    durationSeconds:  parseFloat(v(row, "duration_s")) || null,
    promptText:       v(row, "prompt") || null,
    followupText:     v(row, "follow_up") || null,
    hasFollowUp:      v(row, "has_follow_up") === "True",
    status,
    type:             "aeo",
    aiPlatform:       v(row, "platform") || "unknown", // server lowercases
    errorClass:       status === "error" ? (v(row, "failure_step") || "unknown") : null,
    errorMessage:     status === "error" ? (v(row, "error") || null) : null,
    proxyStatus:      v(row, "proxy_status") || null,
    proxyUsername:    v(row, "proxy_username") || null,
    proxyHost:        v(row, "proxy_host") || null,
    proxyPort:        parseInt(v(row, "proxy_port"), 10) || null,
    deviceIdentifier: v(row, "device_id") || null,
    baseLatitude:     parseFloat(v(row, "base_latitude"))    || null,
    baseLongitude:    parseFloat(v(row, "base_longitude"))   || null,
    mockedLatitude:   parseFloat(v(row, "mocked_latitude"))  || null,
    mockedLongitude:  parseFloat(v(row, "mocked_longitude")) || null,
    mockedTimezone:   v(row, "mocked_timezone") || null,
    backlinksExpected: parseInt(v(row, "backlinks_expected"), 10) || 0,
    backlinkInjected:  v(row, "backlink_injected") === "True",
    backlinkFound:     v(row, "backlink_found") === "True",
    backlinkUrl:       v(row, "backlink_url") || null,
  };

  try { await postJson("/api/sessions", payload); ok++; }
  catch (e) { failed++; if (failures.length < 5) failures.push(`row ${i}: ${e.message}`); }

  if (i % 100 === 0) console.log(`  progress: ${i} / ${allRows.length - 1}`);
}

console.log("\n=== summary ===");
console.log(`sessions inserted:   ${ok}`);
console.log(`failed:              ${failed}`);
console.log(`missing keyword:     ${missingKw}`);
console.log(`  resolved by exact match:  ${exactMatches}`);
console.log(`  resolved by suffix strip: ${suffixMatches}`);
if (suffixHits.size > 0) {
  console.log("  suffix breakdown:");
  for (const [sfx, n] of suffixHits) console.log(`    ${sfx.padEnd(20)} ${n}`);
}
if (failures.length > 0) {
  console.log("\nfirst failures:");
  for (const f of failures) console.log(`  ${f}`);
}
if (unresolvedSamples.length > 0) {
  console.log("\nfirst unresolved keywords (no parent in admin):");
  for (const s of unresolvedSamples) console.log(`  ${s}`);
}
