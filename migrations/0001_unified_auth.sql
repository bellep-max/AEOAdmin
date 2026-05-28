-- 0001_unified_auth.sql
-- Customer portal — unified auth + session storage.
-- Apply against production RDS BEFORE deploying the api-server image
-- that includes /api/portal/* and /api/auth/register-customer.

-- 1. Add client_id FK to users so a customer user can be scoped to one client.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS client_id integer REFERENCES clients(id);

-- 2. Backstop: ensure role column has a sensible default. (Already exists per
-- the existing schema; this is a guard for older databases.)
ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'admin';

-- 3. Session store for express-session (connect-pg-simple). This table is
-- intentionally NOT managed by drizzle-kit; create it out-of-band.
CREATE TABLE IF NOT EXISTS user_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire);

-- 4. Drop the throwaway customer_users table if it was applied to a dev DB.
-- This is a no-op in prod (the table was never deployed) but keeps the
-- migration idempotent across all environments.
DROP TABLE IF EXISTS customer_users;
