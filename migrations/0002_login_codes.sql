-- Passwordless customer-portal sign-in: email one-time codes.
-- Additive only. Apply via pg-node (scripts/apply-migration.mjs), NOT
-- drizzle-kit push (push periodically wants to drop user_sessions).

CREATE TABLE IF NOT EXISTS login_codes (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  client_id   INTEGER REFERENCES clients(id),
  expires_at  TIMESTAMP NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- request-code / verify-code both look up the latest live code per email.
CREATE INDEX IF NOT EXISTS idx_login_codes_email_created
  ON login_codes (email, created_at DESC);
