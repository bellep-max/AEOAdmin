/* Step 1: pull unscanned top-3 rows into rows.json for the adjudication pipeline.
 *
 * Selects success top-3 rows with an S3 screenshot and screenshot_rank_visible
 * IS NULL — i.e. captures held from client proof until adjudicated. Includes the
 * business also_known_as (alias matching) and the plan search_address (so the
 * judge can verify the capture measured the campaign's intended market, not a
 * different city — the multi-city trap: Seo Local searched Lehi, not Miami).
 *
 *   DATABASE_URL=... node pull-rows.mjs [--dateFrom=YYYY-MM-DD] [--out=rows.json]
 */
import pg from "pg";
import { writeFileSync } from "node:fs";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d ?? ""}`).split("=")[1];
const dateFrom = arg("dateFrom", "");
const out = arg("out", "rows.json");

async function connect() {
  for (let i = 0; i < 10; i++) {
    try {
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
      await c.connect();
      return c;
    } catch { await new Promise((r) => setTimeout(r, 4000)); }
  }
  throw new Error("no db");
}

const c = await connect();
const { rows } = await c.query(
  `SELECT r.id, r.keyword_id AS kwid, lower(r.platform) AS plat, r.date::text AS d,
          r.ranking_position AS pos, r.screenshot_url AS su,
          b.name AS biz, b.also_known_as AS aka,
          (SELECT p.search_address FROM client_aeo_plans p
            WHERE p.business_id = b.id ORDER BY p.id LIMIT 1) AS search_address
     FROM ranking_reports r
     JOIN businesses b ON b.id = r.business_id
    WHERE r.status = 'success' AND r.ranking_position BETWEEN 1 AND 3
      AND r.screenshot_url LIKE 's3://%' AND r.screenshot_rank_visible IS NULL
      ${dateFrom ? "AND r.date >= $1" : ""}`,
  dateFrom ? [dateFrom] : []
);
await c.end();
writeFileSync(out, JSON.stringify(rows));
console.log(`pulled ${rows.length} unscanned top-3 rows -> ${out}`);
