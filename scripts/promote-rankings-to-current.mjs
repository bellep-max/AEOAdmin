/**
 * One-shot: promote every ranking_reports row to "current" by
 *   (a) setting created_at = NOW()
 *   (b) clearing is_initial_ranking
 *
 * Why: admin wants all existing rankings to render as "Current Rank"
 * so that the next biweekly executor run will naturally push today's
 * rows into the "Last 2 Weeks" column by sliding-window date math.
 *
 * Idempotent. Run with:
 *   DATABASE_URL="postgresql://..." node scripts/promote-rankings-to-current.mjs
 */
import pg from "pg";
const { Client } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: url.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : undefined,
});

await client.connect();

const before = await client.query(
  `SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_initial_ranking = true) AS initial_count,
          MIN(created_at) AS oldest,
          MAX(created_at) AS newest
   FROM ranking_reports;`
);
console.log("before:", before.rows[0]);

const upd = await client.query(
  `UPDATE ranking_reports
   SET created_at = NOW(),
       is_initial_ranking = false
   RETURNING id;`
);
console.log(`updated rows: ${upd.rowCount}`);

const after = await client.query(
  `SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_initial_ranking = true) AS initial_count,
          MIN(created_at) AS oldest,
          MAX(created_at) AS newest
   FROM ranking_reports;`
);
console.log("after:", after.rows[0]);

await client.end();
