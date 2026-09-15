# Screenshot adjudication pipeline (macOS OCR → DeepSeek)

Decides `ranking_reports.screenshot_rank_visible` for **top-3** captures — the flag
that gates client-facing sales proof (`sales.ts`). A false positive puts a
fabricated #1 in a client's inbox, so the bar is: only `true` when the business is
genuinely a numbered list entry, at its stored rank, in the campaign's market.

Replaces per-image human review. Validated against 74 rows adjudicated by eye:
**95% agreement, 0 fabrications passed as genuine** (misses are the safe direction).

## Why not just OCR + regex, or the deployed 8B vision model

- **tesseract fails** on these captures (map/place-card widgets, collapsed answer
  cards, wrapped names). macOS Vision reads them (1195/1195 non-empty in 2026-07).
- **A regex gate over good OCR still fails**: names wrap across the "1." marker
  ("Worcester's … Trailers &" / "1. Pet Feeds"), and `[RANK]` renders above or
  below the list depending on platform. DeepSeek _reasons_ over the text instead.
- **The deployed `qwen3-vl-8b`** (`vision-validate.ts`) is unreliable in both
  directions; this is the cheaper, more accurate second opinion. ~$0.20 / 1200 rows.

DeepSeek's hosted API is text-only — fine here, because macOS already did the OCR.

## Run

```bash
# one-time: build the macOS Vision OCR binary
swiftc -O ocr.swift -o ocr

export DATABASE_URL=...            # aeo-admin/prod
export DEEPSEEK_API_KEY=...        # aeo-admin/prod
cd scripts/adjudicate-screenshots

node pull-rows.mjs --out=rows.json                    # 1. unscanned top-3 -> rows.json
AWS_PROFILE=aeo-admin python3 ocr.py --rows=rows.json --out=ocr.json   # 2. S3 + macOS OCR
node judge.mjs --rows=rows.json --ocr=ocr.json --out=verdicts.json     # 3. dry run
node judge.mjs --rows=rows.json --ocr=ocr.json --out=verdicts.json --apply   # 3. write
```

All three steps are **resumable** — re-run to continue where they stopped.

## The three checks (all must hold for `true`)

1. **presence** — a real numbered list entry (alias/wrapped names count), not
   narrative prose, not a per-item `[RANK]` checklist, not scrolled off-frame.
2. **position** — listed position == stored rank. A better-than-stored read is
   never trusted (no upgrade).
3. **location** — the capture's own search city == the campaign's `search_address`
   market. Catches the multi-city trap (Seo Local ranked #1 — but searched Lehi,
   not Miami; those are suppressed).

Unreadable/errored rows are left `NULL`, never guessed.

## Known limits

- A genuine win listed **only** under an alias not in `businesses.also_known_as`
  is held `false` (safe). Set the alias (corroborated by the business's own domain)
  and re-run to recover it.
- `deepseek-chat` is the judge; swap `OPENROUTER_API_KEY` + a vision model into
  `judge.mjs` if you ever want to skip the OCR step.
