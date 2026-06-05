# Device Farm Proof Integration — MVP Implementation Spec

**Status:** Create endpoint is **live in production** with all CRM fields below.
**Audience:** CRM team (polling/Slack/SMS) + device-farm team (screenshot + manifest writing).
**Scope:** the one reliable join key between CRM lead ⇄ external client/campaign/keyword ⇄ screenshot file. No webhooks, no new bucket, no fuzzy matching.

---

## 1. Create endpoint (DONE — live)

```
POST https://jjm59vpn3y.us-east-1.awsapprunner.com/api/onboarding/free-trial
```

**Headers**
| Header | Required | Value |
|---|---|---|
| `Content-Type` | yes | `application/json` |
| `X-Free-Trial-Token` | yes | the shared `FREE_TRIAL_TOKEN` |
| `X-Idempotency-Key` | preferred | `signalaeo:lead_abc123` or `top3:lead_abc123` |

**Request body**

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

- **Required:** `businessName`, `email`, `keywords` (non-empty array).
- **Strongly preferred:** `address`, `website`, `brand`, `leadRef`.
- `brand`, `leadRef`, `source` are stored on the created client and echoed back.

**Response — created (HTTP 201)**

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

- `proofClientSlug` is the **permanent slug stored on the real client record** (Matching Option A). It is generated once at creation from the business name and never changes. Use the value we return — do **not** regenerate it.
- `keywordIds` are returned **in the same order as the `keywords` array** you sent.

**Response — idempotent (HTTP 200)** — same shape plus `"idempotent": true`:

```json
{
  "ok": true,
  "idempotent": true,
  "clientId": 159,
  "businessId": 181,
  "campaignId": 185,
  "keywordIds": [1532, 1533],
  "proofClientSlug": "joes-plumbing"
}
```

**Error responses:** `400` validation (`{"error":"…"}`), `401` bad/missing token.

---

## 2. Idempotency (DONE)

Reposting the same lead never creates a duplicate. Resolution order:

1. **`X-Idempotency-Key`** header (or, if absent, `"{brand}:{leadRef}"` from the body) — exact match against the stored key.
2. **Email** — the floor. The same `email` always maps to the same client even if `leadRef` differs.

Either match returns the existing IDs + `proofClientSlug` with `idempotent: true`.

**Recommendation:** always send `X-Idempotency-Key: {brand}:{leadRef}` so reposts are matched by lead, not just email.

---

## 3. Screenshot + manifest storage (device-farm — TO BUILD)

When a qualifying top-3 proof is captured, write **two files** per keyword/day to the **existing** screenshots bucket (`aeo-rank-screenshots` — do not create a new bucket):

```
screenshot.png
manifest.json
```

**Canonical path (recommended — ID-based, Matching Option B):**

```
{brand}/clients/{clientId}/campaigns/{campaignId}/keywords/{keywordId}/{yyyy-mm-dd}/screenshot.png
{brand}/clients/{clientId}/campaigns/{campaignId}/keywords/{keywordId}/{yyyy-mm-dd}/manifest.json
```

Example:

```
signalaeo/clients/159/campaigns/185/keywords/1532/2026-06-12/screenshot.png
```

IDs are guaranteed unique and stable, so the CRM can match with zero fuzzy logic.

**Alternative path (Option A — human-readable):** swap `{clientId}` for `{proofClientSlug}`. The slug is stable too; pick one convention and keep it consistent. The manifest carries **both** the IDs and the slug regardless, so the CRM can match either way.

### manifest.json (required, one per screenshot folder)

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
  "rank": 2,
  "capturedAt": "2026-06-12T14:22:00Z",
  "screenshotKey": "signalaeo/clients/159/campaigns/185/keywords/1532/2026-06-12/screenshot.png"
}
```

`brand`, `leadRef`, and `proofClientSlug` are readable from the client record (join keyword → client). `rank`, `keyword`, `capturedAt`, `screenshotKey` come from the capture.

### Proof qualification (only write a manifest when ALL are true)

- Business is ranked **1, 2, or 3**.
- The keyword is **non-branded**.
- The screenshot clearly shows the business in the top 3.
- The screenshot belongs to the **same client/campaign/keyword** created from the CRM request (matched by the IDs above — never by name).

---

## 4. CRM daily polling (CRM — owned by CRM, unchanged)

1. Scan `aeo-rank-screenshots` for new `manifest.json` files.
2. Match by `brand`, then `leadRef` if present, else by `clientId` + `campaignId` + `keywordId`.
3. Confirm `rank ∈ {1,2,3}`.
4. Confirm lead is active and not opted out.
5. Post screenshot to Slack for approval.
6. After Slack approval → send SMS/email → start nurture.

---

## 5. No fuzzy matching for customer-facing proof

Business-name fuzzy matching is **not allowed** for sending proof, writing the proof slug, or auto-approval. It is only acceptable for internal audit suggestions / review hints. The join is always by the IDs returned at creation.

---

## 6. Explicitly NOT in this MVP

Webhooks · signed webhook verification · retry queues · separate proof API · proof-approval UI · customer SMS/email send · CRM nurture · payment/Calendly. The CRM already owns those.

---

## 7. Acceptance criteria status

| Criterion                                                  | Status                             |
| ---------------------------------------------------------- | ---------------------------------- |
| CRM can post a farm-ready lead                             | ✅ live                            |
| Endpoint returns clientId/businessId/campaignId/keywordIds | ✅                                 |
| Endpoint returns `proofClientSlug` (Option A)              | ✅                                 |
| Reposting the same lead does not duplicate                 | ✅ (idempotency key + email floor) |
| Device farm stores top-3 screenshots in S3                 | ⬜ device-farm to build            |
| Each screenshot has a `manifest.json`                      | ⬜ device-farm to build            |
| Manifest has enough IDs for CRM matching                   | ✅ spec'd above                    |
| CRM daily polling finds + validates proof                  | ⬜ CRM to build                    |
| Slack approval before SMS/email                            | ⬜ CRM (existing)                  |
