import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/seo_network_planner' });
const r = await pool.query(`UPDATE keywords SET keyword_type = 4 WHERE id IN (SELECT DISTINCT keyword_id FROM keyword_links)`);
console.log('Updated', r.rowCount, 'keywords to type 4 (Keywords with Backlinks)');
await pool.end();
