/* Overwrite ranking_reports rows in place with re-run results, keyed by report_id.
 *
 * Why not scripts/import-audit-logs-api.mjs: the re-run CSV has no status /
 * timestamp / device / proxy_ip columns, and that importer writes
 * `status: toRankingStatus(v(row,"status"))` -> NULL when absent. Every report
 * filters on status='success', so importing this shape through it would erase 94
 * live rows from Rankings. This touches only what the re-run re-measured.
 *
 * Backdating is intentional and was confirmed with the operator: the measurement
 * happened today but lands on the original row's date, replacing a fabricated
 * rank with a real one. Same pattern as the David Kuhs decline overwrite.
 *
 * screenshot_rank_visible is reset to NULL, never carried over: the stored
 * verdict describes the OLD capture. Leaving it would attach a stale judgement to
 * a new image — the exact bug that froze David Kuhs' rows at `false` after their
 * screenshots were replaced.
 *
 * usage: DATABASE_URL=... AWS_PROFILE=aeo-admin node scripts/apply-rerun-overwrite.mjs \
 *          --csv=<rerun.csv> [--apply]
 */
import fs from "node:fs";
import { existsSync, createReadStream } from "node:fs";
import pg from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1114, (v) => v);

const BUCKET = "aeo-rank-screenshots";
const APPLY = process.argv.includes("--apply");
const CSV = (process.argv.find((a) => a.startsWith("--csv=")) || "").slice(6);
if (!CSV) { console.error("usage: --csv=<path> [--apply]"); process.exit(2); }

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

const raw = parseCSV(fs.readFileSync(CSV, "utf-8")).filter((r) => r.length > 1);
const H = raw[0];
const idx = Object.fromEntries(H.map((h, i) => [h, i]));
const v = (r, c) => (idx[c] != null ? (r[idx[c]] ?? "").trim() : "");
const items = raw.slice(1).map((r) => ({
  id: parseInt(v(r, "report_id"), 10),
  pos: /^\d+$/.test(v(r, "rank_position")) ? parseInt(v(r, "rank_position"), 10) : null,
  total: v(r, "rank_total") || null,
  shot: v(r, "screenshot"),
}));

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

// Re-verify identity before writing: the CSV must still describe the row it claims.
const { rows: cur } = await db.query(
  `SELECT rr.id, rr.keyword_id, lower(rr.platform) platform, rr.date::text d,
          rr.ranking_position pos, rr.client_id, b.name biz_name, k.keyword_text,
          (SELECT ranking_position FROM ranking_reports r2
            WHERE r2.keyword_id = rr.keyword_id AND lower(r2.platform) = lower(rr.platform)
              AND r2.date::date < rr.date::date AND r2.status='success'
            ORDER BY r2.date DESC LIMIT 1) prev_rank
     FROM ranking_reports rr
     JOIN businesses b ON b.id = rr.business_id
     JOIN keywords k ON k.id = rr.keyword_id
    WHERE rr.id = ANY($1::int[])`, [items.map((i) => i.id)]);
const byId = new Map(cur.map((r) => [r.id, r]));

const work = [];
for (const it of items) {
  const row = byId.get(it.id);
  if (!row) { console.error(`MISSING report_id ${it.id}`); process.exit(1); }
  if (!it.shot || !existsSync(it.shot)) { console.error(`MISSING screenshot for ${it.id}`); process.exit(1); }
  work.push({ ...it, row });
}
console.log(`rows to overwrite: ${work.length}`);
const changed = work.filter((w) => w.pos !== w.row.pos).length;
console.log(`rank changes: ${changed}   unchanged: ${work.length - changed}`);

if (!APPLY) {
  console.log("\nDRY RUN — pass --apply. sample:");
  for (const w of work.slice(0, 5))
    console.log(`  id=${w.id} ${w.row.biz_name?.slice(0, 22)} ${w.row.platform} rank ${w.row.pos} -> ${w.pos}`);
  await db.end(); process.exit(0);
}

const s3 = new S3Client({ region: "us-east-1" });
let ok = 0, failed = 0;
try {
  await db.query("BEGIN");
  for (const w of work) {
    const cSlug = slugify(w.row.biz_name), kSlug = slugify(w.row.keyword_text);
    const rankPart = w.pos ? `rank${w.pos}` : "rankNone";
    const key = `clients/${w.row.client_id}-${cSlug}/keywords/${w.row.keyword_id}-${kSlug}/${w.row.platform}/${w.row.d}_${rankPart}_${trendOf(w.pos, w.row.prev_rank)}.png`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: createReadStream(w.shot), ContentType: "image/png",
    }));
    const r = await db.query(
      `UPDATE ranking_reports
          SET ranking_position = $1, ranking_total = $2, screenshot_url = $3,
              screenshot_rank_visible = NULL
        WHERE id = $4`,
      [w.pos, w.total, `s3://${BUCKET}/${key}`, w.id]);
    if (r.rowCount !== 1) { failed++; break; }
    ok++;
  }
  if (failed || ok !== work.length) {
    await db.query("ROLLBACK");
    console.error(`ABORT: updated ${ok}/${work.length} — rolled back`);
    process.exit(1);
  }
  await db.query("COMMIT");
  console.log(`\ncommitted: ${ok} rows overwritten (rank + screenshot + verdict reset)`);
} catch (e) {
  await db.query("ROLLBACK");
  console.error("ROLLBACK", e.message);
  process.exit(1);
}
await db.end();
