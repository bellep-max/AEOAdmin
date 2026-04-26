/**
 * Report duplicate daily sessions for a given ET date.
 * Duplicate = same (client_id, business_id, campaign_id, keyword_id, ai_platform)
 *   with timestamp in the ET day.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/check-session-dupes.mjs 2026-04-21
 */
import pg from "pg";
const { Client } = pg;

const targetDate = process.argv[2] || new Date().toISOString().slice(0, 10);

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }

const client = new Client({
  connectionString: url,
  ssl: url.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

/* ET day window: [date 00:00 ET, date+1 00:00 ET). EDT = UTC-4. */
const startET = `${targetDate}T04:00:00Z`;
const endDate = new Date(new Date(`${targetDate}T00:00:00Z`).getTime() + 24*60*60*1000)
  .toISOString().slice(0, 10);
const endET = `${endDate}T04:00:00Z`;

console.log(`Window: ${startET}  →  ${endET}  (ET day ${targetDate})`);

/* Total sessions in window */
const total = await client.query(
  `SELECT COUNT(*) AS n FROM sessions WHERE timestamp >= $1 AND timestamp < $2;`,
  [startET, endET]
);
console.log(`Total sessions on ${targetDate} ET: ${total.rows[0].n}`);

/* Duplicate groups */
const dupes = await client.query(
  `SELECT client_id, business_id, campaign_id, keyword_id, ai_platform,
          COUNT(*) AS dup_count,
          ARRAY_AGG(id ORDER BY timestamp) AS session_ids,
          ARRAY_AGG(timestamp ORDER BY timestamp) AS timestamps,
          ARRAY_AGG(status ORDER BY timestamp) AS statuses
   FROM sessions
   WHERE timestamp >= $1 AND timestamp < $2
   GROUP BY client_id, business_id, campaign_id, keyword_id, ai_platform
   HAVING COUNT(*) > 1
   ORDER BY dup_count DESC, client_id, keyword_id;`,
  [startET, endET]
);

if (dupes.rowCount === 0) {
  console.log(`\nNo duplicates on ${targetDate}.`);
} else {
  console.log(`\nDuplicate groups: ${dupes.rowCount}`);
  console.log(`Extra rows (dupes beyond the first): ${dupes.rows.reduce((a, r) => a + Number(r.dup_count) - 1, 0)}`);

  /* Join names for readability */
  const lookup = await client.query(
    `SELECT s.id, c.business_name AS client_name, b.name AS biz_name, p.name AS campaign_name,
            k.keyword_text, s.ai_platform, s.status, s.timestamp
     FROM sessions s
     LEFT JOIN clients c ON s.client_id = c.id
     LEFT JOIN businesses b ON s.business_id = b.id
     LEFT JOIN client_aeo_plans p ON s.campaign_id = p.id
     LEFT JOIN keywords k ON s.keyword_id = k.id
     WHERE s.id = ANY($1::int[]);`,
    [dupes.rows.flatMap((r) => r.session_ids)]
  );
  const byId = new Map(lookup.rows.map((r) => [r.id, r]));

  console.log("\nTop 20 duplicate groups:");
  for (const g of dupes.rows.slice(0, 20)) {
    const first = byId.get(g.session_ids[0]);
    console.log(
      `  ${g.dup_count}× | ${first?.client_name ?? "?"} / ${first?.biz_name ?? "?"} / ` +
      `${first?.campaign_name ?? "?"} / "${first?.keyword_text ?? "?"}" / ${g.ai_platform}`
    );
    for (const sid of g.session_ids) {
      const r = byId.get(sid);
      console.log(`     - id=${sid}  ts=${new Date(r?.timestamp).toISOString()}  status=${r?.status}`);
    }
  }
  if (dupes.rows.length > 20) console.log(`  … and ${dupes.rows.length - 20} more groups.`);
}

await client.end();
