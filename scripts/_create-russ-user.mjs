import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query(
  "CREATE ROLE russ_readonly WITH LOGIN PASSWORD '5PCFtWqxBARw1mTg5XAdQiLq0WTP'",
);
await c.query("GRANT CONNECT ON DATABASE seo_network_planner TO russ_readonly");
await c.query("GRANT USAGE ON SCHEMA public TO russ_readonly");
await c.query("GRANT SELECT ON ranking_reports TO russ_readonly");
await c.query("GRANT SELECT ON keywords TO russ_readonly");
await c.query("GRANT SELECT ON clients TO russ_readonly");
await c.query("GRANT SELECT ON businesses TO russ_readonly");
await c.query("GRANT SELECT ON client_aeo_plans TO russ_readonly");
console.log("User created + grants applied. Verifying:");
const r = await c.query(`
  SELECT table_name, privilege_type
  FROM information_schema.table_privileges
  WHERE grantee='russ_readonly'
  ORDER BY table_name, privilege_type
`);
for (const row of r.rows)
  console.log("  " + row.table_name + ": " + row.privilege_type);
await c.end();
