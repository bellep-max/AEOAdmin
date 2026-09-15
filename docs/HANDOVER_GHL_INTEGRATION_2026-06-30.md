# Handover — GHL (GoHighLevel) Integration & the AEO Email-Workflow Test

**Date:** 2026-06-30
**Author:** prior session (erven)
**For:** whoever runs the _AEO Email Workflow_ test in GHL next session
**Repo:** AEOAdmin (backend `artifacts/api-server`), now mirrored to
`DeviceFarm1/aeo-admin` (branch `migrate/bellep-main-2026-06-30`).

---

## 0. TL;DR — what this is

We built the backend that **feeds AI-ranking before/after screenshots into
GoHighLevel contacts**. The test doc you were handed
(`AEO-Workflow-Test-Instructions.md`) tests the _GHL email side_ — but that test
**only works if the contact's custom fields are already populated** with
`keyword_1`, `keyword_1_before_url`, `keyword_1_after_url`, etc.

**Those fields are populated by OUR endpoint: `POST /api/sales/ghl/sync`.**

So the whole thing has two halves:

| Half                               | Who owns it          | What it does                                                                                                                                      |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Our API** (this repo)         | us                   | Resolves a client by email → finds their best validated keyword per AI platform → writes the screenshot URLs into the GHL contact's custom fields |
| **B. GHL workflow** (the test doc) | Chuck/Anna in GHL UI | On a tag trigger, sends an email that renders those before/after image URLs                                                                       |

If a test contact's screenshot fields are blank, you don't pick a different
contact (as the test doc says) — you can **fire our sync to populate them**
(Section 4 below).

---

## 1. Environment / secrets (all live in `aeo-admin/prod` Secrets Manager)

The API server reads these from env (injected on App Runner from the
`aeo-admin/prod` secret). To call/test from a terminal you need the same values.

| Env var                 | Purpose                                                     | Notes                                                                   |
| ----------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GHL_PIT_TOKEN`         | Private Integration Token — auth to GHL's LeadConnector API | Bearer token for `services.leadconnectorhq.com`                         |
| `GHL_LOCATION_ID`       | `uXRl9WpDjS7LFjeYfQqD`                                      | The GHL location/sub-account                                            |
| `READ_API_TOKEN`        | Gates all `/api/sales/*` endpoints                          | Same token the sales team uses                                          |
| `SALES_PUBLIC_BASE`     | `https://jjm59vpn3y.us-east-1.awsapprunner.com`             | Base used to build the permanent screenshot image URLs written into GHL |
| `AWS_REGION` / S3 creds | `aeo-rank-screenshots` bucket access                  | Screenshots are validated via `HeadObject` before a slot is written     |

Pull the secret values (read-only) with:

```bash
AWS_PROFILE=aeo-admin aws secretsmanager get-secret-value \
  --secret-id aeo-admin/prod --region us-east-1 \
  --query SecretString --output text | python3 -m json.tool
```

> ⚠️ Never paste these tokens into chat, email, or anywhere a customer can see.
> If leaked, rotate in Secrets Manager + App Runner.

---

## 2. What we built — the three endpoints

All in `artifacts/api-server/src/routes/sales.ts`. All gated by
`requireApiToken` (admin session **or** `Authorization: Bearer <READ_API_TOKEN>`
/ `X-API-Key` / `?token=` for the `<img>` endpoint).

### `GET /api/sales/improvement?email=<email>`

JSON: matched business + every tracked keyword, each with first→current
(best) rank per platform. Sorted strongest-improvement-first. Optional
`&platform=chatgpt|gemini|perplexity`, `&keyword=<loose match>`, `&business=`.
Only screenshots with a legible rank label (`screenshot_rank_visible != false`)
are surfaced.

### `GET /api/sales/screenshot?email=<email>&which=current|first[&platform=…]`

Streams one image. Permanent, embeddable link (safe in saved GHL templates).
`which=current` = best rank reached; `which=first` = earliest check (the
"before"). Auth via header **or** `?token=` (so `<img src>` works in email).

### `POST /api/sales/ghl/sync` ← **the important one for the test**

Body (or query): `{ email, contactId }`. Resolves the client by email, finds
the **strongest VALIDATED improvement per platform**, and writes that into the
contact's "AEO Screenshots" custom fields in GHL.

- Slot 1 = **ChatGPT**, Slot 2 = **Gemini**, Slot 3 = **Perplexity**.
- Each slot gets: `keyword` (text, e.g. `"lip filler near me (ChatGPT)"`),
  `before_url` (= `/api/sales/screenshot?...&which=first`),
  `after_url` (= `...&which=current`).
- **Validation is strict:** a slot is only written if `bestImp > 0` AND **both**
  the first and current S3 objects exist (`HeadObject`). Otherwise that
  platform's slot is **cleared** — so stale/inaccurate screenshots get removed,
  never left dangling.
- Slots 4 & 5 are **always cleared**.
- Returns `{ ok, contactId, email, written: [...], clearedPlatforms }`.

The GHL custom-field IDs are hard-coded in `GHL_SLOTS` /
`GHL_CLEAR_FIELDS` (location `uXRl9WpDjS7LFjeYfQqD`). Field API-key names on the
GHL side are `keyword_1 / keyword_1_before_url / keyword_1_after_url` … through
`keyword_3` (same pattern), exactly the names the test doc checks.

> Design intent: the sync is meant to be triggered by a **GHL Workflow → Custom
> Webhook** step that POSTs the contact's `email` + `contactId`. It can also be
> fired manually from a terminal (below).

---

## 3. Current state (as of 2026-06-30)

- All three endpoints are **deployed and live** on App Runner.
- ~**103 GHL contacts** were synced in the prior session (rank/summary guards
  applied — a top-3 headline never sits next to negative screenshot text via the
  `positiveTop3` guard).
- Screenshots backfilled to S3 (`aeo-rank-screenshots`); the stale re-rank
  import (2,049 ranking_reports + ~1,419 screenshots) is done.
- The GHL **Workflow itself (the email send)** is built/owned on the GHL side by
  Chuck/Anna — that's the half the test doc exercises.

---

## 4. How to run the test **from a terminal** (the part you asked for)

The test doc (`AEO-Workflow-Test-Instructions.md`) is written for the GHL UI.
Here's the terminal-equivalent so you can prep a contact and verify our side
before touching the GHL workflow.

### 4a. Confirm a contact's screenshot fields ARE populated (our data)

Pick the contact's email and hit `/improvement` — if you get keywords back with
`first`/`current` per platform, our data is good:

```bash
BASE=https://jjm59vpn3y.us-east-1.awsapprunner.com
TOKEN=<READ_API_TOKEN>      # from aeo-admin/prod

curl -s "$BASE/api/sales/improvement?email=test@example.com" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

`"found": false` → see the troubleshooting table in
`docs/SALES_GHL_INTEGRATION.md` (no matching client / no tracked keywords / no
improvement yet).

### 4b. Populate (or refresh) a contact's GHL custom fields

You need the GHL `contactId` (from the GHL contact URL, or look it up via the
GHL API by email). Then:

```bash
curl -s -X POST "$BASE/api/sales/ghl/sync" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","contactId":"<GHL_CONTACT_ID>"}' \
  | python3 -m json.tool
```

Expected: `{ "ok": true, "written": ["chatgpt: \"…\" #33→#4", …],
"clearedPlatforms": N }`. After this, the contact's `keyword_1*` fields are set
and the GHL email test will render real before/after images.

> Look up a GHL contactId by email (uses `GHL_PIT_TOKEN`):
>
> ```bash
> curl -s "https://services.leadconnectorhq.com/contacts/?locationId=uXRl9WpDjS7LFjeYfQqD&query=test@example.com" \
>   -H "Authorization: Bearer $GHL_PIT_TOKEN" -H "Version: 2021-07-28" \
>   | python3 -m json.tool
> ```

### 4c. Eyeball the actual image our URL serves

```bash
curl -s "$BASE/api/sales/screenshot?email=test@example.com&which=current&token=$TOKEN" \
  -o /tmp/after.png && open /tmp/after.png
curl -s "$BASE/api/sales/screenshot?email=test@example.com&which=first&token=$TOKEN" \
  -o /tmp/before.png && open /tmp/before.png
```

If these render, the `<img src>` in the GHL email will too (Gmail's first-open
image blocking aside — see test doc "If Images Don't Load → Check 1").

### 4d. Then run the GHL UI test (test doc Steps 2–5)

Once fields are populated: swap the contact email to your own → add tag
`aeo-screenshot-test` → check inbox → run the 7-point checklist → restore the
contact (remove tag, restore email). Report results to Chuck.

---

## 5. Gotchas / things that bit us

- **Direct DB from a laptop to RDS times out intermittently.** Don't script
  against the DB directly for this — go through the API
  (`scripts/_import-stale-via-api.mjs` pattern). The sync endpoint reads the DB
  server-side, so a terminal `curl` to the API is the reliable path.
- **A slot is cleared, not skipped, when invalid.** If a test contact suddenly
  shows blank Gemini/Perplexity after a sync, that's _correct_ — it means that
  platform had no validated before+after (no positive improvement, or the S3
  object is missing). Check `/improvement` for that platform.
- **`positiveTop3` guard:** for a top-3 current rank we suppress anything whose
  summary text reads negative, so the email headline and screenshot never
  contradict. Expect some keywords to be intentionally withheld.
- **Field IDs are location-specific.** `GHL_SLOTS` IDs only valid for location
  `uXRl9WpDjS7LFjeYfQqD`. A different GHL sub-account = different IDs = code edit.
- **Screenshot links are permanent** (no expiry) — safe in saved templates;
  they re-resolve "best current" each render.

---

## 6. File map

| Path                                                | What                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `artifacts/api-server/src/routes/sales.ts`          | all 3 endpoints + GHL field mapping + S3 validation                                |
| `artifacts/api-server/src/middlewares/api-token.ts` | `requireApiToken` (session OR Bearer/X-API-Key/?token=)                            |
| `docs/SALES_GHL_INTEGRATION.md`                     | plain-English guide for the sales team (screenshot-in-email + improvement webhook) |
| `docs/SALES_GHL_SCREENSHOTS_FOR_CHUCK.md`           | screenshot-handoff notes for Chuck                                                 |
| `scripts/_match-sales-csv*.mjs`                     | CSV → client matching helpers used during the bulk sync                            |
| `~/.claude/.../memory/reference_sales_endpoint.md`  | memory note: endpoint shape + deploy date                                          |

---

## 7. The test doc itself (verbatim reference)

The handed-over instructions live at
`~/Downloads/AEO-Workflow-Test-Instructions.md`. Key facts from it:

- **GHL Location ID:** `uXRl9WpDjS7LFjeYfQqD`
- **S3 bucket:** `aeo-rank-screenshots`
- **Fields to verify populated:** `keyword_1`, `keyword_1_before_url`,
  `keyword_1_after_url` (+ `keyword_2*`, `keyword_3*`)
- **Trigger tag:** `aeo-screenshot-test`
- **7-point pass/fail checklist** must fully pass before activating the live
  6-email nurture sequence on real contacts.
- Related GHL-side build docs (owned by Anna/Chuck, not in this repo):
  `GHL-AI-Search-Email-Sequence.md`, `Zapier-Calendly-GHL-Setup.md`.
