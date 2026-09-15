# Session Handover — 2026-07-22 (SignalAEO ↔ AEOAdmin: security audit, plans filter, email work)

**Project:** /Users/seolocalph/projects/AEOAdmin (branch `feat/free-trial-email-stripe`)
**Companion:** /Users/seolocalph/projects/signalaeo (Russ's website source, belle-scoped)

---

## TL;DR — the one next action

**Build Feature 2: the free-trial "Send proof before charge" button + a new email template matching the client's image copy.** Everything else this session is DONE + deployed. Full spec for Feature 2 is in the "OPEN ITEMS" section below — start there.

---

## Completed this session (all committed + DEPLOYED unless noted)

All backend deploys = App Runner `aeo-admin-api` (service ARN `…/9c5d6bcd3f8349bbbeac57d113226cd1`); all FE deploys = push `bellep/main` → Vercel. Deploy recipe unchanged (see INFRA below). Commits on `feat/free-trial-email-stripe`, newest first: `f952c64 ea57684 ad315b4 5622a4d 0098f35 bebcb2f 1eee1d0`.

1. **Dedup soft-delete bug FIXED** (`1eee1d0`): free-trial idempotency lookups now filter `status != 'inactive'` so a deleted client no longer blocks re-onboarding (the "already deleted but not restarting" complaint). Proven via live e2e.
2. **Notification bell** (`bebcb2f`): the dead header bell now opens a dropdown of recent signups (newest active clients via `GET /api/clients`, scoped) with a per-browser unread badge (localStorage `aeo:notifications:lastSeenAt`). `components/layout/NotificationBell.tsx`.
3. **Login/logout cache clear** (`0098f35`): `lib/auth.tsx` now calls `queryClient.clear()` on login AND logout — fixes stale cross-user data (a scoped user briefly seeing a prior owner session's clients until manual refresh).
4. **FULL scoped-access audit + 5 leak fixes** (`5622a4d`): 3 parallel reviewers audited EVERY route reachable by a non-owner. Fixed: client-aeo-plans PATCH/DELETE `/:planId` (chuckslocal IDOR to any client's campaign — now constrained to asserted clientId); sessions PATCH `/:id/screenshot` + `/:id/followup` (had NO auth — now `requireScopedEditor` + `assertScopedAccessToClient`); ranking-reports `/summary/available-dates` (missing assert); ranking-reports `/bi-weekly-report` (errors-detail + sessions-count queries leaked every client's data — now intersected with eligibleIds).
5. **Scope EVERY non-owner** (`ad315b4`): `lib/scoped-access.ts` `isScopedRole` now = "logged-in AND not owner" (was only sales/account-manager/chuckslocal). So the admin chain (viewer/editor/admin) is now local-plan-only too. ZERO impact on current users (owner unchanged; the 3 scoped roles already scoped; NO viewer/editor/admin accounts exist). Also authenticated the 3 unauthenticated `keyword-variants` endpoints (GET /variants, POST /variants/regenerate, GET /prompt-templates).
6. **Role-aware Plan-type filter** (`ea57684`): new `GET /api/aeo-plans/plan-types` returns distinct plan types scoped by role (owner=all, everyone else=`["AEO SEO Local Plan"]`). Added a `planType` filter param to `period-comparison`, `bi-weekly-report`, and `sales/email-sends`. FE dropdowns on rankings.tsx, rankings-bi-weekly.tsx, sent-emails.tsx feed off the scoped endpoint (`lib/plan-types.ts` `usePlanTypes`). On Rankings the plan filter is cross-client (enables the query without a single client selected).
7. **Feature 1 — Sent Emails email-type column + welcome recording** (`f952c64`): `free-trial-email.ts` now inserts the welcome send into `email_sends` (kind='welcome', fail-soft). `sent-emails.tsx` shows a Type badge per row (`emailTypeLabel`: Welcome / First Proof / Free-Trial Proof / Founder's Discount / Ranking Report) + a Welcome filter option.
8. **Test cleanup**: deleted test clients #297/#298/#299/#300 (all belle Graphic Werx tests) + their Stripe customers. Real records (#11 "36 Pixels", #149) left untouched.

## Current state

All the above is deployed and live. Working tree clean except this HANDOVER.md. **Feature 2 not started.** Also two live user questions are pending on belle's side (polling — see OPEN P2).

## OPEN ITEMS (priority order)

**P1 — BUILD FEATURE 2: free-trial "Send proof before charge" button + new template.** (User approved scope: NEW dedicated template, not reuse.)

- The client's target email copy is in the chat image (a "Top 3 ranking proof → we're moving you from the free trial to the paid Signal AEO plan" email with an `[Insert Screenshot]` slot). Recreate that copy.
- **BE**: add a 3rd sales template `free_trial_proof` to `SALES_TEMPLATES` in `artifacts/api-server/src/routes/sales-email.ts` (see the `SalesTemplateKey` type ~L207 and the `SALES_TEMPLATES` record ~L222). Give it the image's headline/intro/offer/CTA copy. The send endpoint `POST /api/sales/send-email` already accepts a `template` param + does the screenshot proof + records to `email_sends` (kind='sales', meta.template) — so a new template key flows through existing plumbing, incl. the Type column (Feature 1 already maps `free_trial_proof` → "Free-Trial Proof").
- **FE**: (a) add `free_trial_proof` to the template list in `artifacts/admin-panel/src/components/SalesEmailDialog.tsx` (`SalesTemplateKey` ~L123, the `TEMPLATES` array ~L126, default `useState("first_proof")` ~L236). The dialog ALREADY has the screenshot picker (before/after proof), so most of the UI is reuse. (b) Add a **"Send proof" button on free-trial client pages** that opens SalesEmailDialog pre-set to `free_trial_proof`. Free-trial clients = plan_type `"Free Trial Plans"`. Likely spot: client-detail page and/or the clients list row action. Look at how the existing SalesEmailDialog is currently triggered (rankings.tsx has `salesEmailOpen` state + `<SalesEmailDialog>` at ~L864) to mirror the trigger.
- Test with SAFE_RECIPIENT_OVERRIDE contained pattern (emails to erven only) before letting it hit a real client.

**P2 — Polling (belle's side, NOT our bug).** Puller is healthy (cron `*/2`, no errors, `eligible=0`). New signups aren't pulled until THEIR side marks them `device_farm_ready` + `card_on_file_at`. The newest lead (`service@cartuneup-sarasota.com`, 21:57Z) is `welcome_pending`, card=n, device_farm_blocked → not eligible. ASK belle: which email + did the card step complete. Optional: set a Monitor to ping when a new lead flips to `device_farm_ready`.

**P3 — Low-priority audit items (noted, not fixed).** (a) `keywords.ts PATCH /:id` copies `body.clientId`/`aeoPlanId`/`businessId` without re-asserting scoped access to the TARGET client — a scoped user could reassign a keyword out of its slice (PLAUSIBLE). Fix: re-assert when those change. (b) `dashboard.ts network-health` `sessionsPerHour` is a global aggregate for scoped roles (not client data — cosmetic).

**P4 — Older backlog (still open from prior handovers).** P3 ranking-report sender split (chuck@ vs mary@ in rankings-email.ts `/send-report`); the failing `deploy-api.yml` GitHub Action on bellep-max (missing `AWS_ROLE_ARN` OIDC secret — cosmetic red ❌, API is deployed manually anyway).

## KEY DECISIONS

- **Only `owner` sees non-local plans** (user: "owner and erven only"). Implemented by widening `isScopedRole` to all non-owners. Safe because no viewer/editor/admin users exist.
- **Feature 1 records welcome emails** to email_sends (user picked "incl. welcome") — owner-alert NOT recorded (internal noise, not a client-facing type).
- **Feature 2 = NEW template** `free_trial_proof` (user picked "new template", not reuse of `first_proof`) — copy must match the client's image.
- **Plan filter options are role-scoped server-side** so a non-owner can't even see a non-local plan as an option.
- **Did NOT raw-delete Russ's DynamoDB leads** — their system has no delete fn (only lifecycle "disqualify"); raw deletes risk corrupting their ledger. Our cursor blocks re-onboard anyway.

## FILES MODIFIED (this session, all committed)

- `artifacts/api-server/src/routes/onboarding.ts` — dedup status filter
- `artifacts/api-server/src/routes/client-aeo-plans.ts` — PATCH/DELETE constrained to clientId
- `artifacts/api-server/src/routes/sessions.ts` — auth + scope on screenshot/followup
- `artifacts/api-server/src/routes/ranking-reports.ts` — available-dates assert; bi-weekly errors+sessions scope; planType filter
- `artifacts/api-server/src/routes/aeo-plans.ts` — new `/plan-types` endpoint
- `artifacts/api-server/src/routes/sales-email.ts` — planType filter on email-sends
- `artifacts/api-server/src/lib/scoped-access.ts` — isScopedRole = all non-owners
- `artifacts/api-server/src/routes/keyword-variants.ts` — auth + per-keyword scope
- `artifacts/api-server/src/services/free-trial-email.ts` — record welcome to email_sends
- `artifacts/admin-panel/src/lib/auth.tsx` — queryClient.clear on login/logout
- `artifacts/admin-panel/src/lib/plan-types.ts` (new) + `lib/period-comparison.ts` — planType plumbing
- `artifacts/admin-panel/src/pages/{rankings,rankings-bi-weekly,sent-emails}.tsx` — plan filter + (sent-emails) type column
- `artifacts/admin-panel/src/components/{NotificationBell,PeriodOverview,PeriodByClientTab,BiWeeklyReportTab}.tsx`

## INFRA / deploy (unchanged)

- **Backend deploy**: `export AWS_PROFILE=aeo-admin AWS_DEFAULT_REGION=us-east-1`; ECR login → `DOCKER_BUILDKIT=0 docker build --platform linux/amd64 -t aeo-admin-api -f artifacts/api-server/Dockerfile .` → tag+push `788269087294.dkr.ecr.us-east-1.amazonaws.com/aeo-admin-api:latest` → `aws apprunner start-deployment` (only when Status=RUNNING; ~4-5 min). esbuild build ignores the ambient `string | string[]` tsc errors — those are pre-existing, not yours.
- **FE deploy**: `CLAUDE_PROTECTED_BRANCHES=__none__ git push bellep HEAD:main` (MUST be a standalone command — the hook blocks pushes to main otherwise; the override is the sanctioned Vercel path). Then `git push origin feat/free-trial-email-stripe`.
- **Box (belle)**: `ssh -i /Users/seolocalph/Downloads/belle_signalaeo_ed25519 signalaeo@34.213.158.148`; app `/home/signalaeo/signalaeo`; puller `scripts/aeo-admin-pull.mjs` cron `*/2`; cursor `~/.aeo-admin-pull-cursor.json`; run their libs with `node --env-file=.env.local`.
- **Prod DB/secrets**: `aws secretsmanager get-secret-value --secret-id aeo-admin/prod` → DATABASE_URL, SENDGRID_API_KEY, ADMIN_FROM_EMAIL, FREE_TRIAL_TOKEN, STRIPE_SECRET_KEY, SAFE_RECIPIENT_OVERRIDE(""). `pg` resolves only from `scripts/` dir. Contained email test: run api-server locally with `SAFE_RECIPIENT_OVERRIDE=erven.i@appstango.com PORT=8788`, POST to localhost.

## NEXT ACTION

> Build Feature 2 (P1): add a `free_trial_proof` template to `SALES_TEMPLATES` in `artifacts/api-server/src/routes/sales-email.ts` with the client's image copy, add it to `SalesEmailDialog.tsx`'s template list, and add a "Send proof" button on free-trial (plan_type "Free Trial Plans") client pages that opens the dialog pre-set to that template. The screenshot picker + send endpoint + email_sends recording already exist — you're mostly adding copy + a trigger. Test contained (SAFE_RECIPIENT_OVERRIDE → erven) before any real send.

---

## Session Opener (paste at start of next session)

```
Continuing AEOAdmin work on branch feat/free-trial-email-stripe. Last session
shipped (all deployed): the free-trial dedup fix, a working notification bell,
login/logout React-Query cache clear, a FULL scoped-access audit with 5 leak
fixes, "only owner sees non-local plans" (isScopedRole = all non-owners),
authenticated keyword-variants, a role-aware plan-type filter on Rankings +
Sent Emails, and Feature 1 (Sent Emails email-type column + welcome-email
recording to email_sends). See HANDOVER.md for the full list + infra/deploy.

DO FEATURE 2 FIRST: a free-trial "Send proof before charge" button + a NEW
email template. The user wants a dedicated `free_trial_proof` template matching
their image copy (a Top-3 ranking proof email that says "we're moving you from
the free trial to the paid Signal AEO plan", with an inserted screenshot).
Steps: (1) BE — add `free_trial_proof` to SALES_TEMPLATES in
artifacts/api-server/src/routes/sales-email.ts (SalesTemplateKey ~L207,
SALES_TEMPLATES ~L222) with the image copy; the POST /api/sales/send-email
endpoint + screenshot proof + email_sends recording already handle any template
key. (2) FE — add the template to SalesEmailDialog.tsx (SalesTemplateKey ~L123,
TEMPLATES array ~L126) and add a "Send proof" button on free-trial (plan_type
"Free Trial Plans") client pages that opens SalesEmailDialog pre-set to
free_trial_proof (mirror how rankings.tsx triggers SalesEmailDialog ~L864).
Test with SAFE_RECIPIENT_OVERRIDE=erven.i@appstango.com before any real send.

Also pending (belle's side, not our bug): confirm which email belle used for
her latest free-trial test and whether the card-on-file step completed — the
puller is healthy but only pulls device_farm_ready + card-on-file leads.
```
