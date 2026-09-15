/**
 * Add archive/lock lifecycle columns to clients + backfill.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS. Backfill uses WHERE archived_at IS NULL
 * so re-running won't restamp.
 *
 *   PROD_DATABASE_URL=... node lib/db/migrate-client-lifecycle.mjs
 *
 * Logic:
 *   - The 17 existing status='inactive' clients were soft-deleted via the
 *     old trash icon (the only thing that flipped status to 'inactive' in
 *     prod up to now). Treat them as archived: set archived_at = now() and
 *     stamp a reason. Their status stays 'inactive' so the Switch still
 *     reads correctly.
 *   - locked_at is left NULL for everyone — the rotation service backfills
 *     it the next time it runs against an existing locked keyword.
 */
import pg from "pg";

const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("PROD_DATABASE_URL or DATABASE_URL required"); process.exit(1); }

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 90000 });
await c.connect();

const steps = [
  `ALTER TABLE clients
     ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
     ADD COLUMN IF NOT EXISTS archive_reason text,
     ADD COLUMN IF NOT EXISTS locked_at      timestamptz`,
  `CREATE INDEX IF NOT EXISTS idx_clients_archived_at ON clients(archived_at) WHERE archived_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_clients_locked_at   ON clients(locked_at)   WHERE locked_at   IS NOT NULL`,
];

for (const sql of steps) {
  try {
    await c.query(sql);
    console.log("OK:", sql.replace(/\s+/g, " ").trim().slice(0, 90) + "…");
  } catch (e) {
    console.error("FAIL:", e.message, "\nSQL:", sql.slice(0, 100));
    process.exit(1);
  }
}

console.log("\nBackfill: stamp archived_at on the rows that were trashed under the old model.");
await c.query("BEGIN");
const before = await c.query("SELECT COUNT(*) AS n FROM clients WHERE status='inactive'");
const beforeArch = await c.query("SELECT COUNT(*) AS n FROM clients WHERE archived_at IS NOT NULL");
console.log(`  before: status='inactive' = ${before.rows[0].n}, archived_at NOT NULL = ${beforeArch.rows[0].n}`);

const upd = await c.query(`
  UPDATE clients
     SET archived_at    = COALESCE(archived_at, now()),
         archive_reason = COALESCE(archive_reason, 'Migrated from legacy status=inactive (trash icon)')
   WHERE status = 'inactive' AND archived_at IS NULL
   RETURNING id
`);
console.log(`  backfilled: ${upd.rows.length} client${upd.rows.length === 1 ? '' : 's'}`);

const after = await c.query("SELECT COUNT(*) AS n FROM clients WHERE archived_at IS NOT NULL");
console.log(`  after:  archived_at NOT NULL = ${after.rows[0].n}`);

await c.query("COMMIT");
console.log("\nMigration complete.");
await c.end();
