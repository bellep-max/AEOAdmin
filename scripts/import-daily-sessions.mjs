import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2];
if (!csvPath) { console.error("Usage: node import-daily-sessions.mjs <csv-file>"); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }

const { Client } = pg;
const client = new Client({
  connectionString: url,
  ssl: url.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

// Parse CSV manually to handle quoted fields with commas
const csvText = fs.readFileSync(csvPath, "utf-8");
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
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

const lines = csvText.trim().split(/\r?\n/);
const header = parseCSVLine(lines[0]);
const headerIdx = {};
for (let i = 0; i < header.length; i++) headerIdx[header[i]] = i;

function v(row, col) { return row[headerIdx[col]] ?? ""; }

// Build keyword lookup map: keyword_text + campaign_id => keyword_id
const kwRes = await client.query("SELECT id, keyword_text, aeo_plan_id FROM keywords");
const kwMap = new Map();
for (const k of kwRes.rows) {
  const key = `${(k.keyword_text ?? "").toLowerCase().trim()}|${k.aeo_plan_id}`;
  kwMap.set(key, k.id);
}

// Also get business_id from keywords
const kwBizMap = new Map();
for (const k of kwRes.rows) {
  const key = `${(k.keyword_text ?? "").toLowerCase().trim()}|${k.aeo_plan_id}`;
  kwBizMap.set(key, k.id); // just need keyword id to later look up business
}

// Get keywords with business_id
const kwWithBiz = await client.query("SELECT id, keyword_text, aeo_plan_id, business_id FROM keywords");
const kwLookup = new Map();
for (const k of kwWithBiz.rows) {
  const key = `${(k.keyword_text ?? "").toLowerCase().trim()}|${k.aeo_plan_id}`;
  kwLookup.set(key, { keywordId: k.id, businessId: k.business_id });
}

let inserted = 0;
let skipped = 0;
let missingKw = 0;
const errors = [];

const BATCH_SIZE = 50;
let batch = [];

for (let i = 1; i < lines.length; i++) {
  const row = parseCSVLine(lines[i]);
  const keywordText = v(row, "keyword");
  const campaignId = parseInt(v(row, "campaign_id")) || null;
  const key = `${keywordText.toLowerCase().trim()}|${campaignId}`;
  const lookup = kwLookup.get(key);

  if (!lookup) {
    missingKw++;
    if (missingKw <= 5) console.log(`  Missing keyword: "${keywordText}" campaign=${campaignId}`);
    continue;
  }

  const status = v(row, "status");
  const duration = parseFloat(v(row, "duration_s")) || null;
  const hasFollowUp = v(row, "has_follow_up") === "True";
  const backlinkInjected = v(row, "backlink_injected") === "True";
  const backlinkFound = v(row, "backlink_found") === "True";
  const backlinksExpected = parseInt(v(row, "backlinks_expected")) || 0;
  const backlinkUrl = v(row, "backlink_url") || null;
  const errorMsg = v(row, "error") || null;

  const session = {
    client_id: parseInt(v(row, "client_id")) || null,
    business_id: lookup.businessId,
    campaign_id: campaignId,
    keyword_id: lookup.keywordId,
    client_name: v(row, "client_name") || null,
    biz_name: v(row, "biz_name") || null,
    campaign_name: v(row, "campaign_name") || null,
    keyword_text: keywordText,
    keyword_variant: v(row, "keyword_variant") || null,
    timestamp: v(row, "timestamp") || null,
    date: v(row, "date") || null,
    duration_seconds: duration,
    prompt_text: v(row, "prompt") || null,
    followup_text: v(row, "follow_up") || null,
    has_follow_up: hasFollowUp,
    status,
    type: "aeo",
    ai_platform: v(row, "platform") || "unknown",
    error_class: status === "error" ? (v(row, "failure_step") || "unknown") : null,
    error_message: status === "error" ? errorMsg : null,
    proxy_status: v(row, "proxy_status") || null,
    proxy_username: v(row, "proxy_username") || null,
    proxy_host: v(row, "proxy_host") || null,
    proxy_port: parseInt(v(row, "proxy_port")) || null,
    device_identifier: v(row, "device_id") || null,
    base_latitude: parseFloat(v(row, "base_latitude")) || null,
    base_longitude: parseFloat(v(row, "base_longitude")) || null,
    mocked_latitude: parseFloat(v(row, "mocked_latitude")) || null,
    mocked_longitude: parseFloat(v(row, "mocked_longitude")) || null,
    mocked_timezone: v(row, "mocked_timezone") || null,
    backlinks_expected: backlinksExpected,
    backlink_injected: backlinkInjected,
    backlink_found: backlinkFound,
    backlink_url: backlinkUrl,
  };

  batch.push(session);
  if (batch.length >= BATCH_SIZE) {
    await insertBatch(batch);
    inserted += batch.length;
    batch = [];
  }
}
if (batch.length > 0) {
  await insertBatch(batch);
  inserted += batch.length;
}

async function insertBatch(rows) {
  const cols = [
    "client_id", "business_id", "campaign_id", "keyword_id",
    "client_name", "biz_name", "campaign_name", "keyword_text", "keyword_variant",
    "timestamp", "date", "duration_seconds",
    "prompt_text", "followup_text", "has_follow_up",
    "status", "type", "ai_platform",
    "error_class", "error_message",
    "proxy_status", "proxy_username", "proxy_host", "proxy_port",
    "device_identifier",
    "base_latitude", "base_longitude",
    "mocked_latitude", "mocked_longitude", "mocked_timezone",
    "backlinks_expected", "backlink_injected", "backlink_found", "backlink_url",
  ];
  const placeholders = rows.map((_, i) => {
    const start = i * cols.length;
    return `(${cols.map((_, j) => `$${start + j + 1}`).join(", ")})`;
  }).join(", ");
  const values = rows.flatMap(r => cols.map(c => r[c]));

  await client.query(`INSERT INTO sessions (${cols.map(c => `"${c}"`).join(", ")}) VALUES ${placeholders}`, values);
}

console.log(`\nInserted: ${inserted}`);
console.log(`Skipped (missing keyword): ${missingKw}`);
if (errors.length > 0) console.log(`Errors: ${errors.length}`, errors.slice(0, 5));

await client.end();
