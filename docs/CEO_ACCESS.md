# CEO Access — Russ

Read-only access for the CEO into AEOAdmin production data: ranking history (SQL) + screenshot evidence (S3). Provisioned 2026-06-10.

> **Credentials are NOT in this doc.** They live in 1Password under the AEOAdmin shared vault. The secret-scanner pre-commit hook will block any markdown that contains a real password or AWS key, and that's intentional.

---

## 1. Read-only Postgres access

For ad-hoc SQL — pulling ranking history, joining clients to their keywords, building a sheet of who-ranks-where.

### Connection

| Field    | Value                                                   |
| -------- | ------------------------------------------------------- |
| Host     | `aeo-admin-db.cwvwsawae95c.us-east-1.rds.amazonaws.com` |
| Port     | `5432`                                                  |
| Database | `seo_network_planner`                                   |
| User     | `russ_readonly`                                         |
| Password | _1Password → AEOAdmin → "Russ — read-only DB"_          |
| SSL      | **required** (`sslmode=require`)                        |

### Recommended client

Either of these handles SSL out of the box and has a free tier:

- **TablePlus** (macOS / Windows / Linux) — paid app with a generous free mode. Easiest GUI.
- **DBeaver Community** (cross-platform) — fully free, more features, slightly less polished.

Both let you create a new Postgres connection and paste the five fields above into their respective inputs. Enable SSL / set sslmode to `require`. Test connection should succeed in under a second.

### What you can read

`SELECT` is granted on five tables only — everything else returns a permission error.

| Table              | What it holds                                                                 |
| ------------------ | ----------------------------------------------------------------------------- |
| `clients`          | One row per client (name, status, plan_name, created_at)                      |
| `businesses`       | One row per business location under a client (most clients have 1)            |
| `client_aeo_plans` | Per-client plan assignments — `plan_type` is "AEO Plan" or "Free Trial Plans" |
| `keywords`         | Keywords being tracked per business, with status / active / archived flags    |
| `ranking_reports`  | The data — every ranking audit. Joins to `keywords` via `keyword_id`          |

### Useful starter queries

```sql
-- Every active paid client and how many active keywords they have
SELECT c.id, c.business_name, c.plan_name, COUNT(k.id) AS active_kw
FROM clients c
JOIN businesses b ON b.client_id = c.id
JOIN keywords k   ON k.business_id = b.id
WHERE c.status = 'active'
  AND k.is_active = true
  AND k.is_archived = false
GROUP BY c.id, c.business_name, c.plan_name
ORDER BY active_kw DESC;
```

```sql
-- Latest ranking per (keyword, platform) for one client
SELECT DISTINCT ON (rr.keyword_id, rr.platform)
       c.business_name, k.keyword_text, rr.platform,
       rr.ranking_position, rr.status, rr.date, rr.screenshot_url
FROM ranking_reports rr
JOIN keywords k   ON k.id = rr.keyword_id
JOIN businesses b ON b.id = k.business_id
JOIN clients c    ON c.id = b.client_id
WHERE c.id = 162        -- change to client of interest
ORDER BY rr.keyword_id, rr.platform, rr.date DESC;
```

```sql
-- Free-trial clients with at least one top-3 keyword (graduation candidates)
SELECT c.id, c.business_name, COUNT(*) FILTER (WHERE rr.ranking_position <= 3) AS top3_count
FROM clients c
JOIN client_aeo_plans cap ON cap.client_id = c.id
JOIN businesses b         ON b.client_id = c.id
JOIN keywords k           ON k.business_id = b.id
JOIN ranking_reports rr   ON rr.keyword_id = k.id
WHERE cap.plan_type = 'Free Trial Plans'
  AND rr.status = 'success'
GROUP BY c.id, c.business_name
HAVING COUNT(*) FILTER (WHERE rr.ranking_position <= 3) > 0
ORDER BY top3_count DESC;
```

### Status values cheat-sheet

- `ranking_reports.status` is `success` or `error` (never "pass" / "fail").
- `ranking_position` is `NULL` when the audit failed or the keyword wasn't found on the platform.
- `ranking_reports.date` is a `YYYY-MM-DD` text column (Eastern Time anchored). Use `date >= '2026-06-01'` directly — don't cast to timestamp.

---

## 2. S3 access for screenshots

Every successful ranking audit has a PNG of the chat result. The `screenshot_url` column on `ranking_reports` is the path inside the bucket.

### Setup

| Field       | Value                                                           |
| ----------- | --------------------------------------------------------------- |
| IAM user    | `russ-screenshots`                                              |
| Access key  | _1Password → AEOAdmin → "Russ — S3 screenshots"_                |
| Secret      | _1Password → same entry_                                        |
| Permissions | `s3:GetObject` + `s3:ListBucket` on `aeo-rank-screenshots` only |
| Bucket      | `aeo-rank-screenshots` (region `us-east-1`)                     |

### Configure the AWS CLI

Run once on the machine you'll be downloading from. Paste the key + secret from 1Password when prompted:

```bash
aws configure --profile aeo-russ
# AWS Access Key ID:     <from 1Password>
# AWS Secret Access Key: <from 1Password>
# Default region name:   us-east-1
# Default output format: json
```

### Download a screenshot

The `screenshot_url` column already contains the full key inside the bucket, e.g.
`clients/162-some-client/keywords/4123-ceramic-coating/chatgpt/2026-06-10_rank2_steady.png`.

```bash
KEY="clients/162-some-client/keywords/4123-ceramic-coating/chatgpt/2026-06-10_rank2_steady.png"
aws s3 cp --profile aeo-russ "s3://aeo-rank-screenshots/$KEY" .
```

### Download an entire client's screenshots

```bash
aws s3 sync --profile aeo-russ \
  "s3://aeo-rank-screenshots/clients/162-some-client/" \
  ./russ-downloads/client-162/
```

### Generate a temporary share link

If you want to send one PNG to someone without giving them AWS access — sign a URL that's valid for an hour:

```bash
aws s3 presign --profile aeo-russ \
  "s3://aeo-rank-screenshots/$KEY" \
  --expires-in 3600
```

---

## 3. What you cannot do (by design)

- Write to the database (any `INSERT` / `UPDATE` / `DELETE` returns a permission error).
- Read any table outside the five listed above.
- See or modify objects in S3 buckets other than `aeo-rank-screenshots`.
- Log into the admin panel UI — this is data-access only. If you want a UI walkthrough, the AEOAdmin owner can demo it.

If you hit a "permission denied" on something you think you need, ping the AEOAdmin owner — granting an extra table or a second bucket is a one-line change, but we want it logged.

---

## 4. If credentials leak

Tell the AEOAdmin owner immediately so we can rotate. Both sets of credentials are scoped so the blast radius is bounded:

- **Postgres password leak** — rotate with `ALTER ROLE russ_readonly WITH PASSWORD '<new>';` (owner runs this connected as the `postgres` superuser).
- **AWS key leak** — `aws iam delete-access-key --user-name russ-screenshots --access-key-id <old>` then `aws iam create-access-key --user-name russ-screenshots`. Old key stops working immediately.

---

## Related docs

- [DATABASE_ACCESS.md](./DATABASE_ACCESS.md) — full database access guide for all roles (read API, write API, owners).
- [SCHEMA.md](./SCHEMA.md) — full table reference. Russ's five tables are documented there along with everything else.
- [RANK_SCREENSHOTS_S3.md](./RANK_SCREENSHOTS_S3.md) — full S3 bucket layout / key scheme / executor contract.
