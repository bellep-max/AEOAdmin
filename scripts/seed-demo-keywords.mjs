import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/seo_network_planner",
});

const DEMO_KEYWORDS = [
  "childcare near me",
  "best daycare downtown",
  "affordable preschool",
  "montessori school",
  "toddler learning center",
  "after school program",
  "infant care services",
  "summer camp for kids",
  "bilingual preschool",
  "kindergarten enrollment",
  "early childhood education",
  "licensed day care",
];

await client.connect();

try {
  const { rows: businesses } = await client.query(
    `SELECT id, client_id FROM businesses ORDER BY id LIMIT 1`
  );
  if (businesses.length === 0) {
    console.log("No businesses found. Run seed-sample.mjs first.");
    process.exit(1);
  }
  const b = businesses[0];

  const { rows: plans } = await client.query(
    `SELECT id FROM client_aeo_plans WHERE business_id = $1 ORDER BY id LIMIT 1`,
    [b.id]
  );
  const planId = plans[0]?.id ?? null;
  console.log(`Seeding keywords for business ${b.id} (client ${b.client_id}, campaign ${planId ?? "—"})`);

  let added = 0;
  for (const text of DEMO_KEYWORDS) {
    const { rows: existing } = await client.query(
      `SELECT id FROM keywords WHERE business_id = $1 AND keyword_text = $2`,
      [b.id, text]
    );
    if (existing.length > 0) continue;
    await client.query(
      `INSERT INTO keywords (client_id, business_id, aeo_plan_id, keyword_text, is_active, date_added)
       VALUES ($1, $2, $3, $4, true, CURRENT_DATE)`,
      [b.client_id, b.id, planId, text]
    );
    added++;
  }
  console.log(`✓ Added ${added} demo keywords`);
} catch (err) {
  console.error("✗", err);
  process.exit(1);
} finally {
  await client.end();
}
