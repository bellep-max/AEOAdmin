# Email Status Tracking — Deploy & Provider Runbook

Code is complete and verified (see `EMAIL_STATUS_TRACKING_PLAN.md`). The additive
prod schema is **already applied** (email_events table + 6 email_sends columns,
existing 164 sends backfilled). Two steps remain — both need you: **deploy** and
**provider webhook config**. The webhooks fail closed until their secrets are set,
so nothing activates prematurely.

## 1. Add secrets to `aeo-admin/prod`

- `SENDGRID_WEBHOOK_PUBLIC_KEY` — base64 verification key from the SendGrid
  Signed Event Webhook (step 3).
- `GHL_WEBHOOK_SECRET` — a random string you generate; GHL sends it back in the
  `X-Webhook-Secret` header (or `?token=` query param).

## 2. Deploy the backend (code is built & green)

From repo root (per project deployment docs):

```bash
DOCKER_BUILDKIT=0 docker build --platform linux/amd64 \
  -f artifacts/api-server/Dockerfile -t <ecr>/aeo-admin-api:latest .
# docker push <ecr>/aeo-admin-api:latest
# aws apprunner start-deployment --service-arn <arn>   (AWS_PROFILE=aeo-admin)
```

Frontend auto-deploys on push to `main` (Vercel).

> CI `deploy-api.yml` auto-deploy is broken on the bellep repo (missing OIDC
> secret) — deploy is manual, as above.

## 3. Configure SendGrid (fallback send path)

1. SendGrid → Settings → Mail Settings → **Event Webhook**.
2. Post URL: `https://<api-host>/api/webhooks/sendgrid`.
3. Enable events: delivered, open, click, bounce, dropped, spam report, unsubscribe.
4. Enable **Signed Event Webhook** → copy the **Verification Key** →
   `SENDGRID_WEBHOOK_PUBLIC_KEY`.
5. Redeploy so the key is in env, then use SendGrid's "Test Your Integration".

## 4. Configure GHL (primary send path — most sales emails)

1. Subscribe LC Email events (delivered/opened/clicked/bounced/complained/
   unsubscribed) to `https://<api-host>/api/webhooks/ghl` via a workflow or app
   webhook.
2. Include the shared secret: header `X-Webhook-Secret: <GHL_WEBHOOK_SECRET>` (or
   append `?token=<GHL_WEBHOOK_SECRET>` to the URL).
3. GHL event field names vary by trigger — the handler reads common aliases and
   stores the raw payload in `email_events.payload`. After the first real events
   arrive, check a couple of payloads and tighten `GHL_MAP` in
   `services/email-status.ts` if any event name isn't mapping.

## 5. Smoke test end-to-end

1. Send one real sales email (to the GHL test contact —
   erven.i@appstango.com per house rule, never a live client for a test).
2. On the Sent Emails page the row starts **Sent**, then advances to
   **Delivered → Opened → Clicked** as GHL fires events; open the detail dialog to
   see the event timeline.
3. Verify idempotency: replaying the same event (unique `(provider,
provider_event_id)`) is a no-op.

## Rollback

Purely additive — to disable, unset the two webhook secrets (endpoints then 403
every event) and/or revert the code deploy. The columns/table can stay (unused).

## Notes

- **Open tracking is unreliable** (Apple Mail Privacy Protection pre-fetches the
  pixel → false opens). The UI labels Opened accordingly; **Clicked** is the
  trustworthy engagement signal.
- Endpoints are public but signature/secret-verified; raw body is captured only
  for `/api/webhooks/*`.
