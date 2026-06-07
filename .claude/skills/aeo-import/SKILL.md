---
name: aeo-import
description: Preflight, import, and verify an AEO daily-sessions or ranking-audit CSV against prod. Enforces the hard rules — correct date, 8am–6pm UTC window, populated mocks/variants for daily, randomized client order, no double-import. Handles the bundled ZIP (CSV + screenshots) for audit imports.
argument-hint: "<csv-or-zip-path> [expected-date YYYY-MM-DD]"
---

You are running the **AEO import pipeline** against prod. The user gave you one or more file paths; figure out what each file is and run it through the matching flow.

## File-type detection

Inspect the file first — don't trust the name.

| Pattern in filename / first row                                                             | Kind                            | Importer                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------- |
| `*daily*.csv` or column `wave_index`                                                        | **daily sessions**              | `scripts/import-daily-sessions-api.mjs`  |
| `*rabbitmq_audit*.csv` or columns include `rank_position,rank_total,mentioned,rank_context` | **ranking audit**               | `scripts/import-audit-logs-api.mjs`      |
| `*ranking*with_screenshots*.zip`                                                            | **bundled audit + screenshots** | unzip → audit import + screenshot upload |

If you can't tell, ASK before doing anything.

## Hard preflight checks — abort on any failure

Parse every CSV with the same parser the importer uses (handles quoted-comma fields). Do not use `awk -F','`.

### Universal (daily AND audit)

1. **Row count > 0** and matches what the user said.
2. **All rows `status = success`**. If even one is `error`, list them and stop unless the user explicitly accepts.
3. **All rows share one `date`** — that date must match the **filename**'s date (e.g. `jun06_*` → `2026-06-06`). If the rows' date doesn't match the filename, **auto-rewrite** the date + the `YYYY-MM-DD` prefix of every `timestamp` to the filename's date, preserving the `HH:MM:SS` portion. Write the fixed CSV alongside the original as `<basename>.fixed.csv` and import the fixed one. Tell the user what you rewrote.
4. **Timestamps within `08:00:00Z` – `18:00:00Z`** on that date. Out-of-window rows are bugs for **daily** imports — abort. For **audit/ranking** imports they are acceptable (the producer often does stale catch-up runs that span wider hours), but the _date_ must still be correct.
5. **Platforms balanced** — chatgpt / gemini / perplexity counts within ~5% of each other. Big skew (e.g. one platform missing a chunk) is a producer bug worth flagging.
6. **All `client_id` values resolve** to a row in `clients`. List any that don't.
7. **No double-import**: query prod for rows already on that date in the matching table (`sessions` for daily, `audit_logs`+`ranking_reports` for audit). Anything > 0 means stop and confirm.

### Daily-only (extra)

8. **Mocked location populated** — every row should have `mocked_latitude` and `mocked_longitude` within ~5 miles of the business's `base_latitude/base_longitude`. If any are blank, **auto-generate** them locally before importing:
   - Use the device-agent's algorithm: `randomize_location(base_lat, base_lng, radius=5.0)` → uniform-on-disc sampler (`/Users/seolocalph/projects/device-agent/run_with_proxy.py:99`).
   - Fall back to the row's `proxy_city/proxy_region` only if `base_latitude` is also blank.
   - Write the patched rows back into `<basename>.fixed.csv`.
   - Report the count of generated mocks and a 3-row sample so the user can spot-check.
9. **Variants populated** — `keyword_variant` non-null on **every** row. Blanks mean variant generation didn't run. Abort.
10. **Randomized client order, not batched.** Walk the CSV in row order; for the first 200 rows count the longest consecutive run of the same `client_id`. A run > 5 means the producer batched clients sequentially instead of interleaving — that's a bug the user wants caught. Report the offending client_ids.

### Audit-only (extra)

8. **Screenshot expectation.** The user typically reports "N/M screenshots". For each row, check the `screenshot` column. Confirm `with_screenshot_count` matches what they expect (M of N). If a ZIP was given, after unzipping verify the on-disk PNG count matches.

## Importer invocation

Always run from `/Users/seolocalph/projects/AEOAdmin/` with these env vars sourced from Secrets Manager `aeo-admin/prod`:

```bash
SECRET_JSON=$(AWS_PROFILE=aeo-admin aws secretsmanager get-secret-value \
  --secret-id aeo-admin/prod --region us-east-1 --query SecretString --output text)
export DATABASE_URL=$(echo "$SECRET_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.parse(d).DATABASE_URL)})")
export EXECUTOR_TOKEN=$(echo "$SECRET_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.parse(d).EXECUTOR_TOKEN)})")
export API_BASE=https://jjm59vpn3y.us-east-1.awsapprunner.com
node scripts/import-daily-sessions-api.mjs <csv-path>   # OR import-audit-logs-api.mjs
```

## Failure-retry semantics — CRITICAL

The daily importer logs at most **5** failure rows but reports the true `failed` count. If `failed > 0`:

1. Do NOT re-run the full CSV — every POST inserts a new row, you'll dupe everything.
2. Pull the CSV again, match each row to its expected DB key using the importer's **same** keyword resolver: `(lower(keyword_text), aeo_plan_id) → keyword_id`. Match the timestamp as `csv_ts - 8h` (the historic pg-node TZ shift — see [docs/handover].md and the May/Jun import scripts).
3. Insert only the rows whose expected `(keyword_id, platform, ts)` is missing in `sessions`.
4. Template script: `scripts/_retry-jun03-missing-correct.mjs` — copy it for the date in question.

## Audit + screenshot bundle (ZIP path)

1. `unzip -l` to list contents — don't extract yet.
2. Confirm exactly one `*.csv` and a tree of `*.png` files.
3. `unzip` into a fresh dir.
4. Run the audit importer on the CSV. The `screenshot_path` column points at absolute paths; the importer stores them as-is in `audit_logs.screenshot_path`.
5. **After** the audit import succeeds, run `scripts/_upload-<date>-screenshots.mjs` (copy `_upload-may30-screenshots.mjs` as template, change `DATE`). It joins ranking*reports → audit_logs by `(keyword_id, platform)`, uploads each PNG to S3 under `clients/<id>-<slug>/keywords/<id>-<slug>/<platform>/<date>\_rank<N>*<trend>.png`, then patches `ranking_reports.screenshot_url`with the`s3://…` URI.
6. The 1 row without a screenshot is normal (one will be missing for various reasons) — confirm by name not count.

## Post-import verification

Always re-query prod after the importer claims success.

| Imported    | Verify against prod                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Daily       | `SELECT count, by ai_platform FROM sessions WHERE timestamp >= '<date>' AND timestamp < '<date>+1d'` matches CSV total ± 0. |
| Audit       | `audit_logs` count on that date == CSV rows. `ranking_reports` count for the target client_ids == CSV rows.                 |
| Screenshots | `ranking_reports WHERE date='<date>' AND screenshot_url LIKE 's3://%'` == upload script's `ok` count.                       |

If counts don't match, run the retry path above. Never silently accept a mismatch.

## What you say to the user before importing

Always confirm before running the importer:

1. The kind of import (daily / audit / bundle).
2. The date you'll pin it to.
3. The row count, platform split, and any non-success rows.
4. Any preflight failures you found.
5. Current DB state for that date (0 means clean to import; > 0 needs reconciliation).
6. Ask **"go?"** before invoking the importer.

Never assume the user wants a retry on partial failure — surface the 6 missed rows and ask.
