# Device Farm Proof Integration — MVP (IMPLEMENTED)

**Status:** ✅ Live in production. Create endpoint **and** proof generation **and** a read API are done. The device farm needs **no changes** — AEOAdmin already has the rank + screenshot, so it generates the proofs itself.

**The single join key:** the IDs returned at lead creation (`clientId`, `campaignId`, `keywordId`) + `leadRef`. Everything keys off those — no fuzzy matching.

---

## 1. Create a farm-ready lead (live)

```
POST https://jjm59vpn3y.us-east-1.awsapprunner.com/api/onboarding/free-trial
X-Free-Trial-Token: <FREE_TRIAL_TOKEN>
X-Idempotency-Key: signalaeo:lead_abc123        (preferred)
```

```json
{
  "businessName": "Joe's Plumbing",
  "email": "joe@example.com",
  "keywords": ["emergency plumber austin", "water heater repair austin"],
  "address": "123 Main St, Austin, TX",
  "website": "https://joesplumbing.com",
  "brand": "signalaeo",
  "leadRef": "lead_abc123",
  "source": "crm_farm_ready"
}
```

Required: `businessName`, `email`, `keywords`. Preferred: `address`, `website`, `brand`, `leadRef`.

**Response (201 created / 200 idempotent):**

```json
{
  "ok": true,
  "clientId": 159,
  "businessId": 181,
  "campaignId": 185,
  "keywordIds": [1532, 1533],
  "proofClientSlug": "joes-plumbing",
  "brand": "signalaeo",
  "leadRef": "lead_abc123"
}
```

- `keywordIds` are returned in the same order as the `keywords` you sent.
- Reposting the same lead (`X-Idempotency-Key`, or same email) returns the same IDs with `"idempotent": true` — never a duplicate.

---

## 2. Proof generation (live — AEOAdmin does this automatically)

Whenever a farm-ready lead's keyword lands **top-3 on any platform**, AEOAdmin writes the proof to S3 automatically (no device-farm work). It also runs on the existing ranking pipeline, so nothing extra needs to fire.

**Bucket:** `aeo-rank-screenshots` (existing — no new bucket).
**Path (ID-keyed):**

```
{brand}/clients/{clientId}/campaigns/{campaignId}/keywords/{keywordId}/{yyyy-mm-dd}/screenshot.png
{brand}/clients/{clientId}/campaigns/{campaignId}/keywords/{keywordId}/{yyyy-mm-dd}/manifest.json
```

Example:

```
signalaeo/clients/159/campaigns/185/keywords/1532/2026-06-12/screenshot.png
```

**manifest.json** (written next to each screenshot):

```json
{
  "brand": "signalaeo",
  "leadRef": "lead_abc123",
  "proofClientSlug": "joes-plumbing",
  "clientId": 159,
  "businessId": 181,
  "campaignId": 185,
  "keywordId": 1532,
  "keyword": "emergency plumber austin",
  "platform": "gemini",
  "rank": 1,
  "capturedAt": "2026-06-12T14:00:00.000Z",
  "screenshotKey": "signalaeo/clients/159/campaigns/185/keywords/1532/2026-06-12/screenshot.png"
}
```

**Qualification (enforced automatically):**

- `brand` is set (lead came from the CRM flow), and
- rank is **1, 2, or 3**, and
- keyword is **non-branded** (does not contain the business name — e.g. "joes plumbing reviews" is skipped), and
- a screenshot exists.

**One proof per (keyword, date)** = the **best-ranked platform** that day (e.g. gemini #1 beats chatgpt #2), so the path stays clean. The winning platform is recorded in the manifest.

---

## 3. Read the proofs (live — recommended for the CRM)

Instead of listing S3, the CRM can poll a JSON API (same data, plus a signed screenshot URL):

```
GET https://jjm59vpn3y.us-east-1.awsapprunner.com/api/proofs
X-Free-Trial-Token: <FREE_TRIAL_TOKEN>
```

**Query params (all optional):** `brand`, `leadRef`, `clientId`, `since` (YYYY-MM-DD), `limit` (default 500).

**Response:**

```json
{
  "ok": true,
  "count": 1,
  "proofs": [
    {
      "brand": "signalaeo",
      "leadRef": "lead_abc123",
      "proofClientSlug": "joes-plumbing",
      "clientId": 159,
      "businessId": 181,
      "campaignId": 185,
      "keywordId": 1532,
      "keyword": "emergency plumber austin",
      "platform": "gemini",
      "rank": 1,
      "date": "2026-06-12",
      "capturedAt": "2026-06-12T14:00:00.000Z",
      "screenshotKey": "signalaeo/clients/159/campaigns/185/keywords/1532/2026-06-12/screenshot.png",
      "screenshotUrl": "https://aeo-rank-screenshots.s3.amazonaws.com/...signed... (1h)"
    }
  ]
}
```

- `screenshotUrl` is a 1-hour pre-signed URL — usable directly in Slack/email previews.
- Typical CRM use: `GET /api/proofs?since={yesterday}` once a day.

**Backfill (admin):** `POST /api/proofs/backfill` (same token, optional `{"since":"YYYY-MM-DD"}`) regenerates the S3 artifacts for all qualifying captures. Idempotent.

---

## 4. CRM daily flow (CRM owns this)

1. `GET /api/proofs?since={yesterday}` (or scan S3 for new `manifest.json`).
2. Match by `leadRef` (or `clientId`+`campaignId`+`keywordId`).
3. Confirm `rank ∈ {1,2,3}` and lead is active / not opted out.
4. Post the screenshot to Slack for approval.
5. After approval → SMS/email → nurture.

No business-name fuzzy matching for customer-facing proof (allowed only for internal hints).

---

## 5. Out of scope (unchanged — CRM owns, or not in MVP)

Slack approval, SMS/email send, nurture, payment/Calendly · webhooks, signed webhook delivery, retry queues, separate proof API, proof-approval UI.

---

## 6. Acceptance criteria

| Criterion                                                  | Status                               |
| ---------------------------------------------------------- | ------------------------------------ |
| CRM posts a farm-ready lead                                | ✅ live                              |
| Endpoint returns clientId/businessId/campaignId/keywordIds | ✅                                   |
| Endpoint returns `proofClientSlug` (Option A)              | ✅                                   |
| Reposting the same lead does not duplicate                 | ✅ (idempotency key + email floor)   |
| Top-3 screenshots stored in S3 with the ID path            | ✅ AEOAdmin auto-generates           |
| Each screenshot has a `manifest.json`                      | ✅                                   |
| Manifest has enough IDs for CRM matching                   | ✅                                   |
| CRM can find + validate proof (S3 or `GET /api/proofs`)    | ✅ data side live; CRM wires polling |
| Slack approval before SMS/email                            | ⬜ CRM (existing)                    |

**For the CRM team:** you only need to (a) call the create endpoint when a lead is farm-ready, and (b) poll `GET /api/proofs?since=…` daily, then run your existing Slack→SMS/email flow. Everything on the AEOAdmin/device-farm side is done.
