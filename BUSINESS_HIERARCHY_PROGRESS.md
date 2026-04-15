# feat/business-hierarchy — Progress Notes

Branch: `feat/business-hierarchy` (off `main`)
Goal: introduce `Client → Business → Campaign → Keyword` hierarchy.

## Target model

```
Client    (account holder — billing, plan, status)
  └─ Business   (brand — GMB, website, category, location)
       └─ Campaign (AEO plan / search location — target city, schema, service category)
            └─ Keyword  (scoped to a specific campaign, business, client)
```

- **Client**: who pays. Client-level data = account/billing.
- **Business**: the brand being marketed. A client can have many.
- **Campaign**: an AEO plan tied to a *search location*. A business can have many.
  Ranking is geo-specific → one business may run multiple campaigns (different cities/neighbourhoods).
- **Keyword**: always scoped to a single campaign. Stored with `business_id`, `aeo_plan_id`, `client_id` for fast filtering.

## Schema changes (Drizzle)

Applied via `scripts/migrate-to-businesses.mjs` (seed/backfill) and `drizzle-kit push`.

- **New** `lib/db/src/schema/businesses.ts`
  - Table `businesses`: `id, client_id FK, name, gmb_url, website_url, category, published_address, search_address, city, state, country, place_id, location_ref, latitude, longitude, timezone, website_published_on_gmb, website_linked_on_gmb, status (enum), notes, created_at, updated_at`
  - `business_status` enum: `active | inactive`
- **Added** `business_id` FK (nullable) to:
  - `keywords`
  - `sessions`
  - `ranking_reports`
  - `device_rotations`
  - `client_aeo_plans`
- **Added** `name TEXT` column to `client_aeo_plans` (campaign display name)
- `client_aeo_plans.business_name` still exists (legacy) — treat as deprecated
- `clients.business_name` still exists — currently the client display label; rename to `clients.name` is still pending (out of scope for now)

## Backend (artifacts/api-server)

- **New route** `artifacts/api-server/src/routes/businesses.ts`
  - `GET /api/businesses?clientId=` — list for a client, includes `keywordCount`
  - `GET /api/businesses/:id`
  - `POST /api/businesses` (requires `clientId`, `name`)
  - `PATCH /api/businesses/:id`
  - `DELETE /api/businesses/:id` (cascades)
  - Registered in `routes/index.ts` as `/businesses`
- **`routes/clients.ts`** — list GET:
  - Returns `keywordCount`, `businessCount`, `campaignCount` per client (via `groupBy` queries, not correlated subqueries — drizzle SQL template was mis-emitting column refs in subqueries so I rewrote as grouped IN-list queries)
- **`routes/client-aeo-plans.ts`** — campaigns:
  - Accept/persist `businessId` and `name`
  - `GET /api/clients/:clientId/aeo-plans?businessId=` filter
  - `GET /api/clients/:clientId/aeo-plans/:planId` added (single campaign fetch)
- **`routes/keywords.ts`**:
  - `POST /api/keywords` accepts `businessId`
  - `GET /api/keywords?businessId=` filter added

## Frontend (artifacts/admin-panel)

### New files
- `src/components/AddBusinessDialog.tsx` — create/edit dialog for a business (optional `business` prop for edit mode)
- `src/components/CampaignFormDialog.tsx` — create/edit dialog for a campaign (takes `clientId`, `businessId`, optional `campaign`). Fields: Name, Plan Type, Service Category, Target City/Radius, Schema Implementor
- `src/pages/business-detail.tsx` — route `/clients/:clientId/businesses/:businessId`
  - Header with Edit button
  - Business Details card
  - Campaigns card rendered as **table** (Name, Plan Type, Tier, Service Category, Target City/Radius, Schema By, Actions) — no Answer Presence column; row click navigates to campaign detail; add/edit/delete via `CampaignFormDialog` + confirm dialog
- `src/pages/campaign-detail.tsx` — route `/clients/:clientId/businesses/:businessId/campaigns/:campaignId`
  - Header with Edit + Delete buttons
  - Campaign Details card
  - Keywords card with inline Add Keyword + delete per keyword

### Modified pages/components
- `src/App.tsx` — registered two new routes:
  - `/clients/:clientId/businesses/:businessId`
  - `/clients/:clientId/businesses/:businessId/campaigns/:campaignId`
- `src/pages/clients.tsx` (Client list):
  - New **Businesses** column (pill count)
  - **Plan** column replaced with **Campaigns** column (pill count)
  - **Location** column removed
  - Actions dropdown replaced with inline icon buttons: Add Business (Building2), Edit/View (Pencil → client-detail), Delete (Trash2)
  - Open Maps action removed
  - Added post-create prompt: after creating a client, "Add a business now?" opens `AddBusinessDialog`
  - Delete Client with confirm dialog
- `src/pages/client-detail.tsx`:
  - Removed "Business Name" and "Search Address" from the Client Details card (those are business-level now)
  - New **BusinessesSection** component inside the file — card listing all businesses with clickable name (→ business detail), Edit (pencil, opens `AddBusinessDialog` in edit mode), Delete
  - `+ Add Business` button opens `AddBusinessDialog`
- `src/components/ClientAeoPlans.tsx` (campaigns at client level):
  - `AeoPlan` interface: added `businessId`, `name`
  - `EMPTY_FORM`: added `businessId: null`, `name: ""`
  - `PlanForm`:
    - New **Campaign Name** input at the top
    - "Client Name" readonly field replaced with **Business** required select (populated from `/api/businesses?clientId=`)
  - Main component fetches `businesses` and passes to `PlanForm`
  - `validateForm` enforces `businessId != null`
  - Table: added **Name** column (before Business) and **Business** column (joined from businesses list; falls back to legacy `businessName` text)
  - Row click: navigates to `/clients/:cid/businesses/:bid/campaigns/:pid` (if `businessId` present) else toggles inline expand
  - Chevron still toggles inline expand; action buttons `stopPropagation`
  - Inline expanded view now has `+ Add Keyword` input that POSTs to `/api/keywords` with `businessId + aeoPlanId`

## Scripts
- `scripts/migrate-to-businesses.mjs` — creates businesses table (if not via drizzle-kit), seeds one business per existing client, backfills `business_id` on child tables. Idempotent.
- `scripts/seed-sample.mjs` — creates 1 client + 1 business + 1 keyword for local dev

## Known quirks / gotchas

1. **api-server must be manually restarted** after any backend change — `pnpm --filter api-server run dev` builds then runs node (no watch). On code changes run `pnpm --filter api-server exec node build.mjs` and restart.
2. **Drizzle SQL template subquery pitfall**: `sql\`(SELECT ... FROM x WHERE x.client_id = ${clientsTable.id})\`` does NOT emit a correlated column reference reliably — it silently returned 0 for both `keywordCount` and `businessCount` before the rewrite. Use explicit `groupBy` queries + post-join in code instead.
3. `clients.business_name` remains — still the client "display label" across the app. Future cleanup: rename to `clients.name`, drop `clients.gmb_url`, `clients.search_address`, etc. (they moved to `businesses`).
4. `client_aeo_plans.business_name` is legacy — the FE falls back to it when `business_id` is null (shows italic).
5. Executor branch (`feat/executor-api-routes`) touches the same route files. Expect merge conflicts when that lands; resolution is mostly mechanical (Zod validation wrappers vs. `business_id` additions).

## Test data
- Admin user: `admin@signalaeo.com` / `Admin123!` (seeded via `scripts/seed-admin.ts`)
- Postgres: Docker container `aeo-postgres` (`postgres:16`), `localhost:5432`, db `seo_network_planner`, user/pw `postgres`/`password`

## Keywords menu refactor — DONE (2026-04-14)

**Frontend** (`artifacts/admin-panel/src/pages/keywords.tsx`):
- Grouping switched from `clientId` → `businessId`. Unassigned (`business_id IS NULL`) rows get their own bucket so nothing disappears.
- Cascade filter bar: **Client → Business → Campaign** at the top, each level disables until parent selected, with "Clear filters" button. All three query params wired to `GET /api/keywords?clientId=&businessId=&aeoPlanId=`.
- Business cards show business name + link to `/clients/:cid/businesses/:bid`, address from the business record, "Business inactive" badge from `businesses.status`. Each card also shows a "Client: X" deep link.
- When "All Clients" is active, cards are sorted by client name and a client-section divider is inserted when the client changes (outer client-level grouping without a separate collapsible level).
- Campaign sub-headers link to `/clients/:cid/businesses/:bid/campaigns/:pid` and render `campaign.name` when present.
- `KeywordDialog` now has a full Client → Business → Campaign cascade (all three required) instead of the old single "Business" (really client) select. Address preview sourced from the selected business.
- CSV/PDF export: new **Client** column; Business column resolves via `businessesMap`; PDF groups by `Client — Business`.
- Switched `useGetKeywords` → plain `useQuery` + `rawFetch` because the generated `GetKeywordsParams` only has `clientId`.

**Backend**:
- `PATCH /api/keywords/:id` now accepts `businessId` (and `clientId`) for reassignment.
- `GET /api/keywords` already supported `clientId`/`businessId`/`aeoPlanId` filters — verified working together.

## Rankings page — DONE (2026-04-15)

**Frontend** (`artifacts/admin-panel/src/pages/rankings.tsx`):
- `CompRow` type expanded with `businessId`, `businessName`, `aeoPlanId`.
- `byBusiness` / `byBusinessAll` now key on `businessId` (not `clientId`); "Unassigned" bucket (key 0) for rows without a business.
- Business card header shows `Client: X` sub-label underneath the business name; sort is `clientName → businessName`.
- Cascading filter bar **Client → Business → Campaign** (shadcn Select) placed under the Period Selector — applies before period filter, with Clear button.
- Export helpers renamed (`exportBizCSV(businessId, ...)` etc.) and lookups go through the business-keyed maps.
- CSV/PDF: new **Client** column; PDF `exportPDF` groups by business with `Client — Business` labels.
- All three lookup queries (`/api/clients`, `/api/businesses`, `/api/aeo-plans`) fetched via `useQuery` + `rawFetch`.

**Backend** (`ranking-reports.ts`):
- `GET /api/ranking-reports` joins `businesses` and returns `businessId`/`businessName`/`aeoPlanId` (done earlier).
- `GET /api/ranking-reports/initial-vs-current` now enriches each row with `businessId`/`businessName`/`aeoPlanId` derived from the keyword's business.
- `GET /api/ranking-reports/platform-summary` does the same for the per-platform keyword list.

**Removed:** (empty — placeholder below was previous pending section)

## Rankings page — pending notes (archived)

**Backend** (`artifacts/api-server/src/routes/ranking-reports.ts`): `GET /api/ranking-reports` now:
- Joins `businesses` table and returns `businessId`, `businessName`, `aeoPlanId` on each row.
- Accepts `?businessId=` and `?aeoPlanId=` query filters (alongside existing `clientId`/`keywordId`).
- `POST` accepts `businessId`.

**Frontend** (`artifacts/admin-panel/src/pages/rankings.tsx`, 2761 lines) — NOT yet refactored. Current state:
- `CompRow` type has `clientId`/`clientName` only; groups by `clientId` and labels the result "business"
- `byBusiness`/`byBusinessAll`/`exportBizCSV`/`exportBizPDF` all key on `clientId`
- No cascade filter

Needed (see task #23):
1. Expand `CompRow` with `businessId`/`businessName`/`aeoPlanId`
2. Group by `businessId`, add Unassigned bucket
3. Cascade filter Client → Business → Campaign (same component pattern as keywords.tsx)
4. Rename `byBusiness` maps to key on businessId; update export helpers
5. Deep-link business headers to `/clients/:cid/businesses/:bid`

This is a 2–3 hour standalone session — the file is large and the grouping touches multiple tabs, so it was intentionally deferred to keep the keywords PR reviewable.
