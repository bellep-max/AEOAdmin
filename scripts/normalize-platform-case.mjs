#!/usr/bin/env node
/**
 * One-time migration: lowercase platform values across sessions and ranking_reports.
 *
 * Background: prod has a mix of "chatgpt" / "ChatGPT" / "Gemini" / "gemini" / etc.
 * The analyst groups by platform, so casing splits real platforms into ghost rows.
 * Run once after the API write-side normalization is deployed.
 *
 * Usage: DATABASE_URL=... node scripts/normalize-platform-case.mjs [--dry-run]
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required"); process.exit(1); }
const dryRun = process.argv.includes("--dry-run");

const { Client } = pg;
const client = new Client({
  connectionString: url,
  ssl: url.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

console.log(dryRun ? "DRY RUN — no writes" : "LIVE — will mutate data");

const beforeSessions = await client.query(`
  SELECT ai_platform, COUNT(*)::int AS n FROM sessions GROUP BY ai_platform ORDER BY ai_platform
`);
console.log("\nBEFORE — sessions.ai_platform:");
for (const r of beforeSessions.rows) console.log(`  ${r.ai_platform ?? "(null)"}: ${r.n}`);

const beforeRankings = await client.query(`
  SELECT platform, COUNT(*)::int AS n FROM ranking_reports GROUP BY platform ORDER BY platform
`);
console.log("\nBEFORE — ranking_reports.platform:");
for (const r of beforeRankings.rows) console.log(`  ${r.platform ?? "(null)"}: ${r.n}`);

const beforeAudit = await client.query(`
  SELECT platform, COUNT(*)::int AS n FROM audit_logs GROUP BY platform ORDER BY platform
`);
console.log("\nBEFORE — audit_logs.platform:");
for (const r of beforeAudit.rows) console.log(`  ${r.platform ?? "(null)"}: ${r.n}`);

if (!dryRun) {
  const sUpd = await client.query(`
    UPDATE sessions SET ai_platform = LOWER(ai_platform)
    WHERE ai_platform IS NOT NULL AND ai_platform <> LOWER(ai_platform)
  `);
  const rUpd = await client.query(`
    UPDATE ranking_reports SET platform = LOWER(platform)
    WHERE platform IS NOT NULL AND platform <> LOWER(platform)
  `);
  const aUpd = await client.query(`
    UPDATE audit_logs SET platform = LOWER(platform)
    WHERE platform IS NOT NULL AND platform <> LOWER(platform)
  `);
  console.log(`\nUpdated sessions rows: ${sUpd.rowCount}`);
  console.log(`Updated ranking_reports rows: ${rUpd.rowCount}`);
  console.log(`Updated audit_logs rows: ${aUpd.rowCount}`);

  const afterSessions = await client.query(`
    SELECT ai_platform, COUNT(*)::int AS n FROM sessions GROUP BY ai_platform ORDER BY ai_platform
  `);
  console.log("\nAFTER — sessions.ai_platform:");
  for (const r of afterSessions.rows) console.log(`  ${r.ai_platform ?? "(null)"}: ${r.n}`);

  const afterRankings = await client.query(`
    SELECT platform, COUNT(*)::int AS n FROM ranking_reports GROUP BY platform ORDER BY platform
  `);
  console.log("\nAFTER — ranking_reports.platform:");
  for (const r of afterRankings.rows) console.log(`  ${r.platform ?? "(null)"}: ${r.n}`);

  const afterAudit = await client.query(`
    SELECT platform, COUNT(*)::int AS n FROM audit_logs GROUP BY platform ORDER BY platform
  `);
  console.log("\nAFTER — audit_logs.platform:");
  for (const r of afterAudit.rows) console.log(`  ${r.platform ?? "(null)"}: ${r.n}`);
}

await client.end();
