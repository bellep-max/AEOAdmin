import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/seo_network_planner",
});

await client.connect();
try {
  await client.query(
    "ALTER TABLE keywords ADD COLUMN IF NOT EXISTS aeo_plan_id integer REFERENCES client_aeo_plans(id) ON DELETE SET NULL"
  );
  console.log("✓ aeo_plan_id column added to keywords table");
} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
