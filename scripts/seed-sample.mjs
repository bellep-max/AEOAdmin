import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/seo_network_planner",
});

await client.connect();

try {
  const { rows: existing } = await client.query(`SELECT id FROM clients WHERE business_name = $1`, ["Acme Dental"]);
  if (existing.length > 0) {
    console.log("Sample client already exists, skipping.");
    process.exit(0);
  }

  const { rows: [c] } = await client.query(
    `INSERT INTO clients (business_name, website_url, city, state, status, contact_email, account_user_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    ["Acme Dental", "https://acmedental.example", "San Francisco", "CA", "active", "owner@acmedental.example", "Jane Smith"]
  );
  console.log(`✓ client id=${c.id}`);

  const { rows: [b] } = await client.query(
    `INSERT INTO businesses (client_id, name, website_url, category, city, state, country, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [c.id, "Acme Dental - Downtown", "https://acmedental.example/downtown", "Dentist", "San Francisco", "CA", "US", "active"]
  );
  console.log(`✓ business id=${b.id}`);

  const { rows: [k] } = await client.query(
    `INSERT INTO keywords (client_id, business_id, keyword_text, is_active, date_added)
     VALUES ($1, $2, $3, $4, CURRENT_DATE)
     RETURNING id`,
    [c.id, b.id, "best dentist san francisco", true]
  );
  console.log(`✓ keyword id=${k.id}`);

  console.log("✓ Sample data created");
} catch (err) {
  console.error("✗ Error:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
