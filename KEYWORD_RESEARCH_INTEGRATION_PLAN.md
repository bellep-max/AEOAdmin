# Local Keyword Research + Geo-Grid Heatmap — AEOAdmin Design

_Full design, no code yet (2026-06-03). Companion to `device-agent/LOCAL_KEYWORD_RESEARCH.md`
(research + standalone prototype) and `device-agent/keyword_research.py` (working reference impl)._

---

## TL;DR

Two features for AEOAdmin:

- **A. Keyword Research** — LocalFalcon-style local keyword discovery. Ready to build natively in
  the existing Node/Express + Drizzle stack (autocomplete + the existing DeepSeek BE proxy + LVS
  scoring + a two-list UI that promotes ideas into the existing `keywords` pool). Low risk.
- **B. Geo-Grid Heatmap** — per-keyword rank-across-a-grid map (LocalFalcon's signature view).
  **The grid data does not exist yet** — today the fleet records *one* rank per keyword at *one*
  location (`ranking_reports.baseLatitude/mockedLatitude` are singular; `ranking_runs` batches
  *keywords*, not points; no grid logic anywhere). So the heatmap requires building a **grid-scan
  pipeline** first. Designed below so **one infra serves both surfaces** (Google local + AI
  platforms) via a pluggable per-point scanner.

Reuse, don't duplicate: AEOAdmin already has a backend **DeepSeek proxy**
(`artifacts/api-server/src/services/llm-client.ts` → `chatCompletion()`, key in `DEEPSEEK_API_KEY`),
a **keywords** entity + page, and an **executor-token ingestion** pattern the device fleet already
uses to POST rankings.

---

## Part A — Keyword Research (native, low risk)

### A1. Data model (new tables in `lib/db/src/schema/`)
Keep *discovery* separate from the curated `keywords` pool — research, then **promote** chosen ideas.

`keyword_research_runs.ts`
```
id, clientId (FK), businessId (FK, null), seed, location, gl, hl,
scoringWeights (jsonb), status, generatedAt, createdBy, createdAt
```
`keyword_research_ideas.ts`
```
id, runId (FK -> keyword_research_runs, cascade),
keyword, listType ('traditional' | 'ai_search'),
popularity (real, null), intent, commercialIntent (real),
reasoning (text), difficulty (real, null), difficultyBasis (text),
lvs (int), promotedKeywordId (FK -> keywords, null), createdAt
```
Migrate: add files, import in `schema/index.ts`, `pnpm -F @workspace/db push` (repo is push-based).

### A2. Backend (`artifacts/api-server/src/routes/keyword-research.ts`)
- `POST /api/keyword-research/runs` `{clientId, businessId?, seed, location, gl?, hl?}` →
  runs pipeline server-side, persists run + ideas, returns them.
  - **Idea-gen:** `fetch()` Google Autocomplete `https://suggestqueries.google.com/complete/search?client=firefox&hl=&gl=&q=` with the prototype's alphabet-soup + local-modifier expansion. Free.
  - **Enrichment:** call existing **`chatCompletion()`** (`deepseek-chat`) with the prototype's two prompts (per-keyword intent/commercial/reasoning JSON; conversational AI-search questions). Reuse — no second DeepSeek path.
  - **Scoring:** port `compute_lvs()` (LVS = popularity proxy + commercial intent − difficulty).
  - **Difficulty:** null in Phase 1 (neutral in LVS); filled once the grid/SERP bridge exists (Part C).
- `GET /api/keyword-research/runs?clientId=` — list past runs.
- `GET /api/keyword-research/runs/:id` — run + ideas.
- `POST /api/keyword-research/ideas/:id/promote` — create a `keywords` row from an idea, set `promotedKeywordId`.
  - Mapping: `idea.keyword → keywords.keywordText`; default `keywordType`, `isActive=true`; carry `clientId/businessId`; stash `intent/lvs` in `keywords.notes` until dedicated columns are wanted.

### A3. Contract + codegen
Add paths/schemas to `lib/api-spec/openapi.yaml` → `pnpm -F @workspace/api-spec codegen` →
React Query hooks in `lib/api-client-react` + Zod in `lib/api-zod` (established flow).

### A4. Frontend (`artifacts/admin-panel/src/pages/keyword-research.tsx`, Wouter route + nav item)
- Client/business selector + **seed** + **location** + **"Get Keywords"**.
- Two tabs (Traditional / AI search), shadcn `Table`, sortable by **LVS**; columns: keyword,
  intent badge, commercial intent, difficulty (+ basis tooltip), LVS, reasoning tooltip.
- Per-row **`+`** → `promote` mutation → toast. Reuse existing CSV/PDF export helpers.

**Effort:** small-medium, all within existing patterns. No new infra.

---

## Part B — Geo-Grid Heatmap (needs a new grid-scan pipeline)

### B0. Concept & placement
- **Unit of a heatmap = one keyword × one business × one surface × one grid-scan run.** One keyword
  → one grid → one heatmap. (Matches LocalFalcon.)
- **Placement: drill in from a keyword** → a **"Heatmap" tab**, with a **surface** selector
  (Google local / ChatGPT / Gemini / Perplexity) and a **run/date** selector. Map centered on the
  business; N×N colored points; a **SoLV %** badge. *Not* on the cross-keyword rankings table.

### B1. Data model (new tables in `lib/db/src/schema/`)
`grid_scan_runs.ts`
```
id, clientId (FK), businessId (FK), keywordId (FK),
surface enum ('google_local' | 'ai_chatgpt' | 'ai_gemini' | 'ai_perplexity'),
gridSize int (odd: 3|5|7), radiusMeters int,
centerLat, centerLng (double),
status enum ('queued'|'running'|'partial'|'success'|'failed'),
pointsTotal int, pointsDone int,
solv real (computed), avgRank real, foundPct real,
startedAt, finishedAt, createdAt, notes
```
`grid_scan_points.ts`
```
id, runId (FK -> grid_scan_runs, cascade),
row int, col int, lat, lng (double),
rankingPosition int (null), found boolean,
status enum ('queued'|'running'|'done'|'failed'),
rawJson jsonb (full scraper output), screenshotUrl text,
scannedAt, error text
```
Indexes: `(runId)`, `(keywordId, surface, createdAt)`.
_(Alternative: reuse `ranking_reports` + add `gridRunId/row/col`. Rejected — pollutes keyword-level
rankings. Dedicated tables are cleaner; optionally also mirror each point into `ranking_reports`.)_

### B2. Grid math (BE util `generateGrid(centerLat, centerLng, gridSize, radiusMeters)`)
Square grid centered on the business; `half = (gridSize-1)/2`; `spacing_m = radiusMeters / half`.
```
metersPerDegLat = 111_320
for r in -half..half, c in -half..half:
    lat = centerLat + (r * spacing_m) / metersPerDegLat
    lng = centerLng + (c * spacing_m) / (metersPerDegLat * cos(centerLat·π/180))
    store row = r+half (0..N-1), col = c+half
```
e.g. 5×5 @ radius 2000 m → points every 1000 m, ~4 km span. UI exposes gridSize {3,5,7} + radius
presets and shows **estimated scans = gridSize²** with a phone-burn warning.

### B3. Pluggable per-point scanner (this is how ONE infra serves BOTH surfaces)
Common contract — the device layer implements it; AEOAdmin only creates runs, hands out points, ingests:
```
ScanRequest  { keyword, lat, lng, surface, businessName, businessDomain }
ScanResult   { rankingPosition|null, found, rawJson, screenshotUrl, status }
```
- **`google_local`** → fleet runs the Google SERP scraper (`device-agent/seo_dispatch.py`) with the
  point's **mocked GPS**; find the business in the local-pack/organic → `rankingPosition` + screenshot.
- **`ai_chatgpt|ai_gemini|ai_perplexity`** → fleet runs the existing AEO flow with the point's mocked
  GPS + the keyword prompt; detect business mention + position → `rankingPosition`.
- GPS-mock per point is **already a fleet capability** (`ranking_reports.mockedLatitude/Longitude`),
  which de-risks "both surfaces, one infra." Only the per-point scanner differs; everything upstream
  (grid, run, ingest, SoLV, map) is shared.

### B4. Endpoints
- `POST /api/grid-scans` `{clientId, businessId, keywordId, surface, gridSize, radiusMeters}`
  (admin session) → creates run (`queued`) + generates `grid_scan_points` (`queued`); returns run+points.
- `GET /api/grid-scans?keywordId=&surface=` → runs list (for the run selector).
- `GET /api/grid-scans/:id` → run + points (for the map).
- `POST /api/grid-scans/:id/points/:pointId` (**executor-token** auth, same as ranking ingestion) →
  fleet posts a point result; server bumps `pointsDone`, recomputes `solv/avgRank/foundPct`, flips
  run `status` when complete.
- Dispatch to the fleet: prefer the **existing job queue** (RabbitMQ `local_device_manager_jobs_queue`)
  — enqueue one job per point — to match how the fleet already pulls work. (Fallback: a `claim` pull endpoint.)

### B5. SoLV & metrics
`solv = count(rankingPosition in 1..3) / pointsTotal`; also `avgRank` over found points and
`foundPct`. Stored on the run; shown as the headline badge.

### B6. Frontend (`artifacts/admin-panel`)
- Add `leaflet` + `react-leaflet` (only map dep; OSM tiles, free).
- `<KeywordHeatmap runId>` in the keyword drill-in: OSM map centered on `centerLat/Lng`, business
  marker, one `CircleMarker` per point colored by rank bucket — **1–3 green · 4–7 yellow · 8–10
  orange · >10 / not-found red** (LocalFalcon-style numbered circles), legend + SoLV badge.
- Controls: surface select, run/date select, "New scan" (gridSize + radius + N² warning). Handle
  loading / in-progress (points fill in) / partial / empty states.

### B7. Phone-burn math (explicit constraint)
`scans = gridSize²` per keyword per surface per run → 3×3=**9**, 5×5=**25**, 7×7=**49**.
Across M keywords × S surfaces: `gridSize² · M · S` per cycle (e.g. 5 kw × 5×5 × 1 surface = **125**
scans). This dominates cost and **burns phones** (see device-agent handover). Rules: default **3×3**
routine / **5×5** hero keywords; **never** dense grids on-device; rotate phones; cap concurrent runs.
Dense grids / high volume for `google_local` → a **SERP-API backbone** instead of phones.

---

## Part C — The bridge that unlocks measured difficulty + Google-local heatmap

The Node BE can't scrape Google — that's the device fleet. Today our **Google SERP pipeline
(`seo_dispatch.py`) is not wired to AEOAdmin at all** (`ranking_reports` is fed by the AI-platform
fleet). Building the grid-scan ingest (B4) with the `google_local` scanner (B3) is exactly this
bridge, and it also lets `difficulty_from_serp()` attach **measured difficulty** to
`keyword_research_ideas` (Part A). So Part B's `google_local` path and Part A's difficulty are the
same piece of plumbing.

---

## Candidate build order (decide after this review)

| Step | Scope | Depends on | Effort |
|---|---|---|---|
| 1 | **Keyword Research** (Part A) — ship the discovery feature | — | S–M |
| 2 | **Grid-scan core** — tables (B1) + grid math (B2) + endpoints (B4) + SoLV (B5) | — | M |
| 3 | **First scanner** — pick `google_local` *or* `ai_*` (B3) + fleet job wiring | 2 | M |
| 4 | **Heatmap UI** — Leaflet map + keyword drill-in (B6) | 2,3 | M |
| 5 | **Second scanner** — add the other surface (B3) | 3 | S |
| 6 | **Measured difficulty** — feed `google_local` SERP into Part A ideas (Part C) | 3(google) | S |

Recommended: **1 → 2 → 3 → 4** (ship keyword research, then stand up grid core with one surface and
its map), then 5–6. Prove step 3 with a **single 3×3 on-device scan** before building the UI.

---

## Decisions still open
1. **Lead feature:** Keyword Research (step 1) before the heatmap pipeline? (Recommended.)
2. **First heatmap surface:** `google_local` (LocalFalcon parity, needs the SERP bridge) vs `ai_*`
   (reuses the existing AEO fleet sooner)? (Infra is shared either way.)
3. **Branch/PR target** in `bellep-max/AEOAdmin`.
4. **Fleet dispatch:** per-point jobs over the existing RabbitMQ queue vs a new claim endpoint.
5. Long-term home of the Python prototype (reference only, or a CLI in `seo-device-agent`).

---

### Source files referenced (AEOAdmin)
- DB schema: `lib/db/src/schema/{keywords,keyword_links,ranking_reports,ranking_runs,session_platforms}.ts`; push via `lib/db` `drizzle-kit push`
- DeepSeek BE: `artifacts/api-server/src/routes/llm.ts`, `artifacts/api-server/src/services/llm-client.ts` (`chatCompletion()`, `DEEPSEEK_API_KEY`)
- Keywords E2E: `artifacts/api-server/src/routes/keywords.ts` → `lib/api-spec/openapi.yaml` → `lib/api-client-react` hooks → `artifacts/admin-panel/src/pages/keywords.tsx`
- Rankings: `artifacts/api-server/src/routes/ranking-reports.ts`, `artifacts/admin-panel/src/pages/rankings.tsx` (Recharts; **no map lib**)
- Codegen: `lib/api-spec/orval.config.ts` + `openapi.yaml`
