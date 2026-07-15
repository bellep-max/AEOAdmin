# Email Status Tracking — Sent Emails page

Add post-send lifecycle status (Delivered / Opened / Clicked / Bounced / Failed) to
the Sent Emails page, sourced from **GHL** (primary send path) and **SendGrid**
(fallback path) event webhooks.

## Current state (baseline)

`email_sends` records a one-time send outcome only, set in `routes/sales-email.ts`
`POST /send-email`:

- `status` — `'sent'` | `'failed'` (send-time only)
- `deliveredVia` — `'ghl'` | `'sendgrid'` (stored in `meta`, not a column)
- `sendgridMessageId` — SendGrid `x-message-id` header (**captured** in a column)
- GHL `messageId` — returned by `ghlSendEmail`, currently stored only in `meta.messageId`
- `ghlStatus` — `'sent_via_ghl'` | `'no_contact'` | `'ghl_send_failed: …'` | …

No webhook endpoint exists; nothing updates a row after send.

Sent Emails page endpoints: `GET /api/sales/email-sends`, `GET /api/sales/email-sends/:id`
(both `requireSalesEmail`).

## Goal

A **Status** column on the Sent Emails page showing the furthest-reached lifecycle
state, backed by a full per-message event timeline, updated in near-real-time by
provider webhooks. Normalize GHL + SendGrid vocabularies into one ladder.

### Normalized status ladder

Positive (monotonic, higher wins):
`sent(0) → delivered(1) → opened(2) → clicked(3)`

Terminal-negative (override positive, never regress out of these):
`bounced`, `dropped`, `spam` (spamreport/complaint), `unsubscribed`, `failed`

`latest_status` rule: negative-terminal always wins once seen; otherwise the
highest positive rank seen. Opens/clicks may repeat — keep every event, bump
counters, but `latest_status` only advances.

> Caveat baked into the design: **open tracking is unreliable** (Apple Mail Privacy
> Protection pre-fetches pixels → false/inflated opens). Treat **click** as the
> trustworthy engagement signal; label opens as "opened (may be automated)".

## Data model

### New table `email_events`

| column            | type                                            | notes                                                                                |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| id                | serial pk                                       |                                                                                      |
| email_send_id     | integer FK → email_sends.id (on delete cascade) | nullable if unmatched                                                                |
| provider          | text                                            | `'ghl'` \| `'sendgrid'`                                                              |
| event             | text                                            | normalized: processed/delivered/open/click/bounce/dropped/spam/unsub/deferred/failed |
| raw_event         | text                                            | provider's raw event name                                                            |
| provider_event_id | text                                            | dedup key (SendGrid `sg_event_id`; GHL event id) — UNIQUE with provider              |
| occurred_at       | timestamp                                       | provider event timestamp (ISO-Z string, per pg-node rule)                            |
| payload           | jsonb                                           | full raw event for audit                                                             |
| created_at        | timestamp default now                           |                                                                                      |

Unique index `(provider, provider_event_id)` for idempotent webhook replays.

### `email_sends` additions (additive `ALTER TABLE ADD COLUMN IF NOT EXISTS`)

- `delivered_via` text — promote from `meta` to a real column (backfill from meta).
- `ghl_message_id` text — so GHL webhook events can be correlated (going forward).
- `latest_status` text — denormalized furthest-reached state for fast list rendering.
- `latest_event_at` timestamp — for sorting / "last activity".
- `opened_count` integer default 0, `clicked_count` integer default 0.

Apply via `pnpm --filter @workspace/db push` (additive only — never let push drop
`user_sessions`; if it wants to, use raw `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).

## Correlation keys

- **SendGrid**: webhook event `sg_message_id` has form `<x-message-id>.<recv>.<suffix>`.
  Match by `sg_message_id split('.')[0] === email_sends.sendgrid_message_id`.
- **GHL**: match webhook `messageId` → `email_sends.ghl_message_id`; fall back to
  `(contactId + most-recent sales send)` when a message id isn't echoed.

## Endpoints

### `POST /api/webhooks/sendgrid`

- Public route, **verify SendGrid Signed Event Webhook** (Ed25519: headers
  `X-Twilio-Email-Event-Webhook-Signature` + `-Timestamp`, public key from
  `SENDGRID_WEBHOOK_PUBLIC_KEY` in `aeo-admin/prod`). Reject on bad signature.
- Body is an array of events. For each: normalize, dedup on `sg_event_id`, insert
  `email_events`, recompute `latest_status` on the matched send.
- Always return 200 quickly (SendGrid retries on non-2xx); do work best-effort.

### `POST /api/webhooks/ghl`

- Public route, verify via GHL signature/shared secret (`GHL_WEBHOOK_SECRET`).
- Handle LC Email events (delivered/opened/clicked/bounced/complaint/unsub).
- Normalize, dedup, insert, recompute `latest_status`.

Both mounted **before** auth middleware; token/secret-gated, not session-gated.

### Recompute helper

`services/email-status.ts`: `recomputeLatestStatus(emailSendId)` — reads events,
applies the ladder + negative-terminal override, writes `latest_status`,
`latest_event_at`, `opened_count`, `clicked_count`.

## Send-flow change

In `POST /send-email` insert: also persist `delivered_via` and `ghl_message_id`
(from `r.messageId` when `deliveredVia==='ghl'`) as columns, and set
`latest_status='sent'`. Keeps new sends correlatable.

## Frontend

- `GET /email-sends` returns `latestStatus`, `latestEventAt`, `openedCount`,
  `clickedCount`.
- Sent Emails list: **Status badge** column — Sent (grey) → Delivered (blue) →
  Opened (amber, "may be automated") → Clicked (green); Bounced/Spam/Failed (red).
  Sort/filter by status.
- Detail page: **event timeline** (chronological `email_events`) under the replayed HTML.

## Provider config (manual, documented — not code)

- SendGrid: Settings → Mail Settings → **Event Webhook** → post URL
  `https://<api>/api/webhooks/sendgrid`, enable delivered/open/click/bounce/dropped/
  spamreport/unsubscribe, enable **Signed Event Webhook**, copy public key to secret.
- GHL: subscribe LC Email events to `https://<api>/api/webhooks/ghl` (workflow/app
  webhook), store shared secret.

## Phases (loop executes these in order; verify before advancing)

1. **Schema** — `email_events` table + `email_sends` columns in `lib/db/src/schema/`;
   `pnpm exec tsc -b lib/db` then push. Backfill `delivered_via` from `meta`.
2. **Normalizer** — `services/email-status.ts`: event maps + `recomputeLatestStatus`.
   Unit tests for the ladder (delivered→open→click, bounce override, dedup).
3. **SendGrid webhook** — endpoint + Ed25519 verify + event ingest. Test with a
   signed sample payload.
4. **GHL webhook** — endpoint + secret verify + event ingest. Test with a sample.
5. **Send-flow + GET** — persist new columns on send; extend `GET /email-sends`.
6. **Frontend** — Status badge column + detail timeline; regenerate api-client if
   the OpenAPI spec changes (orval — don't hand-edit generated files).
7. **Docs + deploy** — provider-config runbook; typecheck + build; backend Docker →
   ECR → App Runner (manual, `DOCKER_BUILDKIT=0`, linux/amd64); FE auto-deploys on
   push to `main`. Enable webhooks in dashboards; smoke-test one real send end-to-end.

## Definition of done

- A real sales send progresses Sent → Delivered → Opened/Clicked on the page as GHL
  fires events; a bounced address shows Bounced.
- Webhook replays are idempotent (unique `(provider, provider_event_id)`).
- `pnpm typecheck` + `pnpm build` clean; both webhooks signature-verified.
