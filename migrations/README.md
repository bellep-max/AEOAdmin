# Migrations

Schema changes that drizzle-kit push cannot safely apply (because the
project's CLAUDE.md notes that push periodically tries to drop user_sessions).
Apply these manually against production RDS BEFORE merging the PR that
introduces the dependent code.

## How to apply

```bash
# Get the prod DB URL from AWS Secrets Manager or your team's notes.
export DATABASE_URL='postgresql://...rds.amazonaws.com/seo_network_planner'

# Then for each file in order:
psql "$DATABASE_URL" -f migrations/0001_unified_auth.sql

# Verify:
psql "$DATABASE_URL" -c "\d users"           # should show client_id column
psql "$DATABASE_URL" -c "\d user_sessions"   # should show 3 columns + index
```

## Migrations in this folder

- `0001_unified_auth.sql` — adds `users.client_id`, creates `user_sessions`,
  drops dev-only `customer_users` if present. Required by everything in
  the customer portal (api-server's /api/portal/* + /api/auth/register-customer).

## Adding a new migration

Number sequentially. Use `IF NOT EXISTS` / `IF EXISTS` for idempotency.
Don't combine multiple unrelated changes in one file.
