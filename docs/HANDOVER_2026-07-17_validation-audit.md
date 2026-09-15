# Session Handover — 2026-07-17 (validation audit · planner · re-run import)

**Project:** /Users/seolocalph/projects/AEOAdmin (+ ~/projects/device-agent)
**Branch:** `feat/lock-all-platforms`
**Continues:** `docs/HANDOVER_2026-07-17_rankings-validation.md`

> **NEXT SESSION HEADLINE:** verify the remaining unscanned top-3 rows with
> `/aeo-validate-screenshots` — Claude opens each screenshot and writes the verdict
> as it goes. See [Next Action](#next-action).

---

## Completed This Session

### Deployed (App Runner `START_DEPLOYMENT SUCCEEDED`, verified against prod)

| change                                                          | verified how                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `desc(id)` tiebreak on `GET /api/ranking-reports`               | page overlap **134 → 0**; sweep **22,520/22,520 distinct** |
| `screenshotRankVisible` accepted on `POST /api/ranking-reports` | in image; absent ≠ null (upsert-safe)                      |
| `businesses.also_known_as` + validator alias support            | 6 aliases live; Rick's verified via alias                  |

### Data fixed in prod

- **110 businesses** geo-backfilled from `published_address` / plan `search_address`. 17 correctly refused (multi-city, tests, unparseable).
- **6 DBA aliases** set, each corroborated by the business's **own website domain**, not model prose.
- **Screenshots linked**: Jul-17 0→21/21, Jul-15 0→224/285, David Kuhs' 8 wiped URLs restored.
- **94 re-run rows overwritten** in place (backup: `~/Desktop/Rankings/BACKUP_before_rerun_overwrite_2026-07-17.csv`). 66 ranks changed.
- **Verdicts written**: 13 verified + 2 rejected (by eye), 34 marked false (deterministic), 20 earlier (Orian/David).

---

## Key Decisions

- **KEEP the verifier.** Retiring it was the original plan; the evidence killed that. It catches real fabrications the prompt cannot stop.
- **Do NOT change the ranking prompt.** It was already hardened (06-26 rank-honesty, 06-28 do-not-pad, 07-03 consistency + `X=Y` escape hatch). Prompts sent on **every** sampled date already contained the CONSISTENCY clause — models ignore it. That lever is spent; enforce in code instead.
- **Never use `scripts/import-audit-logs-api.mjs` on a re-run CSV.** It has no `status`/`timestamp` column and `toRankingStatus(null) → null` — it would write `status=NULL` on 94 live rows and erase them from every report (everything filters `status='success'`). Use `scripts/apply-rerun-overwrite.mjs` (targeted UPDATE by `report_id`).
- **Reset verdict to NULL on any screenshot replacement.** A stored verdict describes the OLD capture; leaving it froze David Kuhs' rows at `false` forever (scanner only revisits `null`).
- **Backdating accepted** (operator-confirmed): re-run measured today, written onto the original row's date. Replaces a fabricated rank with a real one.

---

## Findings (measured, not sampled)

### All 4,289 rejected top-3 rows adjudicated — full population, no extrapolation

| cause                                           | rows      | share |
| ----------------------------------------------- | --------- | ----- |
| **capture_scrolled** — list not in frame        | **2,164** | 50.5% |
| **fabricated** — absent from list, claims top-3 | **911**   | 21.2% |
| skipped_platform (Gemini — gate can't judge)    | 910       | 21.2% |
| unreadable                                      | 144       | 3.4%  |
| **legit** — validator was WRONG                 | **132**   | 3.1%  |
| inconsistent                                    | 26        | 0.6%  |

Method: OCR each S3 screenshot → same list-vs-`[RANK]` check the dispatch gate uses.
**Validated 20/20 against rows adjudicated by eye.** Script: `~/projects/device-agent/audit_rejected_top3.py`.

### The capture bug was a May–June regression — ALREADY FIXED

Scrolled as a share of **all** chatgpt/perplexity top-3 rows:

| month   | rate     |
| ------- | -------- |
| 2026-04 | 7%       |
| 2026-05 | **44%**  |
| 2026-06 | **42%**  |
| 2026-07 | **0.4%** |

Cause + fix both in `97a4260` (2026-07-03, "v67 prompt/zoom"): _"over-scrolling to the rank line alone pushes #1 off-top"_ → pinch-zoom-out so list + `[RANK]` fit one shot. The 2,164 are legacy debris; normal 14-day cadence re-measures them.

### The re-run settled the fabrication question

All 22 previously-fabricated rows resolved: **13 → honest ranks** (Autoglass 1→8, Carrot 1→9, DaVisse 1→8, Citedlogic 3→15), **9 → genuine provable top-3** (Leo Lapuerta real #2, Ocean View real #1, HazWash real #1). **Zero stayed fabricated.** Fabrications are per-capture noise; a fresh capture resolves them either way.

---

## Traps found this session

- **`_rank_inconsistent` fail-opens.** Returns `False` when it can't parse. Its silence is ignorance, not verification — do not read a `False` as "verified".
- **The gate only caught the narrow case.** It flagged "listed at n but RANK says m"; it ignored "absent from list but claims top-3" (the 21% case). Now extended — see Files Modified.
- **`text_ranking` is NULL on every row** — prod stores no answer text. Audits need OCR from S3, or the CSV's `response_text`.
- **`aws s3 cp` per file is ~2.5s** (the CLI is Python). Use `boto3` (installed) — 0.6/s → 6/s.
- **CSV `prompt` column truncates at 1000 chars.**
- **`scan-secrets.sh` false-positives on prose**: a comment containing `token: "..."` is blocked. Hook files are protected from edits (correctly) — the operator must change it.
- **Seo Local's rows measure Lehi, not the campaign's city** (Miami). Multi-city business, runner falls back to HQ address. Real ranks, wrong market.

---

## Files Modified (ALL UNCOMMITTED — prod runs 4 of them)

### AEOAdmin

| path                                                 | change                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `artifacts/api-server/src/routes/ranking-reports.ts` | `desc(id)` tiebreak; `screenshotRankVisible` on POST **[DEPLOYED]** |
| `artifacts/api-server/src/lib/vision-validate.ts`    | alias support in the prompt **[DEPLOYED]**                          |
| `artifacts/api-server/src/routes/screenshot-scan.ts` | selects + passes `businessAlsoKnownAs` **[DEPLOYED]**               |
| `lib/db/src/schema/businesses.ts`                    | `alsoKnownAs` column **[DEPLOYED + raw ALTER applied]**             |
| `scripts/upload-screenshots.mjs`                     | **new** — reusable; matches (kw,platform)+rank, NOT the CSV date    |
| `scripts/fix-business-geo.mjs`                       | **new** — geo backfill; refuses multi-city + unparseable            |
| `scripts/apply-rerun-overwrite.mjs`                  | **new** — targeted overwrite by `report_id`                         |

### device-agent

| path                      | change                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `build_ranking_dueset.py` | due-set from `ranking_reports` max(date) per (kw,platform); Bearer auth; verified pagination; fails loud                 |
| `run_ranking_auto.sh`     | exports `READ_API_TOKEN`                                                                                                 |
| `audit_dispatch_http.py`  | `_rank_inconsistent` now also rejects **absent-but-claims-top-3**; alias-aware; only judges absence when the list parsed |
| `run_ranking.py`          | passes `alsoKnownAs` into the job record                                                                                 |
| `audit_rejected_top3.py`  | **new** — full-population adjudicator (boto3 + OCR + gate)                                                               |

---

## Open Items

1. **Verify the unscanned top-3 rows** — see [Next Action](#next-action). **54** rows have proof + no verdict; the admin "Scan screenshots" button showed **311** (it counts all unscanned, incl. below-top-3 which are NOT gated). 423 top-3 rows are `null` overall; only 54 have an S3 screenshot to judge.
2. **Audit the 3,147 rows marked `true`** — NEVER DONE, and it's the direction that reaches clients. A false positive = fabricated #1 in an inbox. Same deterministic method, no vision model. **Highest value after #1.**
3. **Commit** — 10 files, two repos, 4 already in prod.
4. **`GHL_SYNC_STRICT=1`** — currently unset, so `null` auto-passes the SQL gate. (Headlines are already safe: `sales.ts:444` requires `true` even in lenient mode. Strict mainly removes `null` before-context.)
5. **39 locks rest on top-3 evidence that was entirely rejected** — retired from rotation on wins that likely never happened.
6. **910 Gemini rejections unjudged** — the gate skips the platform (logged-out chat wipes the answer).
7. **81 duplicate `(keyword_text, business_id)` groups** — importer resolver needs `ORDER BY k.id`.
8. **Clients 246 vs 259** — "Mary and Russell Thornton" vs "Mary - Russ Thornton", same people, split records. 64/95 of the re-run list was Thornton.
9. **Seo Local / Signal AEO / Citedlogic multi-city** — `business.city` can't represent them; location matching should use the campaign's `search_address`.
10. **Ocean View invisible despite a verified #1** — its before-row (06-21, rank 2) is `false`, gets filtered, so no improvement story.

---

## Next Action

> **Verify the 54 unscanned top-3 rows with `/aeo-validate-screenshots`.**
> Claude opens each screenshot with the Read tool and writes the verdict **as it checks** —
> transactional UPDATE, count assertion, never a verdict for an image not opened.
>
> Pull the target set:
>
> ```sql
> SELECT r.id, r.date, r.client_id, b.name biz, b.also_known_as aka, b.city, b.state,
>        k.keyword_text, r.platform, r.ranking_position, r.ranking_total, r.screenshot_url
>   FROM ranking_reports r
>   JOIN businesses b ON b.id = r.business_id
>   JOIN keywords k ON k.id = r.keyword_id
>  WHERE r.status='success' AND r.ranking_position <= 3
>    AND r.screenshot_rank_visible IS NULL
>    AND r.screenshot_url LIKE 's3://%';
> ```
>
> **Triage first, then look.** `~/projects/device-agent/audit_rejected_top3.py` (writes
> `/tmp/rejected_all.json` → reads it) classifies all of them in ~30s. Last run on the 88:
> **46 legit · 33 fabricated · 1 inconsistent · 8 unjudgeable**. Mark the `fabricated` /
> `inconsistent` ones `false` without opening (safe direction, scored 10/10 vs eye).
> **Open every `legit` candidate by eye before writing `true`** — the checker CANNOT judge
> location and would have passed East Lyme (right name, wrong branch: Flanders Rd vs the
> tracked Old Lyme practice).
>
> The two checkers have opposite blind spots — mine can't see location, the deployed
> scanner can (`locationMatches`). Use both; don't let either stand alone.

---

## Session Opener (paste at start of next session)

```
Continuing AEOAdmin. Last session: deployed + VERIFIED against prod the pagination
tiebreak (page overlap 134->0, sweep now 22,520/22,520 distinct — planner unblocked),
screenshotRankVisible on POST, and business alias support. Fixed geo on 110 businesses,
set 6 DBA aliases (each corroborated by the client's own website domain), relinked all
Jul-15/17 screenshots (the importer never uploaded them — proof existed only on the
laptop), and overwrote 94 re-run rows in place (backup on Desktop).

Adjudicated ALL 4,289 rejected top-3 rows — full population, not a sample, validated
20/20 against rows I opened by eye. Result overturned the earlier story: capture failure
is 50.5% (NOT ~1-in-30), fabrication 21.2%, and the validator is only ~3% wrong. The
capture bug was a May-June regression ALREADY FIXED by 97a4260 on 07-03 (44% -> 0.4%).
Do NOT change the ranking prompt — it was hardened on 07-03 and the models ignore it;
enforcement moved into audit_dispatch_http.py's gate instead. KEEP the verifier.

Start by reading docs/HANDOVER_2026-07-17_validation-audit.md, then verify the 54
unscanned top-3 rows (admin shows "Scan screenshots 311" — that count includes
below-top-3 rows, which aren't gated) using /aeo-validate-screenshots: triage with
audit_rejected_top3.py, mark the fabricated ones false, and OPEN every legit candidate
by eye before writing true — the checker can't judge location.

Nothing is committed: 10 files across AEOAdmin + device-agent, 4 already running in prod.
```
