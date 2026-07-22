# Lead PULL model

Fetches eligible leads from belle's side and onboards them on ours — **zero
changes to the website / Lightsail box**. Each eligible lead is POSTed to
`/api/onboarding/free-trial`, which creates the client, keywords, variants, and
sends the welcome + owner-alert emails. Idempotent by email (server-side) and by
a local cursor file, so it is safe to re-run or schedule.

## Files

- `core.ts` — pure logic: eligibility gate, lead→payload transform, orchestrator.
  No I/O; every side effect is injected. Fully unit-tested.
- `core.test.ts` — `node scripts/lead-pull/core.test.ts` (20 tests, no deps).
- `run.ts` — the runner: lead sources, cursor store, live POST.
- `sample-leads.json` — fixture for the dry run (2 eligible, 2 ineligible).

## Eligibility (both required)

1. **Card on file** — `stripeCustomerId` is a `cus_…` id.
2. **Business baseline** — a valid email + business name + at least one of
   `address` / `website` / `service` (needed to create the client and generate
   keywords when the lead has none).

Ineligible leads are skipped with a reason and never submitted.

## Run

Dry run (no writes — prints what would happen):

```bash
LEAD_SOURCE=file LEAD_FILE=scripts/lead-pull/sample-leads.json DRY_RUN=1 \
  node scripts/lead-pull/run.ts
```

Live (prod) — **note: a real run emails all 4 owners per created client**:

```bash
API_BASE=https://jjm59vpn3y.us-east-1.awsapprunner.com \
FREE_TRIAL_TOKEN=...   # Secrets Manager: aeo-admin/prod \
LEAD_SOURCE=http LEADS_URL=<belle's endpoint> LEADS_URL_TOKEN=... \
  node scripts/lead-pull/run.ts
```

Exit code `2` if any lead failed (so a scheduler surfaces it). Failed leads are
**not** marked processed — they retry on the next run.

## Lead shape

The source produces objects matching `RawLead` in `core.ts`. Field aliases the
`/free-trial` endpoint also accepts (`customerName`, `firstName`) are handled
server-side. Minimal eligible lead:

```json
{
  "leadRef": "L-1001",
  "email": "owner@business.com",
  "businessName": "Joe's Plumbing",
  "service": "emergency plumber",
  "address": "123 Main St, Miami, FL",
  "stripeCustomerId": "cus_ABC123",
  "signupType": "trial"
}
```

`keywords` is optional — if present we use them, otherwise the admin generates
5 buyer-intent local keywords from `service`. `signupType: "direct"` routes to a
paid "Signal AEO Plan" instead of the trial.

## What we need from belle (access request)

Pick **one** — the HTTP option is the least work and needs no AWS wiring:

- **(Preferred) A read-only "list eligible leads" endpoint.** A GET that returns
  a JSON array (or `{ data: [...] }`) of leads with a card on file + baseline,
  in the `RawLead` shape above. We call it with a bearer token
  (`LEADS_URL_TOKEN`). Set `LEAD_SOURCE=http`. Nothing else on belle's side
  changes.
- **Or a read-only DynamoDB role** into their AWS account (`471176250120`) for
  our poller (Scan/Query on the leads table). We'd add `@aws-sdk/client-dynamodb`
  and a `dynamodb` source adapter; `LEAD_SOURCE=dynamodb` is stubbed to fail with
  this note until that access exists.

## Direct vs trial

Default is `trial`. To auto-route paid signups, belle includes
`signupType: "direct"` (or we set it per-lead). If belle can't add the field,
mark direct clients by hand in admin — decide by whether direct is common or rare.

## Scheduling

Once a live source exists, run on a cron (local `/loop`, App Runner scheduled
job, or an EventBridge rule). The cursor file (`.processed.json`, gitignored)
keeps runs idempotent; the server is idempotent by email regardless.
