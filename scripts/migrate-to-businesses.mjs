import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/seo_network_planner",
});

await client.connect();

try {
  console.log("→ Creating business_status enum");
  await client.query(`DO $$ BEGIN
    CREATE TYPE business_status AS ENUM ('active', 'inactive');
  EXCEPTION WHEN duplicate_object THEN null; END $$;`);

  console.log("→ Creating businesses table");
  await client.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      gmb_url TEXT,
      website_url TEXT,
      category TEXT,
      published_address TEXT,
      search_address TEXT,
      city TEXT,
      state TEXT,
      country TEXT,
      place_id TEXT,
      location_ref TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      timezone TEXT,
      website_published_on_gmb TEXT,
      website_linked_on_gmb TEXT,
      status business_status NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  console.log("→ Adding business_id columns to child tables");
  const childTables = [
    ["keywords", "CASCADE"],
    ["sessions", "CASCADE"],
    ["ranking_reports", "CASCADE"],
    ["device_rotations", "SET NULL"],
    ["client_aeo_plans", "CASCADE"],
  ];
  for (const [table, onDelete] of childTables) {
    await client.query(`
      ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id) ON DELETE ${onDelete}
    `);
  }

  console.log("→ Seeding one business per existing client");
  const { rows: clients } = await client.query(`SELECT id, business_name, gmb_url, website_url, published_address, search_address, city, state, place_id, location_ref, latitude, longitude, timezone, website_published_on_gmb, website_linked_on_gmb FROM clients`);

  const mapping = new Map();
  for (const c of clients) {
    const existing = await client.query(`SELECT id FROM businesses WHERE client_id = $1 LIMIT 1`, [c.id]);
    if (existing.rows.length > 0) {
      mapping.set(c.id, existing.rows[0].id);
      continue;
    }
    const { rows } = await client.query(
      `INSERT INTO businesses (
        client_id, name, gmb_url, website_url, published_address, search_address,
        city, state, place_id, location_ref, latitude, longitude, timezone,
        website_published_on_gmb, website_linked_on_gmb
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id`,
      [
        c.id, c.business_name ?? `Client ${c.id}`, c.gmb_url, c.website_url,
        c.published_address, c.search_address, c.city, c.state,
        c.place_id, c.location_ref, c.latitude, c.longitude, c.timezone,
        c.website_published_on_gmb, c.website_linked_on_gmb,
      ]
    );
    mapping.set(c.id, rows[0].id);
  }
  console.log(`  seeded ${mapping.size} businesses`);

  console.log("→ Backfilling business_id on child rows");
  for (const [table] of childTables) {
    const res = await client.query(
      `UPDATE ${table} SET business_id = b.id
       FROM businesses b
       WHERE ${table}.client_id = b.client_id AND ${table}.business_id IS NULL`
    );
    console.log(`  ${table}: ${res.rowCount} rows updated`);
  }

  console.log("✓ Migration complete");
} catch (err) {
  console.error("✗ Error:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
