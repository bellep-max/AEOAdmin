# RBAC Scope — Per-Endpoint Role Gating Proposal

**Date:** 2026-06-09
**Audit target:** `/Users/seolocalph/projects/AEOAdmin/artifacts/api-server/src/routes/` (28 route files)
**Role model:** subsumptive hierarchy `viewer < editor < admin < owner`; parallel `customer` for `/portal/*`; machine clients use token gates (`api-token`, `executor-or-owner`, `onboarding`, `free-trial`).

Mounts in `routes/index.ts`:

```
/auth, /metrics, /clients, /businesses,
/clients/:clientId/aeo-plans, /aeo-plans,
/keywords, /sessions, /devices, /proxies, /plans,
/ranking-reports, /ranking-runs, /tasks, /dashboard,
/scaling, /farm-metrics, /audit-logs, /packages,
/onboarding, /proofs,
(/api/keywords/.../variants legacy aliased through keyword-variants),
/analytics, /llm, /rankings (rankings-email), /portal, /location
```

---

## 1. health.ts (mounted at `/`)

| Method | Path (mounted) | Current middleware | Proposed role gate           | Notes                                                                                                                                                                                               |
| ------ | -------------- | ------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/healthz`     | none               | `public`                     | Liveness probe — must stay open.                                                                                                                                                                    |
| POST   | `/seed-admin`  | none               | `admin` (or remove entirely) | **DANGEROUS** — currently anyone can seed `admin@signalaeo.com` with a known password. Comment says "only for development." Production must either delete this route or gate to `admin` + env flag. |

---

## 2. auth.ts (mounted at `/auth`)

| Method | Path (mounted)          | Current middleware     | Proposed role gate | Notes                                                        |
| ------ | ----------------------- | ---------------------- | ------------------ | ------------------------------------------------------------ |
| POST   | `/auth/login`           | none + impl auth check | `public`           | Login endpoint; rate-limit recommended (currently none).     |
| POST   | `/auth/logout`          | none                   | `public`           | Idempotent destroy.                                          |
| GET    | `/auth/me`              | impl auth check        | `viewer`           | Any authenticated user. Currently returns 401 if no session. |
| POST   | `/auth/change-password` | impl auth check        | `viewer` (self)    | Operates on own user; valid for all roles incl. `customer`.  |
| POST   | `/auth/request-code`    | rate-limited           | `public`           | Passwordless step 1 (email OTP). Has IP throttle.            |
| POST   | `/auth/verify-code`     | rate-limited           | `public`           | Passwordless step 2 — issues `customer` session.             |
| POST   | `/auth/google`          | none                   | `public`           | Google ID-token login → customer/admin session.              |

---

## 3. metrics.ts (mounted at `/metrics`)

| Method | Path (mounted)               | Current middleware | Proposed role gate | Notes                                                             |
| ------ | ---------------------------- | ------------------ | ------------------ | ----------------------------------------------------------------- |
| GET    | `/metrics/session-breakdown` | none               | `viewer`           | Aggregated stats, no per-client PII; safe for any internal role.  |
| GET    | `/metrics/business`          | none               | `viewer`           | Per-client KPI matrix — internal only.                            |
| GET    | `/metrics/performance`       | none               | `viewer`           | Farm-wide KPIs.                                                   |
| PATCH  | `/metrics/performance/:key`  | none               | `admin`            | Edits `farm_metrics` target/value — gate to admin (config write). |

---

## 4. clients.ts (mounted at `/clients`)

| Method | Path (mounted)             | Current middleware | Proposed role gate                                            | Notes                                                                                                         |
| ------ | -------------------------- | ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/clients`                 | none               | `viewer`                                                      | Master client list.                                                                                           |
| POST   | `/clients`                 | none               | `admin`                                                       | Creates a top-level client — identity-changing.                                                               |
| GET    | `/clients/:id`             | none               | `viewer`                                                      |                                                                                                               |
| PATCH  | `/clients/:id`             | none               | `editor` (notes/status) / `admin` (rename, plan, accountType) | Mixes operational edits with identity changes; consider splitting into `PATCH …/notes` and `PATCH …/profile`. |
| DELETE | `/clients/:id`             | none               | `admin`                                                       | Soft-archive + cascades `is_active=false` to keywords/links.                                                  |
| POST   | `/clients/:id/restore`     | none               | `admin`                                                       | Unarchive → reactivates rotation.                                                                             |
| GET    | `/clients/:id/gbp-snippet` | none               | `viewer`                                                      | Read-only summary.                                                                                            |
| GET    | `/clients/:id/aeo-summary` | none               | `viewer`                                                      | Read-only summary.                                                                                            |

---

## 5. businesses.ts (mounted at `/businesses`)

| Method | Path (mounted)    | Current middleware | Proposed role gate | Notes                                 |
| ------ | ----------------- | ------------------ | ------------------ | ------------------------------------- |
| GET    | `/businesses`     | none               | `viewer`           |                                       |
| GET    | `/businesses/:id` | none               | `viewer`           |                                       |
| POST   | `/businesses`     | none               | `admin`            | Creates child entity under a client.  |
| PATCH  | `/businesses/:id` | none               | `editor`           | Field updates incl. notes/GBP fields. |
| DELETE | `/businesses/:id` | none               | `admin`            | Hard delete (CASCADE).                |

---

## 6. client-aeo-plans.ts (mounted at `/clients/:clientId/aeo-plans`)

| Method | Path (mounted)                         | Current middleware | Proposed role gate | Notes                                                                        |
| ------ | -------------------------------------- | ------------------ | ------------------ | ---------------------------------------------------------------------------- |
| GET    | `/clients/:clientId/aeo-plans`         | none               | `viewer`           |                                                                              |
| GET    | `/clients/:clientId/aeo-plans/:planId` | none               | `viewer`           |                                                                              |
| POST   | `/clients/:clientId/aeo-plans`         | none               | `admin`            | Creates campaign.                                                            |
| PATCH  | `/clients/:clientId/aeo-plans/:planId` | none               | `editor`           | Sample-questions/notes edits = editor; consider admin for `planType` change. |
| DELETE | `/clients/:clientId/aeo-plans/:planId` | none               | `admin`            | Hard delete.                                                                 |

---

## 7. aeo-plans.ts (mounted at `/aeo-plans`)

| Method | Path (mounted) | Current middleware | Proposed role gate | Notes                                  |
| ------ | -------------- | ------------------ | ------------------ | -------------------------------------- |
| GET    | `/aeo-plans`   | none               | `viewer`           | Global list (joined with client name). |

---

## 8. keywords.ts (mounted at `/keywords`)

| Method | Path (mounted)                       | Current middleware | Proposed role gate | Notes                                                    |
| ------ | ------------------------------------ | ------------------ | ------------------ | -------------------------------------------------------- |
| GET    | `/keywords`                          | none               | `viewer`           |                                                          |
| GET    | `/keywords/:id`                      | none               | `viewer`           |                                                          |
| POST   | `/keywords`                          | none               | `editor`           | Adding keywords to an existing campaign is editor-level. |
| GET    | `/keywords/:id/links`                | none               | `viewer`           |                                                          |
| POST   | `/keywords/:id/links`                | none               | `editor`           | Adds a backlink — operational.                           |
| PATCH  | `/keywords/:id/links/:linkId`        | none               | `editor`           |                                                          |
| DELETE | `/keywords/:id/links/:linkId`        | none               | `editor`           |                                                          |
| PATCH  | `/keywords/:id`                      | none               | `editor`           | Field updates; archiveAt/replacementSuggestion present.  |
| DELETE | `/keywords/:id`                      | none               | `admin`            | Soft-archive.                                            |
| POST   | `/keywords/:id/archive`              | none               | `admin`            | Explicit archive.                                        |
| POST   | `/keywords/:id/generate-replacement` | none               | `owner`            | Calls LLM (DeepSeek) → beta / cost-bearing.              |
| GET    | `/keywords/:id/variants`             | none               | `viewer`           | List variants.                                           |
| POST   | `/keywords/:id/variants/generate`    | none               | `owner`            | LLM generation.                                          |
| POST   | `/keywords/rotate-winners`           | none               | `owner`            | Rotation control — already in owner-feature bucket.      |

---

## 9. sessions.ts (mounted at `/sessions`)

| Method | Path (mounted)                 | Current middleware     | Proposed role gate  | Notes                                                 |
| ------ | ------------------------------ | ---------------------- | ------------------- | ----------------------------------------------------- |
| GET    | `/sessions`                    | none                   | `viewer`            | List.                                                 |
| POST   | `/sessions`                    | `requireExecutorToken` | `executor-or-owner` | Runner-side write.                                    |
| PATCH  | `/sessions/:id`                | `requireExecutorToken` | `executor-or-owner` | Backfill field updater.                               |
| PATCH  | `/sessions/:id/timestamp`      | `requireExecutorToken` | `executor-or-owner` |                                                       |
| PATCH  | `/sessions/:id/screenshot`     | none                   | `editor`            | **No auth today** — should require editor at minimum. |
| GET    | `/sessions/:id/screenshot-url` | none                   | `viewer`            | Issues short-lived signed URL.                        |
| PATCH  | `/sessions/:id/followup`       | none                   | `editor`            | **No auth today**.                                    |
| DELETE | `/sessions/:id`                | none                   | `admin`             | **No auth today** — destructive.                      |
| GET    | `/sessions/stress-test`        | none                   | `viewer`            | Read-only diagnostics.                                |
| POST   | `/sessions/import`             | `requireSession`       | `admin`             | CSV bulk import — admin-only.                         |

---

## 10. devices.ts (mounted at `/devices`)

| Method | Path (mounted)         | Current middleware | Proposed role gate | Notes                                                                |
| ------ | ---------------------- | ------------------ | ------------------ | -------------------------------------------------------------------- |
| GET    | `/devices/farm-status` | none               | `viewer`           |                                                                      |
| GET    | `/devices`             | none               | `viewer`           |                                                                      |
| POST   | `/devices`             | none               | `admin`            | Adds device to fleet.                                                |
| PATCH  | `/devices/:id`         | none               | `editor`           | Status/identifier updates — operational. Admin if you want stricter. |

---

## 11. proxies.ts (mounted at `/proxies`)

| Method | Path (mounted) | Current middleware | Proposed role gate    | Notes                                                                                                                                                         |
| ------ | -------------- | ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/proxies`     | none               | `viewer` (or `admin`) | **Returns plaintext proxy passwords.** Strongly recommend gating to `admin` regardless of hierarchy, or stripping the `password` field for non-admin viewers. |
| POST   | `/proxies`     | none               | `admin`               | Credential write.                                                                                                                                             |
| PATCH  | `/proxies/:id` | none               | `admin`               | Credential write.                                                                                                                                             |
| DELETE | `/proxies/:id` | none               | `admin`               |                                                                                                                                                               |

---

## 12. plans.ts (mounted at `/plans`)

| Method | Path (mounted) | Current middleware | Proposed role gate | Notes                             |
| ------ | -------------- | ------------------ | ------------------ | --------------------------------- |
| GET    | `/plans`       | none               | `viewer`           | Read-only service plan catalogue. |

---

## 13. ranking-reports.ts (mounted at `/ranking-reports`)

| Method | Path (mounted)                          | Current middleware     | Proposed role gate  | Notes                                                                         |
| ------ | --------------------------------------- | ---------------------- | ------------------- | ----------------------------------------------------------------------------- |
| GET    | `/ranking-reports`                      | `requireApiToken`      | `api-token`         | Public bearer-token API; keep as-is.                                          |
| POST   | `/ranking-reports`                      | `requireExecutorToken` | `executor-or-owner` | Upsert from runner.                                                           |
| POST   | `/ranking-reports/dedupe`               | `requireExecutorToken` | `admin`             | One-time cleanup; should be admin (not runner).                               |
| PATCH  | `/ranking-reports/:id`                  | `requireExecutorToken` | `executor-or-owner` | Runner backfill — also called by manual scripts.                              |
| DELETE | `/ranking-reports/:id`                  | `requireExecutorToken` | `admin`             | Destructive — should be admin, not runner.                                    |
| GET    | `/ranking-reports/platform-summary`     | none                   | `viewer`            |                                                                               |
| GET    | `/ranking-reports/per-keyword-platform` | none                   | `viewer`            |                                                                               |
| GET    | `/ranking-reports/period-comparison`    | none                   | `viewer`            |                                                                               |
| GET    | `/ranking-reports/initial-vs-current`   | none                   | `viewer`            |                                                                               |
| GET    | `/ranking-reports/bi-weekly-report`     | none                   | `owner`             | Beta/Reports feature — currently visible to all admins; per spec, owner-only. |
| GET    | `/ranking-reports/:id/screenshot-url`   | none                   | `viewer`            | Comment says "no auth required"; should still require viewer.                 |

---

## 14. ranking-runs.ts (mounted at `/ranking-runs`)

| Method | Path (mounted)                 | Current middleware     | Proposed role gate  | Notes        |
| ------ | ------------------------------ | ---------------------- | ------------------- | ------------ |
| GET    | `/ranking-runs`                | none                   | `viewer`            |              |
| GET    | `/ranking-runs/latest`         | none                   | `viewer`            |              |
| GET    | `/ranking-runs/latest-detail`  | none                   | `viewer`            |              |
| GET    | `/ranking-runs/latest-records` | none                   | `viewer`            |              |
| POST   | `/ranking-runs`                | `requireExecutorToken` | `executor-or-owner` | Runner.      |
| PATCH  | `/ranking-runs/:id`            | `requireExecutorToken` | `executor-or-owner` | Runner.      |
| DELETE | `/ranking-runs/:id`            | `requireExecutorToken` | `admin`             | Destructive. |

---

## 15. tasks.ts (mounted at `/tasks`)

| Method | Path (mounted)                       | Current middleware | Proposed role gate    | Notes                                            |
| ------ | ------------------------------------ | ------------------ | --------------------- | ------------------------------------------------ |
| GET    | `/tasks`                             | none               | `viewer`              | Internal kanban; no PII.                         |
| POST   | `/tasks`                             | none               | `editor`              |                                                  |
| PATCH  | `/tasks/:id`                         | none               | `editor`              |                                                  |
| DELETE | `/tasks/:id`                         | none               | `editor` (or `admin`) | Operational delete; could be editor if low-risk. |
| POST   | `/tasks/:id/subtasks`                | none               | `editor`              |                                                  |
| PATCH  | `/tasks/:taskId/subtasks/:subtaskId` | none               | `editor`              |                                                  |

---

## 16. dashboard.ts (mounted at `/dashboard`)

| Method | Path (mounted)                  | Current middleware | Proposed role gate | Notes |
| ------ | ------------------------------- | ------------------ | ------------------ | ----- |
| GET    | `/dashboard/summary`            | none               | `viewer`           |       |
| GET    | `/dashboard/session-activity`   | none               | `viewer`           |       |
| GET    | `/dashboard/platform-breakdown` | none               | `viewer`           |       |
| GET    | `/dashboard/network-health`     | none               | `viewer`           |       |

---

## 17. scaling.ts (mounted at `/scaling`)

| Method | Path (mounted)  | Current middleware | Proposed role gate | Notes                                |
| ------ | --------------- | ------------------ | ------------------ | ------------------------------------ |
| GET    | `/scaling/plan` | none               | `viewer`           | Hard-coded milestones + live counts. |

---

## 18. farm-metrics.ts (mounted at `/farm-metrics`)

| Method | Path (mounted)       | Current middleware | Proposed role gate | Notes                                                            |
| ------ | -------------------- | ------------------ | ------------------ | ---------------------------------------------------------------- |
| GET    | `/farm-metrics`      | none               | `viewer`           |                                                                  |
| PATCH  | `/farm-metrics/:key` | none               | `admin`            | Config write — same bucket as `PATCH /metrics/performance/:key`. |

---

## 19. audit-logs.ts (mounted at `/audit-logs`)

| Method | Path (mounted)                   | Current middleware     | Proposed role gate  | Notes                                                                                         |
| ------ | -------------------------------- | ---------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/audit-logs`                    | none                   | `viewer`            |                                                                                               |
| POST   | `/audit-logs`                    | `requireExecutorToken` | `executor-or-owner` | Runner write.                                                                                 |
| POST   | `/audit-logs/sync`               | none                   | `admin`             | **No auth today** — backfills audit_logs from ranking_reports. Destructive-ish (mass-insert). |
| DELETE | `/audit-logs/:id`                | none                   | `admin`             | **No auth today** — destructive.                                                              |
| GET    | `/audit-logs/:id/screenshot-url` | none                   | `viewer`            |                                                                                               |

---

## 20. packages.ts (mounted at `/packages`)

| Method | Path (mounted)  | Current middleware | Proposed role gate | Notes            |
| ------ | --------------- | ------------------ | ------------------ | ---------------- |
| GET    | `/packages`     | none               | `viewer`           |                  |
| POST   | `/packages`     | none               | `admin`            | Catalogue write. |
| DELETE | `/packages/:id` | none               | `admin`            |                  |

---

## 21. onboarding.ts (mounted at `/onboarding`)

| Method | Path (mounted)           | Current middleware       | Proposed role gate | Notes                                             |
| ------ | ------------------------ | ------------------------ | ------------------ | ------------------------------------------------- |
| POST   | `/onboarding`            | `requireOnboardingToken` | `onboarding`       | Recurly intake — keep token gate.                 |
| POST   | `/onboarding/free-trial` | `requireFreeTrialToken`  | `free-trial`       | External marketing site intake — keep token gate. |

---

## 22. proofs.ts (mounted at `/proofs`)

| Method | Path (mounted)     | Current middleware      | Proposed role gate                 | Notes                                                            |
| ------ | ------------------ | ----------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| GET    | `/proofs`          | `requireFreeTrialToken` | `free-trial`                       | CRM JSON read; keep token gate.                                  |
| POST   | `/proofs/backfill` | `requireFreeTrialToken` | `free-trial` (or split to `admin`) | Backfill writes to S3. Reasonable to also/instead allow `admin`. |

---

## 23. keyword-variants.ts (mounted at `/` — no prefix)

Routes are nested under `/keywords/...` and `/keyword-variants/...` and `/prompt-templates`.

| Method | Path (mounted)                             | Current middleware     | Proposed role gate  | Notes                                                         |
| ------ | ------------------------------------------ | ---------------------- | ------------------- | ------------------------------------------------------------- |
| GET    | `/keywords/:keywordId/variants`            | none                   | `viewer`            | Legacy; duplicate of `/keywords/:id/variants` in keywords.ts. |
| POST   | `/keywords/:keywordId/variants/regenerate` | none                   | `owner`             | LLM call — beta/cost.                                         |
| GET    | `/keywords/:keywordId/variants/random`     | `requireExecutorToken` | `executor-or-owner` | Runner picks variant + bumps counter.                         |
| DELETE | `/keyword-variants/:id`                    | none                   | `admin`             | **No auth today** — destructive.                              |
| POST   | `/keyword-variants/regenerate-all`         | `requireExecutorToken` | `executor-or-owner` | Cron entry.                                                   |
| GET    | `/prompt-templates`                        | none                   | `viewer`            | Read-only mirror. Duplicate of `/llm/prompt-templates`.       |

---

## 24. analytics.ts (mounted at `/analytics`)

| Method | Path (mounted)                 | Current middleware       | Proposed role gate  | Notes                      |
| ------ | ------------------------------ | ------------------------ | ------------------- | -------------------------- |
| GET    | `/analytics/daily-context`     | `requireExecutorToken`   | `executor-or-owner` | Legacy context endpoint.   |
| GET    | `/analytics/session-context`   | `requireExecutorToken`   | `executor-or-owner` | Daily session-ops context. |
| GET    | `/analytics/audit-context`     | `requireExecutorOrOwner` | `executor-or-owner` | Already correct.           |
| POST   | `/analytics/audit-report/run`  | `requireExecutorOrOwner` | `executor-or-owner` | LLM run.                   |
| GET    | `/analytics/audit-reports`     | `requireOwner`           | `owner`             | Already correct.           |
| GET    | `/analytics/audit-reports/:id` | `requireOwner`           | `owner`             | Already correct.           |

---

## 25. llm.ts (mounted at `/llm`)

| Method | Path (mounted)                        | Current middleware       | Proposed role gate  | Notes                                                                                                |
| ------ | ------------------------------------- | ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/llm/prompt-templates`               | none                     | `viewer`            | Read-only mirror.                                                                                    |
| GET    | `/llm/variants-overview`              | `requireOwner`           | `owner`             | Already correct.                                                                                     |
| GET    | `/llm/variants/:keywordId`            | none                     | `viewer`            |                                                                                                      |
| POST   | `/llm/variants/:keywordId/regenerate` | none                     | `owner`             | **No auth today** — LLM cost.                                                                        |
| GET    | `/llm/variants/:keywordId/random`     | `requireExecutorToken`   | `executor-or-owner` | Runner.                                                                                              |
| DELETE | `/llm/variants/by-id/:id`             | none                     | `admin`             | **No auth today** — destructive.                                                                     |
| POST   | `/llm/variants/regenerate-all`        | `requireExecutorOrOwner` | `executor-or-owner` | Cron entry.                                                                                          |
| POST   | `/llm/build-session`                  | `requireExecutorToken`   | `executor-or-owner` | Runner builds prompt for one session.                                                                |
| GET    | `/llm/keyword/:id/rank-eligibility`   | `requireExecutorToken`   | `executor-or-owner` | Runner lock check.                                                                                   |
| POST   | `/llm/build-audit`                    | `requireExecutorToken`   | `executor-or-owner` | Runner.                                                                                              |
| POST   | `/llm/build-session-static`           | `requireExecutorToken`   | `executor-or-owner` | Runner stateless variant.                                                                            |
| POST   | `/llm/build-audit-static`             | `requireExecutorToken`   | `executor-or-owner` | Runner stateless variant.                                                                            |
| POST   | `/llm/audit-report/run`               | `requireExecutorOrOwner` | `executor-or-owner` | Runs LLM analyst.                                                                                    |
| GET    | `/llm/audit-reports`                  | `requireOwner`           | `owner`             | Already correct.                                                                                     |
| GET    | `/llm/audit-reports/:id`              | `requireOwner`           | `owner`             | Already correct.                                                                                     |
| DELETE | `/llm/audit-reports/:id`              | `requireOwner`           | `owner`             | Already correct.                                                                                     |
| GET    | `/llm/audit-context`                  | `requireExecutorOrOwner` | `executor-or-owner` | Already correct.                                                                                     |
| POST   | `/llm/aeo-reporter/stream`            | `requireSession`         | `owner`             | Currently any logged-in session works; spec gates AEO Reporter to owners — narrow to `requireOwner`. |

---

## 26. rankings-email.ts (mounted at `/rankings`)

| Method | Path (mounted)                         | Current middleware | Proposed role gate                   | Notes                                                                                     |
| ------ | -------------------------------------- | ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| GET    | `/rankings/email-config`               | none               | `viewer`                             | Reports SendGrid config state.                                                            |
| GET    | `/rankings/email-recipients/:clientId` | none               | `editor`                             | **No auth today** — surfaces client email addresses (PII).                                |
| GET    | `/rankings/email-preview`              | none               | `editor`                             | **No auth today** — renders preview HTML; not destructive but PII-bearing.                |
| GET    | `/rankings/email-templates`            | none               | `editor`                             | **No auth today**.                                                                        |
| POST   | `/rankings/email-ai-suggest`           | none               | `editor` (or `owner` since it's LLM) | **No auth today** — calls DeepSeek (cost) and surfaces summary data.                      |
| POST   | `/rankings/send-report`                | none               | `editor`                             | **No auth today — actually sends email!** Should require at least editor; consider admin. |
| GET    | `/rankings/email-sends`                | none               | `viewer`                             | Send log list. **No auth today.**                                                         |

---

## 27. portal.ts (mounted at `/portal`)

All routes use `requirePortalAuth` + `requireLinkedClient` (which forces `role === 'customer'`). All are correctly gated as `customer`.

| Method | Path (mounted)                                         | Current middleware | Proposed role gate | Notes                    |
| ------ | ------------------------------------------------------ | ------------------ | ------------------ | ------------------------ |
| GET    | `/portal/businesses/me`                                | portal+linked      | `customer`         |                          |
| PATCH  | `/portal/businesses/me`                                | portal+linked      | `customer`         |                          |
| POST   | `/portal/businesses/me`                                | portal+linked      | `customer`         |                          |
| GET    | `/portal/businesses/me/dashboard`                      | portal+linked      | `customer`         |                          |
| GET    | `/portal/businesses/me/keywords`                       | portal+linked      | `customer`         |                          |
| POST   | `/portal/businesses/me/keywords`                       | portal+linked      | `customer`         |                          |
| PATCH  | `/portal/businesses/me/keywords/:id`                   | portal+linked      | `customer`         |                          |
| DELETE | `/portal/businesses/me/keywords/:id`                   | portal+linked      | `customer`         |                          |
| GET    | `/portal/businesses/me/keywords/:id/links`             | portal+linked      | `customer`         |                          |
| POST   | `/portal/businesses/me/keywords/:id/links`             | portal+linked      | `customer`         |                          |
| DELETE | `/portal/businesses/me/keywords/links/:linkId`         | portal+linked      | `customer`         |                          |
| POST   | `/portal/businesses/me/keywords/links/:linkId/analyze` | portal+linked      | `customer`         | Stub today; will be LLM. |
| GET    | `/portal/businesses/me/gbp`                            | portal+linked      | `customer`         |                          |
| POST   | `/portal/businesses/me/gbp`                            | portal+linked      | `customer`         |                          |
| GET    | `/portal/businesses/me/websites`                       | portal+linked      | `customer`         | Stub.                    |
| POST   | `/portal/businesses/me/websites`                       | portal+linked      | `customer`         | Stub.                    |
| GET    | `/portal/businesses/me/reports`                        | portal+linked      | `customer`         |                          |
| GET    | `/portal/dashboard/summary`                            | portal+linked      | `customer`         |                          |
| GET    | `/portal/clients/me`                                   | portal+linked      | `customer`         |                          |
| PATCH  | `/portal/clients/me`                                   | portal+linked      | `customer`         |                          |
| GET    | `/portal/keywords`                                     | portal+linked      | `customer`         | Admin-shape.             |
| GET    | `/portal/keywords/:id`                                 | portal+linked      | `customer`         |                          |
| POST   | `/portal/keywords`                                     | portal+linked      | `customer`         |                          |
| PATCH  | `/portal/keywords/:id`                                 | portal+linked      | `customer`         |                          |
| DELETE | `/portal/keywords/:id`                                 | portal+linked      | `customer`         |                          |
| GET    | `/portal/keywords/:id/links`                           | portal+linked      | `customer`         |                          |
| POST   | `/portal/keywords/:id/links`                           | portal+linked      | `customer`         |                          |
| PATCH  | `/portal/keywords/:id/links/:linkId`                   | portal+linked      | `customer`         |                          |
| DELETE | `/portal/keywords/:id/links/:linkId`                   | portal+linked      | `customer`         |                          |
| GET    | `/portal/ranking-reports`                              | portal+linked      | `customer`         |                          |
| GET    | `/portal/ranking-reports/:id`                          | portal+linked      | `customer`         |                          |
| GET    | `/portal/rankings/bi-weekly-report`                    | portal+linked      | `customer`         |                          |
| GET    | `/portal/ranking-runs`                                 | portal+linked      | `customer`         | Stub.                    |
| GET    | `/portal/ranking-runs/latest`                          | portal+linked      | `customer`         | Stub.                    |
| GET    | `/portal/ranking-runs/latest-detail`                   | portal+linked      | `customer`         | Stub.                    |
| GET    | `/portal/aeo-plans`                                    | portal+linked      | `customer`         |                          |
| GET    | `/portal/aeo-plans/:planId`                            | portal+linked      | `customer`         |                          |
| POST   | `/portal/aeo-plans`                                    | portal+linked      | `customer`         |                          |
| PATCH  | `/portal/aeo-plans/:planId`                            | portal+linked      | `customer`         |                          |
| DELETE | `/portal/aeo-plans/:planId`                            | portal+linked      | `customer`         |                          |
| GET    | `/portal/businesses`                                   | portal+linked      | `customer`         |                          |
| GET    | `/portal/businesses/:id`                               | portal+linked      | `customer`         |                          |
| POST   | `/portal/businesses`                                   | portal+linked      | `customer`         |                          |
| PATCH  | `/portal/businesses/:id`                               | portal+linked      | `customer`         |                          |
| DELETE | `/portal/businesses/:id`                               | portal+linked      | `customer`         |                          |

---

## 28. location.ts (mounted at `/location`)

| Method | Path (mounted)        | Current middleware     | Proposed role gate  | Notes                |
| ------ | --------------------- | ---------------------- | ------------------- | -------------------- |
| POST   | `/location/randomize` | `requireExecutorToken` | `executor-or-owner` | Device-agent helper. |

---

# Summary

## A. Endpoint count per proposed gate

| Gate                | Count   |
| ------------------- | ------- |
| `public`            | 6       |
| `viewer`            | 47      |
| `editor`            | 22      |
| `admin`             | 27      |
| `owner`             | 11      |
| `executor-or-owner` | 19      |
| `api-token`         | 1       |
| `onboarding`        | 1       |
| `free-trial`        | 2       |
| `customer`          | 46      |
| **TOTAL**           | **182** |

(Counts include the portal block and treat `executor-or-owner` as a single bucket even when the current code uses `requireExecutorToken` — the proposal upgrades runner-only writes to also accept owner UI calls, consistent with the existing `requireExecutorOrOwner` pattern.)

## B. NO-AUTH endpoints that SHOULD have auth (security gap callout)

These return 200 to any anonymous caller today; **all need at minimum `viewer`** (most need more):

1. `POST /healthz/seed-admin` — **CRITICAL.** Anonymous caller can reset the production `admin@signalaeo.com` password to the known `Admin123!`. Either delete or gate `admin` + env flag.
2. `GET /proxies` — leaks proxy credentials (plaintext `password` column) to anyone who reaches the server. Should be `admin`-only at minimum, or strip the password field for non-admins.
3. `POST /audit-logs/sync` — mass-insert into `audit_logs` from `ranking_reports`. Should be `admin`.
4. `DELETE /audit-logs/:id` — destructive, anonymous today.
5. `PATCH /sessions/:id/screenshot` — anonymous write.
6. `PATCH /sessions/:id/followup` — anonymous write.
7. `DELETE /sessions/:id` — destructive, anonymous.
8. `DELETE /keyword-variants/:id` — destructive, anonymous.
9. `POST /llm/variants/:keywordId/regenerate` — anonymous LLM call (cost).
10. `DELETE /llm/variants/by-id/:id` — destructive, anonymous.
11. `POST /keywords/:id/generate-replacement` — anonymous LLM call (cost).
12. `POST /keywords/:id/variants/generate` — anonymous LLM call (cost).
13. `POST /keywords/rotate-winners` — anonymous rotation control.
14. `POST /rankings/send-report` — **anonymous caller can send arbitrary emails through SendGrid as us.** High severity.
15. `POST /rankings/email-ai-suggest` — anonymous LLM call (cost) + exfiltrates summary data.
16. `GET /rankings/email-recipients/:clientId` — anonymous PII read (client emails).
17. `GET /rankings/email-preview` — anonymous HTML preview with client data.
18. `GET /rankings/email-templates` — anonymous client-scoped data.
19. `GET /rankings/email-sends` — anonymous send-history read.
20. `PATCH /metrics/performance/:key` — anonymous config write.
21. `PATCH /farm-metrics/:key` — anonymous config write.
22. `POST /clients` / `PATCH /clients/:id` / `DELETE /clients/:id` / `POST /clients/:id/restore` — anonymous client CRUD.
23. `POST /businesses` / `PATCH /businesses/:id` / `DELETE /businesses/:id` — anonymous business CRUD.
24. `POST /clients/:clientId/aeo-plans` / `PATCH …/:planId` / `DELETE …/:planId` — anonymous campaign CRUD.
25. `POST /keywords` / `PATCH /keywords/:id` / `DELETE /keywords/:id` / `POST /keywords/:id/archive` — anonymous keyword CRUD.
26. `POST /keywords/:id/links` / `PATCH …/:linkId` / `DELETE …/:linkId` — anonymous backlink CRUD.
27. `POST /devices` / `PATCH /devices/:id` — anonymous device fleet CRUD.
28. `POST /proxies` / `PATCH /proxies/:id` / `DELETE /proxies/:id` — anonymous proxy credential CRUD.
29. `POST /packages` / `DELETE /packages/:id` — anonymous catalogue CRUD.
30. `POST /tasks` / `PATCH /tasks/:id` / `DELETE /tasks/:id` / `POST …/subtasks` / `PATCH …/:subtaskId` — anonymous task CRUD.

**Net:** essentially every admin-panel write endpoint outside `/sessions` (executor-gated) and `/portal/*` (session-gated) is unauthenticated server-side. The admin panel works only because the FE is the only client and is itself behind login. Any direct caller bypasses entirely.

## C. Ambiguous cases (need human decision)

1. **`PATCH /clients/:id`** — mixes notes/status (editor-level) with `businessName`/`plan` rename (admin-level). Recommend splitting; if not, gate to admin.
2. **`PATCH /clients/:clientId/aeo-plans/:planId`** — same split concern. `planType` change vs. sample-question edits.
3. **`POST /llm/aeo-reporter/stream`** — currently `requireSession`. Per memory & spec, AEO Reporter is owner-only — should be `requireOwner`. Confirm.
4. **`DELETE /tasks/:id`** — editor or admin? Operational kanban suggests editor.
5. **`PATCH /devices/:id`** — editor (status flips) or admin (identifier)?
6. **`GET /proxies`** — `viewer` of metadata only, or `admin`-only because of plaintext passwords? Recommend stripping `password`/`username` for non-admins and allowing `viewer` to read remainder.
7. **`POST /audit-logs/sync`** — admin or owner? It's a backfill operation; admin seems right but it touches a lot of rows.
8. **`POST /ranking-reports/dedupe`** — currently `requireExecutorToken`. It's a one-time cleanup script; admin or owner more appropriate (not a runner action).
9. **`DELETE /ranking-reports/:id`** — currently `requireExecutorToken`. Destructive; should be admin (runner shouldn't delete).
10. **`POST /proofs/backfill`** — should `admin` also be allowed, or stay token-gated to keep CRM the only caller?
11. **`POST /rankings/send-report`** — admin or editor? Account managers send these, so editor makes sense, but it's a non-revocable side effect (real emails go out).
12. **Duplicate routes for variants:** `/keywords/:id/variants*` (in keywords.ts) and `/keywords/:keywordId/variants*` (in keyword-variants.ts) and `/llm/variants/*` (in llm.ts) — three roughly-overlapping APIs. Recommend deprecating the keyword-variants.ts legacy paths (variants overview is already only in llm.ts).
13. **`POST /healthz/seed-admin`** — delete entirely in prod, or env-flag + admin gate?
14. **All `executor-or-owner` `PATCH /ranking-reports/:id`** — most patches today come from runners but the field `screenshotUrl`/`mapsUrl` is also editable from the FE during reviews. Confirm editor should be allowed too.
15. **`POST /sessions/import`** — currently `requireSession` (any logged-in user). Spec says admin. Confirm.
