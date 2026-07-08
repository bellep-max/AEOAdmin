# Chatbot Page — Architecture Note

An admin/sales/account-manager user selects a client (and optionally a business),
then holds a multi-turn, ChatGPT-style conversation about that entity's
AI-search keyword rankings. Every analytical answer pairs a **narrative** with
**visuals**, both grounded strictly in real, fetched data.

## Data flow: query → route → fetch → validate → render

```
user message
   │
   ▼
[1] Intent routing  ── LLM (DeepSeek V3, JSON mode) classifies into one intent
   │                    + params (keyword / platform / timeframe) + confidence
   │                    lib/chatbot/intents.ts · llm-client.callJsonCompletion
   │
   ├─ ambiguous / low-confidence / missing entity ─┐
   │                                               ▼
   │                                    [2] Clarification UI
   │                                        chips / entity / timeframe presets
   │                                        components/chatbot/ClarifyPanel.tsx
   │                                        (user picks → turn re-runs resolved)
   │
   ├─ unsupported (data doesn't exist) ─▶ honest refusal, no data, no visuals
   │
   ▼
[3] Deterministic fetch  ── real scoped endpoints, clientId/businessId params
   │                        /api/ranking-reports, /api/keywords
   │                        lib/chatbot/data.ts (pure aggregation fns)
   │                        → Dataset { coverage, summary, series, platformStats, movers }
   │
   ├─ ambiguous keyword (multiple matches) ─▶ back to [2] entity clarification
   ├─ empty ─▶ canned "no data for this range yet" (no LLM call)
   │
   ▼
[4] Visuals (CODE, not LLM)  ── KPI cards, trend line, platform bars, movers,
   │                            keyword table — read straight from Dataset
   │                            components/chatbot/ChatVisuals.tsx
   │
   ▼
[5] Narrative  ── LLM streams prose over a COMPACT, allowlist-aligned view of
   │              the Dataset; system prompt forbids inventing figures
   │              lib/chatbot/narrative.ts · llm-client.streamNarrative
   │
   ▼
[6] Guardrail  ── extract every number/date from the narrative; verify each
                  against an allowlist derived ENTIRELY from the Dataset.
                  Untraceable figures are flagged in the UI.
                  lib/chatbot/guardrail.ts
```

## Why this is fabrication-proof

- **Charts/cards never pass through the LLM.** They are rendered by code from
  the `Dataset`, so a visual literally cannot show a number that isn't in the
  fetched data.
- **The LLM only classifies and narrates.** DeepSeek V3 has no tool-calling in
  this codebase, so we never let it "decide" values.
- **The narrative is validated.** `validateNarrative()` returns `ok: false` with
  the offending figures whenever the prose contains a number or date not
  derivable from the dataset (raw positions, counts, rounded averages, per-keyword
  deltas, computed percentages, and coverage dates — plus the structural
  `top 3` / `top 10` vocabulary).
- **Date coverage is always surfaced** (`coverage.earliest → latest`), so answers
  state exactly what span the numbers are drawn from.

## Scope & access

- The page is reachable by every authenticated admin-panel role. The backend
  proxy `POST /api/llm/chatbot/stream` is gated by `requireSalesAllowed`.
- The client/business selectors are populated by `/api/clients` and
  `/api/businesses`, which are already role-scoped server-side — a user can only
  see and query entities in their slice. All data fetches carry `clientId` /
  `businessId` and hit the same scoped endpoints, so scoping is enforced by the
  server, not the client.
- Switching the selected business clears the transcript so one conversation
  never mixes data from two entities.

## Backend

`POST /api/llm/chatbot/stream` (`artifacts/api-server/src/routes/llm.ts`) is a
thin authenticated forwarder to DeepSeek that keeps the API key server-side. It
accepts `{ messages, stream?, response_format? }`; only a `json_object`
`response_format` is whitelisted for passthrough. Two call shapes ride it:
non-streaming JSON for intent routing, and SSE for the narrative.

## Files

| Concern                                | File                                  |
| -------------------------------------- | ------------------------------------- |
| Types                                  | `lib/chatbot/types.ts`                |
| Intent routing + prompt + pure parser  | `lib/chatbot/intents.ts`              |
| Guardrail (extract/allowlist/validate) | `lib/chatbot/guardrail.ts`            |
| Data fetch + pure aggregations         | `lib/chatbot/data.ts`                 |
| Narrative prompt + compact context     | `lib/chatbot/narrative.ts`            |
| DeepSeek proxy client                  | `lib/chatbot/llm-client.ts`           |
| Orchestrator hook                      | `lib/chatbot/useChatbot.ts`           |
| Visuals (code-built)                   | `components/chatbot/ChatVisuals.tsx`  |
| Scope selector                         | `components/chatbot/ScopeBar.tsx`     |
| Clarification UI                       | `components/chatbot/ClarifyPanel.tsx` |
| Transcript + guardrail badge           | `components/chatbot/MessageList.tsx`  |
| Page                                   | `pages/chatbot.tsx`                   |
| Backend proxy                          | `../api-server/src/routes/llm.ts`     |

## Tests

Run: `pnpm --filter @workspace/admin-panel test` (Vitest) and
`pnpm --filter @workspace/admin-panel test:e2e` (Playwright).

- **Unit** — `intents.test.ts` (12), `guardrail.test.ts` (11, incl. adversarial
  fabricated number/date/clicks), `guardrail-hardening.test.ts` (5, invented
  percentage / wrong-year / bare-month-day date all flagged), `data.test.ts`
  (16, aggregations + timeframe + ambiguity + scoping).
- **Component** — `components/chatbot/__tests__/visuals.test.tsx` (6, visuals
  render from data; guardrail warning/ok badges; clarification selector).
- **Integration** — `useChatbot.test.tsx` (7, full pipeline: summary→dataset+
  guardrail, ambiguous→clarify, unsupported→honest, empty→canned, fabricated
  figure→flagged, scope switch→reset) + `useChatbot-abort.test.tsx` (1, an
  in-flight narrative is aborted on scope-switch and never written into the new
  business's conversation).
- **E2E (Playwright, fully network-mocked)** — `e2e/chatbot.spec.ts` (3, real
  browser: summary→narrative+visuals+verified guardrail, ambiguous→clarification,
  switch business→reset).

Latest run: **58 Vitest + 3 Playwright = 61 passing.** Typecheck and production
build both clean.

## Data limitations discovered during research (the chatbot refuses these)

These are **not** in the schema, so the intent router returns `unsupported` with
a reason instead of guessing:

- Clicks / traffic / conversions — no click tracking exists.
- Revenue / ROI / cost per rank — no financial outcome data.
- Real-time / live rankings — data only exists after an audit run completes.
- Rankings on an arbitrary past date, or across gaps where runs failed — history
  is sparse, not continuous; there is no backfill.
- Per-result geography — only the proxy's spoofed location is stored.
- AI model version behind a ranking — not recorded on ranking rows.
- Competitor rankings — only the selected client's own tracked keywords exist.

Additional grounding facts baked into the pipeline: platform values are always
lowercase (`chatgpt`/`gemini`/`perplexity`); status is `success`/`error`; dates
are ET `YYYY-MM-DD`; `rankingPosition` is null when the business wasn't found
(treated as "not ranked", never as 0).
