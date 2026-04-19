# Onboarding API Reference

After a customer purchases via Recurly, the onboarding form posts to this endpoint to provision their record in AEO Admin. One call creates the full hierarchy: **Client → Business → Campaign → Keywords**.

## Authentication

All requests require the `X-Onboarding-Token` header. The token is stored in the `ONBOARDING_TOKEN` environment variable on the admin API (managed via AWS Secrets Manager in production).

```
X-Onboarding-Token: <token>
```

## Base URL

| Environment | URL |
|---|---|
| Production | `https://jjm59vpn3y.us-east-1.awsapprunner.com` |
| Local | `http://localhost:3000` |

---

## POST /api/onboarding

Create a new customer record. Idempotent on `recurlySubscriptionId` — re-posting the same subscription returns the existing record instead of creating a duplicate.

### Request

```bash
curl -X POST https://jjm59vpn3y.us-east-1.awsapprunner.com/api/onboarding \
  -H "X-Onboarding-Token: $ONBOARDING_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Jane Doe",
    "customerEmail": "jane@acme.com",
    "businessName": "Acme Plumbing",
    "gmbUrl": "https://maps.google.com/?cid=12345",
    "businessAddress": "123 Main St, Austin, TX 78701",
    "keywords": [
      "emergency plumber austin",
      "drain cleaning austin",
      "water heater repair"
    ],
    "recurlySubscriptionId": "sub_abc123"
  }'
```

### Body fields

| Field | Type | Required | Description |
|---|---|---|---|
| `customerName` | string | yes | The buyer's full name. Stored on the client record as `accountUserName`. |
| `customerEmail` | string | yes | Buyer's email. Stored as `accountEmail` and `contactEmail`. Must be a valid email address. |
| `businessName` | string | yes | Business being promoted. Used both as the client's display name and the business record's name. |
| `keywords` | string[] | yes | At least one keyword. The first item is automatically marked **primary** (`isPrimary = 1`); all others are non-primary. |
| `recurlySubscriptionId` | string | yes | The Recurly subscription identifier. Used as the idempotency key — repeat posts return the existing record. |
| `gmbUrl` | string \| null | no | Google My Business URL. Stored on the business record. Note: this is a *pointer*, not the address — see `businessAddress` below. |
| `businessAddress` | string \| null | no (but **strongly recommended**) | Free-text business address (e.g. `"123 Main St, Austin, TX 78701"`). Copied into both `businesses.publishedAddress` and `client_aeo_plans.searchAddress`. **Without this, the executor cannot run geo-aware ranking searches** for this customer until an admin fills it in manually. |

### Response — 201 Created (new record)

```json
{
  "ok": true,
  "clientId": 42,
  "businessId": 87,
  "campaignId": 31,
  "keywordIds": [201, 202, 203]
}
```

### Response — 200 OK (idempotent replay)

If a campaign with this `recurlySubscriptionId` already exists, the endpoint returns the existing IDs without creating anything new:

```json
{
  "ok": true,
  "idempotent": true,
  "clientId": 42,
  "businessId": 87,
  "campaignId": 31,
  "keywordIds": [201, 202, 203]
}
```

### Defaults applied at creation

| Field | Default value |
|---|---|
| `clients.accountType` | `Retail` |
| `clients.status` | `active` |
| `businesses.status` | `active` |
| `client_aeo_plans.planType` | `Onboarding` |
| `client_aeo_plans.name` | `Onboarding` |
| `keywords.keywordType` | `3` (standard keyword) |
| `keywords.isActive` | `true` |
| `keywords[0].isPrimary` | `1` (first keyword only) |

These are placeholders — the admin team enriches them later through the admin panel (set the real plan tier, fill in business address/category, mark additional primary keywords, etc.).

### Error responses

| Status | Meaning |
|---|---|
| `400` | Validation error. Response body has `{ "error": "<reason>" }`, e.g. `"keywords must be a non-empty array of strings"` |
| `401` | Missing or invalid `X-Onboarding-Token` |
| `503` | `ONBOARDING_TOKEN` env var not configured on server |
| `500` | Internal server error (DB failure, transaction rolled back) |

---

## What happens next (admin-side workflow)

After a successful onboarding post, the customer's record appears immediately on `/clients`. The admin team typically:

1. Opens the client → fills in any missing business details (address, category, website).
2. Edits the campaign — sets the real plan tier, billing dates from Recurly, monthly budget, sample questions.
3. Reviews the keyword list and adjusts `isPrimary`, adds backlinks (`keywordType = 4`) if relevant.
4. Activates the client for the executor by leaving `status = active`.

The executor will pick up the keywords on the next ranking run automatically (filtered by `isActive = true`).

---

## Recurly integration notes

This endpoint **does not** call Recurly. It only stores the `recurlySubscriptionId` so the admin team can look up the subscription manually for now.

When we add the Recurly webhook integration later, billing fields (`subscriptionStartDate`, `nextBillingDate`, `cardLast4`, `monthlyAeoBudget`, `planType`) will be backfilled automatically into the campaign record using this same `subscriptionId` as the join key.

---

## Curl recipes

### Create

```bash
TOKEN="..."
BASE="https://jjm59vpn3y.us-east-1.awsapprunner.com"

curl -X POST "$BASE/api/onboarding" \
  -H "X-Onboarding-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Jane Doe",
    "customerEmail": "jane@acme.com",
    "businessName": "Acme Plumbing",
    "gmbUrl": "https://maps.google.com/?cid=12345",
    "businessAddress": "123 Main St, Austin, TX 78701",
    "keywords": ["plumber austin", "drain cleaning"],
    "recurlySubscriptionId": "sub_abc123"
  }'
```

### Verify auth

```bash
# Missing token → 401
curl -X POST "$BASE/api/onboarding" -H "Content-Type: application/json" -d '{}'

# Bad token → 401
curl -X POST "$BASE/api/onboarding" \
  -H "X-Onboarding-Token: wrong" \
  -H "Content-Type: application/json" -d '{}'
```

### Idempotency check

```bash
# First call → 201 with new ids
# Same call again → 200 with idempotent: true and the same ids
```
