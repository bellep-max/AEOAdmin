import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const steps = [
  // 1. keyword_variants table
  `CREATE TABLE IF NOT EXISTS keyword_variants (
    id               serial PRIMARY KEY,
    keyword_id       integer NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    variant_text     text NOT NULL,
    is_active        boolean NOT NULL DEFAULT true,
    week_of          date,
    source_model     text,
    generation_params jsonb,
    times_used       integer NOT NULL DEFAULT 0,
    last_used_at     timestamptz,
    generated_at     timestamptz DEFAULT now(),
    expires_at       timestamptz
  )`,

  // 2. Archive fields on keywords
  `ALTER TABLE keywords
     ADD COLUMN IF NOT EXISTS archived_at   timestamptz,
     ADD COLUMN IF NOT EXISTS archive_reason text`,

  // 3. Replacement suggestion field
  `ALTER TABLE keywords
     ADD COLUMN IF NOT EXISTS replacement_suggestion text`,

  // 4. Index for fast variant lookups
  `CREATE INDEX IF NOT EXISTS idx_keyword_variants_keyword_id ON keyword_variants(keyword_id)`,
];

for (const sql of steps) {
  try {
    await pool.query(sql);
    console.log("OK:", sql.slice(0, 60).replace(/\n/g, " ").trim() + "…");
  } catch (e) {
    console.error("FAIL:", e.message, "\nSQL:", sql.slice(0, 80));
  }
}

await pool.end();
console.log("Migration complete.");
