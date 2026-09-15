import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const r = await c.query(`
WITH ranked AS (
  SELECT
    k.id              AS keyword_id,
    k.keyword_text,
    k.client_id,
    k.is_active,
    k.archived_at,
    cap.plan_type,
    rr.platform,
    rr.ranking_position,
    ROW_NUMBER() OVER (PARTITION BY rr.keyword_id, rr.platform
                       ORDER BY rr.created_at DESC, rr.id DESC) AS rn
  FROM keywords k
  LEFT JOIN client_aeo_plans cap ON k.aeo_plan_id = cap.id
  LEFT JOIN ranking_reports rr ON rr.keyword_id = k.id
  WHERE k.is_active = true
    AND k.archived_at IS NULL
    AND cap.plan_type = 'Free Trial Plans'
),
latest AS (
  SELECT keyword_id, keyword_text, client_id, platform, ranking_position
  FROM ranked
  WHERE rn = 1 AND ranking_position IS NOT NULL AND ranking_position BETWEEN 1 AND 3
),
winners AS (
  SELECT
    l.keyword_id,
    l.keyword_text,
    l.client_id,
    MIN(l.ranking_position) AS best_rank,
    STRING_AGG(l.platform || '#' || l.ranking_position::text, ', ' ORDER BY l.ranking_position) AS hits
  FROM latest l
  GROUP BY 1, 2, 3
)
SELECT
  w.client_id,
  c.business_name AS client,
  w.keyword_id,
  w.keyword_text,
  w.best_rank,
  w.hits
FROM winners w
JOIN clients c ON c.id = w.client_id
ORDER BY w.best_rank, w.client_id, w.keyword_id;
`);

console.log(`Free-trial keywords currently top-3 on at least one platform: ${r.rowCount}`);
console.log("(All NOT locked/archived per the new policy — they keep running.)\n");

// Group by client for readability
const byClient = new Map();
for (const row of r.rows) {
  const arr = byClient.get(row.client_id) ?? { name: row.client, kws: [] };
  arr.kws.push(row);
  byClient.set(row.client_id, arr);
}

let lineNo = 0;
for (const [cid, { name, kws }] of [...byClient.entries()].sort(
  (a, b) => Math.min(...a[1].kws.map((k) => k.best_rank)) - Math.min(...b[1].kws.map((k) => k.best_rank)),
)) {
  console.log(`── client #${cid} ${name}  (${kws.length} winner${kws.length === 1 ? "" : "s"})`);
  for (const k of kws) {
    lineNo++;
    console.log(`   #${k.keyword_id}  "${k.keyword_text}"  → best #${k.best_rank}  (${k.hits})`);
  }
}
console.log(`\n${lineNo} winners across ${byClient.size} free-trial clients.`);
await c.end();
