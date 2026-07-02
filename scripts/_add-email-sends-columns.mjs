/* Additive columns for email_sends (sent-email archive + GHL record status).
 * Raw ALTER instead of drizzle-kit push — push periodically wants to drop
 * user_sessions (see .claude/rules/database.md). Idempotent. */
import pg from "pg";
import { execSync } from "node:child_process";

const secret = JSON.parse(
  execSync(
    "aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --query SecretString --output text",
    { encoding: "utf8" },
  ),
);
for (let i = 1; i <= 20; i++) {
  const pool = new pg.Pool({
    connectionString: secret.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 9000,
  });
  try {
    const c = await pool.connect();
    await c.query(`
      ALTER TABLE email_sends
        ADD COLUMN IF NOT EXISTS kind text,
        ADD COLUMN IF NOT EXISTS html text,
        ADD COLUMN IF NOT EXISTS meta jsonb,
        ADD COLUMN IF NOT EXISTS ghl_status text
    `);
    const cols = await c.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'email_sends' ORDER BY ordinal_position`);
    console.log("columns:", cols.rows.map((r) => r.column_name).join(", "));
    c.release();
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${i}: ${(e.message || "?").split("\n")[0]}`);
    try { await pool.end(); } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
}
throw new Error("DB unreachable");
