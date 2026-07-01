/* Upload screenshots for the CITEDLOGIC baseline import (client 259, pinned 2026-06-30). Copy of the geofix uploader (ranking_geofix_2026-06-27). Same
   shape as _upload-may30-screenshots.mjs but looped over the geofix's real data
   dates (Jun 16-24) and with a LEFT JOIN on businesses so rows without a
   business_id still upload. Joins ranking_reports -> audit_logs by
   (keyword_id, platform) within each date, uploads the local PNG to S3, and
   patches ranking_reports.screenshot_url. */
import pg from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, existsSync } from "node:fs";

pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1114, (v) => v);

const DATES = [
  "2026-06-30", // citedlogic baseline (client 259), pinned date
];
const BUCKET = "aeo-rank-screenshots";
const CONCURRENCY = 8;
const s3 = new S3Client({ region: "us-east-1" });

function slugify(text) {
  return String(text ?? "")
    .toLowerCase().replace(/['"`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 60);
}
function trendOf(currRank, prevRank) {
  if (!currRank) return prevRank ? "lost" : "initial";
  if (!prevRank) return "gained";
  if (currRank < prevRank) return "up";
  if (currRank > prevRank) return "down";
  return "steady";
}

const ROOTS = [
  "",
  "/Users/seolocalph/projects/aeo-appium/",
  "/Users/seolocalph/projects/device-agent/",
];
function resolveOnDisk(p) {
  if (!p) return null;
  for (const r of ROOTS) {
    const full = r ? `${r}${p}` : p;
    if (existsSync(full)) return full;
  }
  return null;
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

let okAll = 0, missingAll = 0, failedAll = 0;
const failures = [];

for (const DATE of DATES) {
  const rows = (await db.query(`
    WITH rr AS (
      SELECT rr.id AS rr_id, rr.keyword_id, LOWER(rr.platform) AS platform,
             rr.ranking_position AS rank, rr.date, rr.client_id,
             c.business_name AS client_name, b.name AS biz_name, k.keyword_text
      FROM ranking_reports rr
      JOIN clients c ON c.id = rr.client_id
      LEFT JOIN businesses b ON b.id = rr.business_id
      JOIN keywords k ON k.id = rr.keyword_id
      WHERE rr.date = $1 AND (rr.screenshot_url IS NULL OR rr.screenshot_url NOT LIKE 's3://%')
    ),
    al AS (
      SELECT DISTINCT ON (keyword_id, LOWER(platform))
        keyword_id, LOWER(platform) AS platform, screenshot_path
      FROM audit_logs
      WHERE timestamp >= $1::date AND timestamp < ($1::date + INTERVAL '1 day')
        AND screenshot_path IS NOT NULL
      ORDER BY keyword_id, LOWER(platform), id DESC
    )
    SELECT rr.rr_id, rr.keyword_id, rr.platform, rr.rank, rr.date,
           rr.client_id, rr.client_name, rr.biz_name, rr.keyword_text,
           al.screenshot_path,
           (SELECT ranking_position FROM ranking_reports r2
              WHERE r2.keyword_id = rr.keyword_id
                AND LOWER(r2.platform) = rr.platform
                AND r2.date::date < $1::date
                AND r2.status = 'success'
              ORDER BY r2.date DESC LIMIT 1) AS prev_rank
    FROM rr JOIN al ON al.keyword_id = rr.keyword_id AND al.platform = rr.platform
  `, [DATE])).rows;

  let ok = 0, missingFile = 0, failed = 0;
  async function processOne(row) {
    const localPath = resolveOnDisk(row.screenshot_path);
    if (!localPath) { missingFile++; return; }
    const cSlug = slugify(row.biz_name ?? row.client_name);
    const kSlug = slugify(row.keyword_text);
    const rankPart = row.rank ? `rank${row.rank}` : "rankNone";
    const trend = trendOf(row.rank, row.prev_rank);
    const key = `clients/${row.client_id}-${cSlug}/keywords/${row.keyword_id}-${kSlug}/${row.platform}/${row.date}_${rankPart}_${trend}.png`;
    const s3Uri = `s3://${BUCKET}/${key}`;
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: createReadStream(localPath), ContentType: "image/png",
      }));
      await db.query(`UPDATE ranking_reports SET screenshot_url=$1 WHERE id=$2`, [s3Uri, row.rr_id]);
      ok++;
    } catch (e) {
      failed++;
      if (failures.length < 5) failures.push(`rr_id=${row.rr_id}: ${e.message}`);
    }
  }
  const queue = [...rows];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) { const next = queue.shift(); if (!next) break; await processOne(next); }
  });
  await Promise.all(workers);
  console.log(`${DATE}: rows=${rows.length} uploaded=${ok} missing=${missingFile} failed=${failed}`);
  okAll += ok; missingAll += missingFile; failedAll += failed;
}

console.log(`\nTOTAL uploaded=${okAll} | file-missing=${missingAll} | failed=${failedAll}`);
for (const f of failures) console.log(`  ${f}`);
await db.end();
