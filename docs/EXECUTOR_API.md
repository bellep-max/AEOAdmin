# Executor API Reference

The AEO Executor (separate repo) uses these endpoints to **read** keyword/client data and **write** ranking results back to AEO Admin.

## Authentication

All write endpoints require the `X-Executor-Token` header. The token is stored in the `EXECUTOR_TOKEN` environment variable on both the executor and the admin API server.

```
X-Executor-Token: <token>
```

Read endpoints (GET) do **not** require the executor token — they use the same session auth as the admin panel. For the executor, pass the token header on all requests for simplicity; GET endpoints will ignore it.

## Base URL

| Environment | URL |
|---|---|
| Production | `https://jjm59vpn3y.us-east-1.awsapprunner.com` |
| Local | `http://localhost:3000` |

All endpoints are under `/api`.

---

## Read Endpoints (GET)

These endpoints let the executor discover which keywords to rank.

### GET /api/clients

Returns all clients.

```bash
curl https://jjm59vpn3y.us-east-1.awsapprunner.com/api/clients \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"
```

Response: array of client objects with `id`, `businessName`, `status`, etc.

### GET /api/keywords

Returns all keywords. Supports optional query filters.

```bash
# All keywords
curl https://jjm59vpn3y.us-east-1.awsapprunner.com/api/keywords \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"

# Filter by client
curl "https://jjm59vpn3y.us-east-1.awsapprunner.com/api/keywords?clientId=1" \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"

# Filter by business
curl "https://jjm59vpn3y.us-east-1.awsapprunner.com/api/keywords?businessId=1" \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"

# Filter by campaign (AEO plan)
curl "https://jjm59vpn3y.us-east-1.awsapprunner.com/api/keywords?aeoPlanId=1" \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"
```

Response: array of keyword objects. Key fields for the executor:

| Field | Type | Description |
|---|---|---|
| `id` | number | Keyword ID (use as `keywordId` when posting reports) |
| `clientId` | number | Parent client |
| `businessId` | number \| null | Parent business |
| `aeoPlanId` | number \| null | Parent campaign |
| `keywordText` | string | The keyword to search for |
| `keywordType` | number | `3` = keyword, `4` = keyword with backlinks |
| `isActive` | boolean | Only rank active keywords |

### GET /api/businesses

Returns all businesses.

```bash
curl https://jjm59vpn3y.us-east-1.awsapprunner.com/api/businesses \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"
```

### GET /api/aeo-plans

Returns all campaigns (AEO plans). Includes `searchAddress` which is the address to use for location-based searches.

```bash
curl https://jjm59vpn3y.us-east-1.awsapprunner.com/api/aeo-plans \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"
```

---

## Write Endpoints (POST/PATCH) — Require `X-Executor-Token`

### Ranking Runs

A **ranking run** represents one complete execution cycle (e.g., "weekly ranking run for all keywords").

#### POST /api/ranking-runs

Create a new ranking run at the start of execution.

```bash
curl -X POST https://jjm59vpn3y.us-east-1.awsapprunner.com/api/ranking-runs \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "running",
    "keywordsAttempted": 0,
    "keywordsSucceeded": 0,
    "keywordsFailed": 0,
    "notes": "Weekly ranking run"
  }'
```

Response: `201` with the created run object (includes `id`).

#### PATCH /api/ranking-runs/:id

Update the run when finished.

```bash
curl -X PATCH https://jjm59vpn3y.us-east-1.awsapprunner.com/api/ranking-runs/1 \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "finishedAt": "2026-04-17T06:00:00.000Z",
    "keywordsAttempted": 36,
    "keywordsSucceeded": 34,
    "keywordsFailed": 2,
    "notes": "2 keywords timed out on Perplexity"
  }'
```

### Ranking Reports

A **ranking report** is one keyword × one platform result.

#### POST /api/ranking-reports

Submit a single ranking result.

```bash
curl -X POST https://jjm59vpn3y.us-east-1.awsapprunner.com/api/ranking-reports \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": 1,
    "businessId": 1,
    "keywordId": 5,
    "platform": "chatgpt",
    "rankingPosition": 3,
    "reasonRecommended": "Mentioned as top provider in the area",
    "mapsPresence": true,
    "mapsUrl": "https://maps.google.com/...",
    "isInitialRanking": false
  }'
```

| Field | Type | Required | Description |
|---|---|---|---|
| `clientId` | number | yes | Client that owns this keyword |
| `businessId` | number \| null | no | Business the keyword belongs to |
| `keywordId` | number | yes | The keyword being ranked |
| `platform` | string | yes | `"chatgpt"`, `"gemini"`, or `"perplexity"` |
| `rankingPosition` | number \| null | no | Position (1 = best). `null` if not found |
| `reasonRecommended` | string \| null | no | Why the AI recommended the business |
| `mapsPresence` | boolean \| null | no | Whether Google Maps result appeared |
| `mapsUrl` | string \| null | no | Google Maps URL if present |
| `isInitialRanking` | boolean | no | `true` for first-ever ranking of this keyword |

Response: `201` with the created report object.

#### PATCH /api/ranking-reports/:id

Update an existing report (e.g., add screenshot URL after capture).

```bash
curl -X PATCH https://jjm59vpn3y.us-east-1.awsapprunner.com/api/ranking-reports/42 \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "screenshotUrl": "https://s3.amazonaws.com/...",
    "textRanking": "Business was mentioned 3rd in a list of 5 providers"
  }'
```

Updatable fields: `mapsUrl`, `mapsPresence`, `rankingPosition`, `reasonRecommended`, `screenshotUrl`, `textRanking`.

---

### Sessions (Daily session log)

One row per AI session executed by the executor. Surfaces in the admin panel under **Operations → Sessions → Daily**. Mirrors the `sessions_log.<client>.csv` shape from the executor.

#### POST /api/sessions

```bash
curl -X POST https://jjm59vpn3y.us-east-1.awsapprunner.com/api/sessions \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": 1,
    "businessId": 1,
    "campaignId": 1,
    "keywordId": 1,
    "clientName":   "Acme Dental Group",
    "bizName":      "Acme Dental — Downtown",
    "campaignName": "Downtown — Growth",
    "keywordText":  "best dentist downtown san francisco",
    "city":  "San Francisco",
    "state": "CA",
    "date":            "2026-04-20",
    "durationSeconds": 38.4,
    "promptText":      "Find a best dentist downtown san francisco",
    "followupText":    "Are they accepting new patients?",
    "hasFollowUp":     true,
    "status":     "success",
    "type":       "aeo",
    "errorClass": null,
    "errorMessage": null,
    "aiPlatform":   "chatgpt",
    "screenshotUrl": "https://...",
    "deviceIdentifier": "device-102",
    "proxyStatus":    "CONNECTED",
    "proxySessionId": "decodo-94110-sess1",
    "proxyUsername":  "decodo-94110-sess1",
    "proxyHost":      "gate.decodo.com",
    "proxyPort":      10001,
    "proxyIp":        "73.231.45.12",
    "proxyCity":      "San Francisco",
    "proxyRegion":    "California",
    "proxyCountry":   "United States",
    "proxyZip":       "94110",
    "baseLatitude":     37.7749,
    "baseLongitude":   -122.4194,
    "mockedLatitude":   37.7801,
    "mockedLongitude": -122.4078,
    "mockedTimezone":   "America/Los_Angeles",
    "backlinksExpected": 1,
    "backlinkFound":     true,
    "backlinkUrl":       "https://acmedental.example/downtown"
  }'
```

#### Body fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `clientId` | int | **yes** | FK to `clients.id` |
| `businessId` | int \| null | no | FK to `businesses.id` |
| `campaignId` | int \| null | no | FK to `client_aeo_plans.id` (the campaign) |
| `keywordId` | int \| null | no | FK to `keywords.id` |
| `deviceId` | int \| null | no | FK to `devices.id` (internal pool id, not the ADB serial) |
| `proxyId` | int \| null | no | FK to `proxies.id` |
| `clientName` | string \| null | no | Snapshot of client name. Stored alongside the FK so the row stays readable even if the client is renamed/deleted. |
| `bizName` | string \| null | no | Snapshot of business name. |
| `campaignName` | string \| null | no | Snapshot of campaign name. |
| `keywordText` | string \| null | no | Snapshot of keyword text. |
| `city` | string \| null | no | Business city at run time. |
| `state` | string \| null | no | Business state at run time. |
| `date` | string \| null | no | `YYYY-MM-DD` UTC. Defaults to NULL — UI falls back to `timestamp`. |
| `timestamp` | — | (auto) | Server sets `now()` at insert time. |
| `durationSeconds` | float \| null | no | Wall-clock seconds for the run. |
| `promptText` | string \| null | no | First prompt sent to the AI (renamed `prompt` accepted as alias). |
| `followupText` | string \| null | no | Follow-up prompt if any (renamed `followUp` accepted as alias). |
| `hasFollowUp` | boolean | no | True if a follow-up was sent. |
| `status` | string | no (default `pending`) | `success` \| `error` \| `pending`. **When `error`, populate `errorMessage`.** |
| `type` | string | no (default `aeo`) | `aeo` \| `audit`. Use `aeo` for daily runs; the audit endpoint below is preferred for audit mode. |
| `errorClass` | string \| null | no | Optional bucket: `captcha`, `timeout`, `geoblock`, etc. |
| `errorMessage` | string \| null | conditional | Free-text error message. **Required when `status="error"`.** |
| `aiPlatform` | string | no (default `gemini`) | `gemini` \| `chatgpt` \| `perplexity`. (Alias `platform` is also accepted.) |
| `screenshotUrl` | string \| null | no | URL or relative path to the screenshot artifact. |
| `deviceIdentifier` | string \| null | no | Your internal device pool id (e.g. `device-102`). Distinct from the device's ADB serial. |
| `proxyStatus` | string \| null | no | `CONNECTED` \| `SKIPPED` \| `ERROR`. |
| `proxySessionId` | string \| null | no | Decodo session token. |
| `proxyUsername` | string \| null | no | Full Decodo username including session id + zip. |
| `proxyHost` | string \| null | no | `gate.decodo.com` or gost LAN IP. |
| `proxyPort` | int \| null | no | `10001` (direct) or `11001+` (via gost). |
| `proxyIp` | string \| null | no | Exit IP (from `ipinfo.io`). |
| `proxyCity` / `proxyRegion` / `proxyCountry` / `proxyZip` | string \| null | no | Exit-IP geo metadata. |
| `baseLatitude` / `baseLongitude` | float \| null | no | Business coordinates pre-randomization. |
| `mockedLatitude` / `mockedLongitude` | float \| null | no | Actual GPS mock sent to the device (±5 mi random). |
| `mockedTimezone` | string \| null | no | IANA tz set on device (e.g. `America/Chicago`). |
| `backlinksExpected` | int \| null | no | Number of backlinks passed to the flow. |
| `backlinkFound` | boolean | no | True if a configured backlink appeared in the AI response. |
| `backlinkUrl` | string \| null | no | URL that was clicked. |

#### Response — 201 Created

Returns the inserted row as JSON, including the new `id`. Example:

```json
{
  "id": 7,
  "clientId": 1,
  "businessId": 1,
  "campaignId": 1,
  "keywordId": 1,
  "status": "success",
  "aiPlatform": "chatgpt",
  "timestamp": "2026-04-20T03:21:42.123Z",
  "...": "...all other fields..."
}
```

#### Errors

| Status | Body | Cause |
|---|---|---|
| `400` | `{"error":"clientId is required"}` | `clientId` missing |
| `401` | `{"error":"missing executor token"}` / `{"error":"invalid executor token"}` | Header missing or wrong |
| `503` | `{"error":"executor token not configured"}` | Server-side `EXECUTOR_TOKEN` env var unset |
| `500` | `{"error":"Internal server error"}` | Server logged the cause; check `pino` output |

#### GET /api/sessions

Read endpoint used by the admin panel. Useful for executor self-checks too.

Query params (all optional): `clientId`, `businessId`, `campaignId`, `deviceId`, `platform`, `status`, `from` (ISO date/datetime), `to` (ISO), `limit` (default 50, max 200), `offset`.

```bash
curl 'https://jjm59vpn3y.us-east-1.awsapprunner.com/api/sessions?clientId=1&platform=gemini&status=error&from=2026-04-01&limit=20' \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"
```

Response:

```json
{
  "sessions": [ /* array of session rows, newest first */ ],
  "total": 1234,
  "offset": 0,
  "limit": 20
}
```

---

### Audit Logs (Audit ranking)

One row per keyword × platform audit-mode run. Surfaces in the admin panel under **Operations → Sessions → Audit Ranking**. Mirrors the `audit_results/audit_log.csv` shape.

#### POST /api/audit-logs

```bash
curl -X POST https://jjm59vpn3y.us-east-1.awsapprunner.com/api/audit-logs \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId":   1,
    "businessId": 1,
    "campaignId": 1,
    "keywordId":  1,
    "bizName":      "Acme Dental — Downtown",
    "campaignName": "Downtown — Growth",
    "keywordText":  "best dentist downtown san francisco",
    "platform":        "Gemini",
    "mode":            "adb",
    "device":          "adb-14914555208W005-27c1FH",
    "status":          "success",
    "durationSeconds": 27.0,
    "rankPosition": 2,
    "rankTotal":    8,
    "mentioned":    "yes",
    "rankContext":  "Acme Dental Group ranked among the top emergency dentists",
    "screenshotPath": "audit_results/Gemini/1_aud_20260420.png",
    "responseText":   "audit_results/text/1_Gemini.txt",
    "prompt":         "Find best dentist downtown san francisco; recommend the top providers in this area.",
    "error":          null,
    "proxyUsername": "decodo-94110-sess1",
    "proxyIp":       "73.231.45.12",
    "proxyCity":     "San Francisco",
    "proxyRegion":   "California",
    "proxyZip":      "94110"
  }'
```

#### Body fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `clientId` | int \| null | recommended | FK to `clients.id` |
| `businessId` | int \| null | no | FK to `businesses.id` |
| `campaignId` | int \| null | no | FK to `client_aeo_plans.id` |
| `keywordId` | int \| null | no | FK to `keywords.id` |
| `deviceId` | int \| null | no | FK to `devices.id` |
| `bizName` / `campaignName` / `keywordText` | string \| null | no | Snapshot strings (kept even if FKs go stale) |
| `platform` | string | no | `Gemini` \| `ChatGPT` \| `Perplexity` (capitalised — matches CSV) |
| `mode` | string | no | `adb` \| `appium` |
| `device` | string \| null | no | ADB serial (truncated to 40 chars). The numeric pool id goes in `deviceId`. |
| `status` | string \| null | no | `success` \| `error`. **When `error`, populate `error`.** |
| `durationSeconds` | float \| null | no | Session wall time. |
| `rankPosition` | int \| null | no | Parsed position from `[RANK: X/Y]`. |
| `rankTotal` | int \| null | no | Parsed total from `[RANK: X/Y]`. |
| `mentioned` | string \| null | no | `"yes"` if the business was mentioned, else `""`. |
| `rankContext` | string \| null | no | Snippet around the ranking mention (max 100 chars). |
| `screenshotPath` | string \| null | no | Relative path to the screenshot artifact (alias `screenshot` accepted). |
| `responseText` | string \| null | no | Relative path to the saved response text. |
| `prompt` | string \| null | no | Literal prompt sent to the AI (rendered from the template). |
| `error` | string \| null | conditional | Error message. **Required when `status="error"`** (max ~200 chars). |
| `proxyUsername` | string \| null | no | Decodo username. |
| `proxyIp` | string \| null | no | Exit IP. |
| `proxyCity` / `proxyRegion` / `proxyZip` | string \| null | no | Exit-IP geo metadata. |

#### Response — 201 Created

Returns the inserted row as JSON.

#### GET /api/audit-logs

Query params: `clientId`, `businessId`, `campaignId`, `keywordId`, `platform`, `mode`, `status`, `from`, `to`, `limit`, `offset`.

```bash
curl 'https://jjm59vpn3y.us-east-1.awsapprunner.com/api/audit-logs?clientId=1&platform=Gemini&status=error&from=2026-04-01' \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"
```

Response:

```json
{
  "logs": [ /* array of audit rows, newest first */ ],
  "total": 248,
  "offset": 0,
  "limit": 50
}
```

---

### Delete Endpoints

All delete endpoints return `{ ok: true, deleted: {...} }` on success, `404` if the id does not exist.

| Endpoint | Auth | Description |
|---|---|---|
| `DELETE /api/ranking-reports/:id` | `X-Executor-Token` | Delete a single ranking report |
| `DELETE /api/ranking-runs/:id` | `X-Executor-Token` | Delete a ranking run |
| `DELETE /api/sessions/:id` | session | Delete a session |
| `DELETE /api/audit-logs/:id` | session | Delete an audit log |

```bash
curl -X DELETE https://jjm59vpn3y.us-east-1.awsapprunner.com/api/ranking-reports/42 \
  -H "X-Executor-Token: $EXECUTOR_TOKEN"
```

---

### Search Counts

Each keyword tracks how many times it was searched. These counts surface as **"INITIAL SEARCH COUNT"** and **"FOLLOW-UP SEARCH COUNT"** on the keyword card, and in the CSV/PDF exports.

Four fields:

| Field | UI label | Scope |
|---|---|---|
| `initialSearchCount30Days` | Search Count (card) | Rolling 30 days |
| `followupSearchCount30Days` | Follow-up Search Count (card) | Rolling 30 days |
| `initialSearchCountLife` | Search (Life) — CSV only | All time |
| `followupSearchCountLife` | Follow-up Search (Life) — CSV only | All time |

#### PATCH /api/keywords/:id

Write the new absolute values (**not** an increment — the executor owns the math).

```bash
curl -X PATCH https://jjm59vpn3y.us-east-1.awsapprunner.com/api/keywords/5 \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "initialSearchCount30Days": 12,
    "followupSearchCount30Days": 8,
    "initialSearchCountLife": 45,
    "followupSearchCountLife": 23
  }'
```

All four fields are optional — only send the ones you want to update.

#### Increment pattern

To add N searches, read → add → write:

```bash
# 1. Read the current keyword
KW=$(curl -s "https://jjm59vpn3y.us-east-1.awsapprunner.com/api/keywords?clientId=1" \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" | jq '.[] | select(.id==5)')

CURR_30D=$(echo "$KW" | jq '.initialSearchCount30Days // 0')
CURR_LIFE=$(echo "$KW" | jq '.initialSearchCountLife // 0')

# 2. PATCH with incremented values
curl -X PATCH "https://jjm59vpn3y.us-east-1.awsapprunner.com/api/keywords/5" \
  -H "X-Executor-Token: $EXECUTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"initialSearchCount30Days\": $((CURR_30D + 1)),
    \"initialSearchCountLife\": $((CURR_LIFE + 1))
  }"
```

#### Typical usage

- **Initial search**: when the executor runs a keyword for the **first time** in a session → increment both `initialSearchCount30Days` and `initialSearchCountLife` by 1
- **Follow-up search**: re-ranking an existing keyword → increment both `followupSearchCount30Days` and `followupSearchCountLife` by 1

Keep the 30-day and Life counters in sync — the 30-day counter should be recomputed by your executor based on sessions in the last 30 days; Life only ever grows.

---

## Typical Executor Flow

```
1. GET /api/keywords              → get all active keywords
2. GET /api/aeo-plans             → get campaign search addresses
3. POST /api/ranking-runs         → create run (status: "running")
4. For each keyword × platform:
     POST /api/ranking-reports    → submit result
5. PATCH /api/ranking-runs/:id    → update run (status: "success")
```

> ⚠️ **Step 5 is mandatory.** If you skip the final PATCH, the Rankings page will show a permanent "Run in progress" banner. Always wrap steps 3–5 in a try/finally so a crash mid-run still marks the run `failed` rather than leaving it stuck as `running`.

### Complete Example (bash)

```bash
BASE="https://jjm59vpn3y.us-east-1.awsapprunner.com"
TOKEN="your-executor-token-here"
HEADERS=(-H "X-Executor-Token: $TOKEN" -H "Content-Type: application/json")

# 1. Get active keywords
KEYWORDS=$(curl -s "$BASE/api/keywords" "${HEADERS[@]}")

# 2. Start a ranking run
RUN=$(curl -s -X POST "$BASE/api/ranking-runs" "${HEADERS[@]}" \
  -d '{"status":"running","notes":"Weekly run"}')
RUN_ID=$(echo "$RUN" | jq '.id')

# 3. Submit ranking for keyword 5 on ChatGPT
curl -s -X POST "$BASE/api/ranking-reports" "${HEADERS[@]}" \
  -d '{
    "clientId": 1,
    "businessId": 1,
    "keywordId": 5,
    "platform": "chatgpt",
    "rankingPosition": 3,
    "isInitialRanking": false
  }'

# 4. Finish the run
curl -s -X PATCH "$BASE/api/ranking-runs/$RUN_ID" "${HEADERS[@]}" \
  -d "{\"status\":\"completed\",\"finishedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"keywordsAttempted\":36,\"keywordsSucceeded\":34,\"keywordsFailed\":2}"
```

---

## Error Responses

| Status | Meaning |
|---|---|
| `401` | Missing or invalid `X-Executor-Token` |
| `503` | `EXECUTOR_TOKEN` env var not configured on server |
| `404` | Resource not found (wrong ID) |
| `500` | Internal server error |

## Platform Values

Use exactly these lowercase strings:
- `chatgpt`
- `gemini`
- `perplexity`
