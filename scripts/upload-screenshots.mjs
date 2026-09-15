/* Upload local run screenshots to S3 and set ranking_reports.screenshot_url.
 *
 * The API importer (import-audit-logs-api.mjs) posts the CSV's `screenshot`
 * path to /api/audit-logs only — ranking_reports never gets a URL, and nothing
 * uploads the file. So a row can be marked verified yet produce no proof: the
 * GHL sync requires screenshot_rank_visible = true AND the S3 object to exist
 * (sales.ts). Run this after every import.
 *
 * Matching: (keyword_id, platform) + the CSV rank must equal the stored rank.
 * NOT the CSV timestamp's date — rows get re-dated to the run date, so the CSV
 * date and the stored date legitimately differ. The rank check is what stops a
 * keyword's other run from supplying the image (a stale capture attached to a
 * newer row would put an old screenshot in a client's proof email).
 *
 * usage:
 *   DATABASE_URL=... AWS_PROFILE=aeo-admin node scripts/upload-screenshots.mjs \
 *     --csv=/path/a.csv,/path/b.csv --dates=2026-07-17,2026-07-15 [--apply]
 *
 * Dry-run by default; --apply uploads and writes.
 */
import fs from "node:fs";
import { existsSync, createReadStream } from "node:fs";
import pg from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1114, (v) => v);

const BUCKET = "aeo-rank-screenshots";
const CONCURRENCY = 8;

const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : null;
};
const APPLY = process.argv.includes("--apply");
const CSVS = (arg("csv") || "").split(",").map((s) => s.trim()).filter(Boolean);
const DATES = (arg("dates") || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!CSVS.length || !DATES.length) {
  console.error("usage: --csv=a.csv[,b.csv] --dates=YYYY-MM-DD[,YYYY-MM-DD] [--apply]");
  process.exit(2);
}

function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\r") { /* skip */ }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const slugify = (t) => String(t ?? "").toLowerCase().replace(/['"`]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const trendOf = (curr, prev) => !curr ? (prev ? "lost" : "initial")
  : !prev ? "gained" : curr < prev ? "up" : curr > prev ? "down" : "steady";

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

/* Resolve CSV (keyword, biz) -> keyword_id. ORDER BY k.id makes a duplicate
   (keyword_text, business_id) group resolve to the same twin every run; without
   it an arbitrary twin wins and rows land on the wrong keyword. */
const { rows: kws } = await db.query(
  `SELECT k.id kid, k.keyword_text, b.name biz
     FROM keywords k LEFT JOIN businesses b ON b.id = k.business_id
    ORDER BY k.id`);
const byTextBiz = new Map(), byText = new Map();
for (const k of kws) {
  const t = (k.keyword_text || "").toLowerCase().trim();
  const b = (k.biz || "").toLowerCase().trim();
  if (!byTextBiz.has(`${t}|${b}`)) byTextBiz.set(`${t}|${b}`, k);
  if (!byText.has(t)) byText.set(t, k);
}

// (keyword_id|platform) -> [{shot, rank}] — a keyword may appear across CSVs.
const shots = new Map();
let csvRows = 0, noShot = 0, unresolved = 0;
for (const path of CSVS) {
  const rows = parseCSV(fs.readFileSync(path, "utf-8")).filter((r) => r.length > 1);
  const H = rows[0];
  const idx = Object.fromEntries(H.map((h, i) => [h, i]));
  const v = (r, c) => (idx[c] != null ? (r[idx[c]] ?? "").trim() : "");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    csvRows++;
    const shot = v(r, "screenshot");
    if (!shot) { noShot++; continue; }
    const t = v(r, "keyword").toLowerCase();
    const kw = byTextBiz.get(`${t}|${v(r, "biz_name").toLowerCase()}`) ?? byText.get(t);
    if (!kw) { unresolved++; continue; }
    const rank = v(r, "rank_position");
    const key = `${kw.kid}|${v(r, "platform").toLowerCase()}`;
    if (!shots.has(key)) shots.set(key, []);
    shots.get(key).push({ shot, rank: rank && /^\d+$/.test(rank) ? parseInt(rank, 10) : null });
  }
}
console.log(`csv rows: ${csvRows}  with screenshot: ${csvRows - noShot}  unresolved keyword: ${unresolved}`);

const { rows: targets } = await db.query(`
  SELECT rr.id rr_id, rr.keyword_id, lower(rr.platform) platform,
         rr.ranking_position rank, rr.date::text d, rr.client_id,
         b.name biz_name, c.business_name client_name, k.keyword_text,
         (SELECT ranking_position FROM ranking_reports r2
           WHERE r2.keyword_id = rr.keyword_id AND lower(r2.platform) = lower(rr.platform)
             AND r2.date::date < rr.date::date AND r2.status = 'success'
           ORDER BY r2.date DESC LIMIT 1) prev_rank
    FROM ranking_reports rr
    JOIN clients c ON c.id = rr.client_id
    JOIN businesses b ON b.id = rr.business_id
    JOIN keywords k ON k.id = rr.keyword_id
   WHERE rr.date = ANY($1) AND rr.status = 'success'
     AND (rr.screenshot_url IS NULL OR rr.screenshot_url NOT LIKE 's3://%')`, [DATES]);
console.log(`rows on ${DATES.join(",")} missing a screenshot_url: ${targets.length}`);

const work = [];
let rankMismatch = 0, missingFile = 0, noCandidate = 0;
for (const row of targets) {
  const cands = shots.get(`${row.keyword_id}|${row.platform}`);
  if (!cands) { noCandidate++; continue; }
  // Only a capture whose rank equals the stored rank can be this row's proof.
  const hit = cands.find((c) => c.rank === row.rank);
  if (!hit) { rankMismatch++; continue; }
  if (!existsSync(hit.shot)) { missingFile++; continue; }
  work.push({ row, shot: hit.shot });
}
console.log(`matched: ${work.length}  no candidate: ${noCandidate}  rank mismatch: ${rankMismatch}  file missing: ${missingFile}`);

if (!APPLY) {
  console.log("\nDRY RUN — pass --apply to upload. sample:");
  for (const w of work.slice(0, 5)) {
    console.log(`  rr_id=${w.row.rr_id} ${w.row.platform} rank=${w.row.rank} <- ${w.shot}`);
  }
  await db.end();
  process.exit(0);
}

const s3 = new S3Client({ region: "us-east-1" });
let ok = 0, failed = 0;
const failures = [];
async function processOne({ row, shot }) {
  const cSlug = slugify(row.biz_name ?? row.client_name);
  const kSlug = slugify(row.keyword_text);
  const rankPart = row.rank ? `rank${row.rank}` : "rankNone";
  const key = `clients/${row.client_id}-${cSlug}/keywords/${row.keyword_id}-${kSlug}/${row.platform}/${row.d}_${rankPart}_${trendOf(row.rank, row.prev_rank)}.png`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: createReadStream(shot), ContentType: "image/png",
    }));
    await db.query(`UPDATE ranking_reports SET screenshot_url = $1 WHERE id = $2`,
      [`s3://${BUCKET}/${key}`, row.rr_id]);
    ok++;
  } catch (e) {
    failed++;
    if (failures.length < 5) failures.push(`rr_id=${row.rr_id}: ${e.message}`);
  }
}
const queue = [...work];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const n = queue.shift();
    if (!n) break;
    await processOne(n);
  }
}));
console.log(`\nuploaded: ${ok}  failed: ${failed}`);
for (const f of failures) console.log("  " + f);
await db.end();
