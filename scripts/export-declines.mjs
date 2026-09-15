/**
 * Export declining keyword slots for re-running.
 *
 * A decline = the latest successful ranking for a (keyword, platform) is worse
 * (higher number) than the one before it. Each row carries the current row's
 * date + timestamp so a re-run can be re-imported onto the same upsert key
 * (keyword_id, platform, date) and replace the value in place.
 *
 * TIMESTAMPS: every date/timestamp is read with to_char() and never touched by
 * a JS Date. ranking_reports.timestamp is `timestamp without time zone`, so
 * pg-node hands it back as a Date parsed in the machine's LOCAL zone — calling
 * .toISOString() on it silently shifts the value by the UTC offset (-8h from
 * Manila) and can roll an early-morning row back to the previous day. See the
 * pg-node timestamp rule in .claude/rules/database.md.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/export-declines.mjs [outfile] [--client=ID] [--min-drop=N]
 */
import fs from "fs";
import pg from "pg";

const args = process.argv.slice(2);
const outPath =
  args.find((a) => !a.startsWith("--")) ??
  `${process.env.HOME}/Desktop/Rankings/declines_to_rerun.csv`;
const clientArg = args.find((a) => a.startsWith("--client="));
const minDropArg = args.find((a) => a.startsWith("--min-drop="));
const clientId = clientArg ? Number(clientArg.split("=")[1]) : null;
const minDrop = minDropArg ? Number(minDropArg.split("=")[1]) : 1;

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const esc = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const db = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const rows = (
  await db.query(
    `
  WITH ranked AS (
    SELECT r.keyword_id, r.platform, r.date, r.ranking_position, r.ranking_total,
           r.screenshot_rank_visible,
           to_char(r.timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts_text,
           row_number() OVER (PARTITION BY r.keyword_id, r.platform
                              ORDER BY r.date DESC) AS rn
    FROM ranking_reports r
    JOIN keywords k ON k.id = r.keyword_id
    JOIN clients  c ON c.id = k.client_id
    WHERE r.status = 'success'
      AND r.ranking_position IS NOT NULL
      AND c.status = 'active'
      AND k.status IN ('new', 'locked')
      AND ($1::int IS NULL OR k.client_id = $1::int)
  ),
  pair AS (
    SELECT cur.keyword_id, cur.platform,
           cur.date AS cur_date, cur.ts_text AS cur_ts, cur.ranking_position AS cur_rank,
           cur.ranking_total AS cur_total, cur.screenshot_rank_visible AS cur_visible,
           prv.date AS prev_date, prv.ranking_position AS prev_rank
    FROM ranked cur
    JOIN ranked prv ON prv.keyword_id = cur.keyword_id
                   AND prv.platform  = cur.platform
                   AND prv.rn = 2
    WHERE cur.rn = 1
  )
  SELECT p.*, k.keyword_text, k.status AS kw_status, k.client_id, b.name AS biz_name,
         (p.cur_rank - p.prev_rank) AS drop_by
  FROM pair p
  JOIN keywords k ON k.id = p.keyword_id
  LEFT JOIN businesses b ON b.id = k.business_id
  WHERE p.cur_rank > p.prev_rank
    AND (p.cur_rank - p.prev_rank) >= $2::int
  ORDER BY (p.cur_rank - p.prev_rank) DESC, k.client_id, p.keyword_id, p.platform`,
    [clientId, minDrop],
  )
).rows;

const header = [
  "client_id",
  "biz_name",
  "keyword_id",
  "keyword_text",
  "keyword_status",
  "platform",
  "prev_date",
  "prev_rank",
  "current_date",
  "current_timestamp",
  "current_rank",
  "current_total",
  "drop_by",
  "screenshot_verified",
];

const lines = [header.join(",")];
for (const r of rows) {
  lines.push(
    [
      r.client_id,
      r.biz_name,
      r.keyword_id,
      r.keyword_text,
      r.kw_status,
      r.platform,
      r.prev_date,
      r.prev_rank,
      r.cur_date,
      r.cur_ts,
      r.cur_rank,
      r.cur_total,
      r.drop_by,
      r.cur_visible === null ? "" : r.cur_visible,
    ]
      .map(esc)
      .join(","),
  );
}
fs.writeFileSync(outPath, `${lines.join("\n")}\n`);

console.log(`wrote ${outPath} | ${rows.length} declining slots`);
console.log(
  `  clients: ${new Set(rows.map((r) => r.client_id)).size}` +
    (clientId ? ` (filtered to ${clientId})` : "") +
    (minDrop > 1 ? ` | min drop: ${minDrop}` : ""),
);

await db.end();
