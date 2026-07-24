/* Additive DDL for the promo-code feature: promo_codes table +
 * client_aeo_plans.promo_code_id FK. Raw SQL instead of drizzle-kit push —
 * push periodically wants to drop user_sessions (see .claude/rules/database.md).
 * Idempotent. */
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
      CREATE TABLE IF NOT EXISTS promo_codes (
        id serial PRIMARY KEY,
        code text NOT NULL,
        discount_type text NOT NULL DEFAULT 'percent',
        discount_value numeric(10,2),
        start_date date,
        end_date date,
        provided_by text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await c.query(`
      ALTER TABLE client_aeo_plans
        ADD COLUMN IF NOT EXISTS promo_code_id integer
          REFERENCES promo_codes(id) ON DELETE SET NULL
    `);
    const cols = await c.query(`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name = 'promo_codes'
          OR (table_name = 'client_aeo_plans' AND column_name = 'promo_code_id')
       ORDER BY table_name, ordinal_position`);
    console.log(
      cols.rows.map((r) => `${r.table_name}.${r.column_name}`).join("\n"),
    );
    c.release();
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${i}: ${(e.message || "?").split("\n")[0]}`);
    try { await pool.end(); } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
}
console.error("gave up after 20 attempts");
process.exit(1);
