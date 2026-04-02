# Workspace

## Overview

Signal AEO Admin Panel — a full-stack operations dashboard for managing AEO (Answer Engine Optimization) campaigns using an Android device farm for local SEO businesses.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Recharts
- **Routing**: Wouter
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (all routes)
│   └── admin-panel/        # React + Vite frontend dashboard
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema (11 tables)

- `clients` — business registry (companies getting AEO campaigns)
- `keywords` — per-client keyword pool (5 AEO keywords per client)
- `sessions` — AEO session log (every Appium run, device, proxy, AI platform)
- `devices` — Android device farm (status, retired_today, model)
- `proxies` — Decodo rotating proxy pool (50% residential, 50% mobile)
- `plans` — subscription plan catalog
- `schedules` — per-client cron config (frequency per day)
- `ranking_reports` — weekly AI ranking results (initial + current positions)
- `tasks` — internal kanban board
- `subtasks` — task checklist items
- `users` — admin accounts

## API Routes (artifacts/api-server)

- `GET/POST /api/clients` — client CRUD
- `GET/PATCH/DELETE /api/clients/:id` — client detail/update/delete
- `GET /api/clients/:id/gbp-snippet` — GBP verification snippet
- `GET /api/clients/:id/aeo-summary` — AEO 5-keyword summary with before/after dates
- `GET/POST /api/keywords` — keyword pool management
- `GET/POST /api/sessions` — AEO session log
- `GET /api/sessions/stress-test` — stress test metrics
- `GET /api/devices/farm-status` — device farm overview
- `GET/POST/PATCH /api/devices` — device management
- `GET/POST /api/proxies` — proxy pool
- `GET /api/plans` — subscription plans
- `GET/POST /api/ranking-reports` — ranking reports
- `GET /api/ranking-reports/initial-vs-current` — before/after ranking comparison
- `GET/POST/PATCH/DELETE /api/tasks` — kanban tasks
- `GET /api/dashboard/summary` — dashboard stats
- `GET /api/dashboard/session-activity` — 14-day chart data
- `GET /api/dashboard/platform-breakdown` — Gemini/ChatGPT/Perplexity split
- `GET /api/dashboard/network-health` — device/proxy health score
- `GET /api/scaling/plan` — hardware scaling milestones

## Admin Panel Pages

- `/` — Dashboard (network health, stats, session activity chart, platform donut)
- `/clients` — Client list + add modal
- `/clients/:id` — Client detail (GBP snippet, AEO summary, 5 keywords with before/after)
- `/keywords` — Keyword pool (filter by client/tier/verification)
- `/sessions` — Sessions log (paginated, with prompt/followup)
- `/sessions/stress-test` — Stress test metrics (capacity, timing, throughput)
- `/devices` — Android device farm grid
- `/proxies` — Proxy pool (residential + mobile split)
- `/rankings` — Ranking reports + initial vs current comparison
- `/scaling` — Hardware scaling plan (April 20 → 50 → 80, May 150 companies)
- `/tasks` — Kanban board (todo/in_progress/done)
- `/plans` — Subscription plan catalog

## Scaling Plan

- **Now (April 2, 2026)**: 20 companies, current network testing, 1 search/day/device
- **April Week 1**: 50 companies, hardware procurement
- **April Week 2**: 80 companies, find hardware
- **May 2026**: 150 companies target

## Color Theme

Deep navy/slate dark theme:
- Primary: Electric blue (HSL 217 91% 60%)
- Success: Emerald green (HSL 142 71% 45%)
- Warning: Amber (HSL 43 96% 56%)
- Error: Red (HSL 0 84% 60%)
- Background: HSL 222 47% 11%
- Sidebar: HSL 222 47% 8%

## Running Commands

- `pnpm --filter @workspace/api-server run dev` — API server
- `pnpm --filter @workspace/admin-panel run dev` — Frontend
- `pnpm --filter @workspace/db run push` — DB schema push
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate hooks/schemas
