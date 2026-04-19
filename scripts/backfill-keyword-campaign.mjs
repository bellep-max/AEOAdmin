/**
 * Backfill: every keyword must belong to an AEO plan (campaign).
 *
 * Strategy:
 *   1. Find all keywords with aeo_plan_id IS NULL.
 *   2. For each business referenced by those keywords, find or create
 *      an "Unassigned" campaign on that business.
 *   3. Update the orphan keywords to point at that campaign.
 *   4. Keywords missing a business too: park them on a per-client
 *      "Unassigned" campaign with business_id NULL.
 *
 * Idempotent — safe to re-run.
 */
import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/seo_network_planner",
});

await client.connect();

const UNASSIGNED_PLAN_TYPE = "Unassigned";
const UNASSIGNED_PLAN_NAME = "Unassigned (auto)";

async function findOrCreatePlan(clientId, businessId) {
  const where = businessId == null
    ? `client_id = $1 AND business_id IS NULL AND plan_type = $2`
    : `client_id = $1 AND business_id = $2 AND plan_type = $3`;
  const params = businessId == null ? [clientId, UNASSIGNED_PLAN_TYPE] : [clientId, businessId, UNASSIGNED_PLAN_TYPE];
  const { rows } = await client.query(`SELECT id FROM client_aeo_plans WHERE ${where} LIMIT 1`, params);
  if (rows.length > 0) return rows[0].id;

  const { rows: ins } = await client.query(
    `INSERT INTO client_aeo_plans (client_id, business_id, name, plan_type, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [clientId, businessId, UNASSIGNED_PLAN_NAME, UNASSIGNED_PLAN_TYPE, "backfill"]
  );
  return ins[0].id;
}

try {
  const { rows: orphans } = await client.query(`
    SELECT id, client_id, business_id
    FROM keywords
    WHERE aeo_plan_id IS NULL
  `);
  console.log(`Found ${orphans.length} orphan keyword(s) without a campaign.`);

  if (orphans.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  const planCache = new Map(); // key: `${clientId}:${businessId ?? 'null'}` → planId
  let updated = 0;
  for (const k of orphans) {
    const cacheKey = `${k.client_id}:${k.business_id ?? "null"}`;
    let planId = planCache.get(cacheKey);
    if (planId == null) {
      planId = await findOrCreatePlan(k.client_id, k.business_id);
      planCache.set(cacheKey, planId);
    }
    await client.query(`UPDATE keywords SET aeo_plan_id = $1 WHERE id = $2`, [planId, k.id]);
    updated += 1;
  }
  console.log(`✓ Linked ${updated} keyword(s) to ${planCache.size} "${UNASSIGNED_PLAN_NAME}" campaign(s).`);
} catch (err) {
  console.error("✗ Backfill failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
