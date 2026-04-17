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

## Typical Executor Flow

```
1. GET /api/keywords              → get all active keywords
2. GET /api/aeo-plans             → get campaign search addresses
3. POST /api/ranking-runs         → create run (status: "running")
4. For each keyword × platform:
     POST /api/ranking-reports    → submit result
5. PATCH /api/ranking-runs/:id    → update run (status: "completed")
```

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
