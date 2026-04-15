import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/seo_network_planner",
});

const SEED_NOTE = "demo-seed-v1";
const PLATFORMS = ["chatgpt", "gemini", "perplexity"];

// Deterministic mix of statuses so the demo shows every colour
// improved | declined | steady | new | missing
const STATUS_CYCLE = [
  "improved", "declined", "steady", "improved", "steady",
  "declined", "new", "improved", "steady", "missing",
];

function startOfIsoWeek(d) {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = out.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  out.setUTCDate(out.getUTCDate() + diff);
  return out;
}

function addDays(d, n) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** Choose previous & current positions so the pair reflects the desired status. */
function pickPositions(status, seed) {
  const base = 3 + (seed % 15); // 3..17
  switch (status) {
    case "improved": return { prev: base + 3, cur: base };
    case "declined": return { prev: base,     cur: base + 4 };
    case "steady":   return { prev: base,     cur: base };
    case "new":      return { prev: null,     cur: base };
    case "missing":  return { prev: base,     cur: null };
    default:         return { prev: base,     cur: base };
  }
}

await client.connect();

try {
  const { rows: existingRuns } = await client.query(
    `SELECT id FROM ranking_runs WHERE notes = $1`,
    [SEED_NOTE]
  );
  if (existingRuns.length > 0) {
    console.log("Demo ranking data already seeded, skipping.");
    process.exit(0);
  }

  const { rows: keywords } = await client.query(
    `SELECT id, client_id, business_id, aeo_plan_id, keyword_text
       FROM keywords
      WHERE business_id IS NOT NULL
      ORDER BY id
      LIMIT 20`
  );

  if (keywords.length === 0) {
    console.log("No keywords with business_id found. Run seed-sample.mjs and/or migrate-to-businesses.mjs first.");
    process.exit(1);
  }
  console.log(`Found ${keywords.length} keywords to seed rankings for.`);

  const now = new Date();
  const thisMon = startOfIsoWeek(now);
  const prevMon = addDays(thisMon, -7);

  const prevDate = addDays(prevMon, 1); // Tue of previous week
  const curDate  = addDays(thisMon, 1); // Tue of current week
  prevDate.setUTCHours(10, 0, 0, 0);
  curDate.setUTCHours(10, 0, 0, 0);

  // Create two ranking_runs markers (previous run success, current run success)
  const { rows: [prevRun] } = await client.query(
    `INSERT INTO ranking_runs (started_at, finished_at, status, keywords_attempted, keywords_succeeded, keywords_failed, notes)
     VALUES ($1, $2, 'success', $3, $3, 0, $4)
     RETURNING id`,
    [prevDate, new Date(prevDate.getTime() + 15 * 60 * 1000), keywords.length, SEED_NOTE]
  );
  const { rows: [curRun] } = await client.query(
    `INSERT INTO ranking_runs (started_at, finished_at, status, keywords_attempted, keywords_succeeded, keywords_failed, notes)
     VALUES ($1, $2, 'success', $3, $4, $5, $6)
     RETURNING id`,
    [
      curDate,
      new Date(curDate.getTime() + 18 * 60 * 1000),
      keywords.length,
      Math.max(0, keywords.length - 1),
      1,
      SEED_NOTE,
    ]
  );
  console.log(`✓ ranking_runs: prev=${prevRun.id}, current=${curRun.id}`);

  let insertedPrev = 0;
  let insertedCur = 0;

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    for (let p = 0; p < PLATFORMS.length; p++) {
      const platform = PLATFORMS[p];
      const statusIdx = (i * PLATFORMS.length + p) % STATUS_CYCLE.length;
      const status = STATUS_CYCLE[statusIdx];
      const { prev, cur } = pickPositions(status, i + p);

      if (prev != null) {
        await client.query(
          `INSERT INTO ranking_reports
             (client_id, business_id, keyword_id, ranking_position, platform, is_initial_ranking, run_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [kw.client_id, kw.business_id, kw.id, prev, platform, i === 0 && p === 0, prevRun.id, prevDate]
        );
        insertedPrev++;
      }
      if (cur != null) {
        await client.query(
          `INSERT INTO ranking_reports
             (client_id, business_id, keyword_id, ranking_position, platform, is_initial_ranking, run_id, created_at)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7)`,
          [kw.client_id, kw.business_id, kw.id, cur, platform, curRun.id, curDate]
        );
        insertedCur++;
      }
    }
  }

  console.log(`✓ inserted ${insertedPrev} previous-week reports, ${insertedCur} current-week reports`);
  console.log("✓ Demo ranking data seeded");
} catch (err) {
  console.error("✗ Error:", err);
  process.exit(1);
} finally {
  await client.end();
}
