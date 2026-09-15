-- CRM / device-farm proof integration: lead-tracking + a stable proof slug on
-- clients created via the free-trial endpoint. Additive only. Apply via psql /
-- pg-node, NOT drizzle-kit push (push periodically wants to drop user_sessions).

ALTER TABLE clients ADD COLUMN IF NOT EXISTS slug             TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand            TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lead_ref         TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS source           TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS idempotency_key  TEXT;

-- Partial unique indexes: existing clients have NULLs (excluded), new ones are
-- unique. slug = the permanent proof join key; idempotency_key = the lead key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_slug
  ON clients (slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_idempotency_key
  ON clients (idempotency_key) WHERE idempotency_key IS NOT NULL;
