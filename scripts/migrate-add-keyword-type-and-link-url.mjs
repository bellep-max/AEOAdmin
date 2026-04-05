/**
 * Migration: add keyword_type (integer) to keywords table
 *            add link_url (text) to keyword_links table
 *
 * Safe to run multiple times — uses IF NOT EXISTS / checks column existence.
 *
 * Run with:
 *   node scripts/migrate-add-keyword-type-and-link-url.mjs
 * or (with explicit DB URL):
 *   DATABASE_URL=postgresql://... node scripts/migrate-add-keyword-type-and-link-url.mjs
 */

import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/seo_network_planner';
const pool = new Pool({ connectionString: DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('Running migration…');

    // 1. Add keyword_type column to keywords (integer, default 3 = "Keyword text")
    await client.query(`
      ALTER TABLE keywords
      ADD COLUMN IF NOT EXISTS keyword_type INTEGER DEFAULT 3;
    `);
    console.log('✅  keywords.keyword_type — added (or already exists)');

    // 2. Add link_url column to keyword_links
    await client.query(`
      ALTER TABLE keyword_links
      ADD COLUMN IF NOT EXISTS link_url TEXT;
    `);
    console.log('✅  keyword_links.link_url — added (or already exists)');

    console.log('Migration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
