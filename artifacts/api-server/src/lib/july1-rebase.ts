/* July-1 campaign baseline (DISPLAY ONLY).
 *
 * Campaign reporting presents every keyword as if it started on 2026-07-01 and
 * has been audited on a strict 14-day cadence since. Keywords whose real audit
 * history already starts on/after the anchor are shown untouched.
 *
 * Nothing here writes to the database — `ranking_reports.date` keeps its real
 * value everywhere. Only the dates rendered in reports/charts are remapped.
 * To revert the whole behavior, stop calling these helpers.
 *
 * Only as many cadence slots exist as have elapsed since the anchor (three as
 * of 2026-07-29: Jul 1, Jul 15, Jul 29), so a keyword with a longer real
 * history shows its most recent N audits mapped onto those slots — oldest kept
 * audit lands on Jul 1. More slots open automatically as time passes.
 */

export const REBASE_ANCHOR = "2026-07-01";
const CADENCE_DAYS = 14;
const DAY_MS = 86_400_000;

/** Noon-UTC epoch for a YYYY-MM-DD — avoids DST/TZ edge shifts. */
const atNoon = (ymd: string): number => Date.parse(`${ymd}T12:00:00Z`);

/** Today's calendar date in ET (the timezone all report dates are anchored to). */
export function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

/** Cadence slot dates from the anchor through the newest slot on/before
 *  `todayYmd`, ascending. Always contains at least the anchor itself. */
export function cadenceSlots(todayYmd: string = todayEt()): string[] {
  const elapsed = Math.floor(
    (atNoon(todayYmd) - atNoon(REBASE_ANCHOR)) / DAY_MS / CADENCE_DAYS,
  );
  const count = Math.max(0, elapsed) + 1;
  return Array.from({ length: count }, (_, i) =>
    new Date(atNoon(REBASE_ANCHOR) + i * CADENCE_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10),
  );
}

/** True when a real audit date predates the anchor, i.e. its keyword's history
 *  needs remapping. */
export const isPreAnchor = (ymd: string | null | undefined): boolean =>
  !!ymd && ymd < REBASE_ANCHOR;

/**
 * Map one keyword's real audit dates onto the display cadence.
 *
 * @param realDates  the keyword's distinct real audit dates (any order)
 * @param slots      cadence slots from `cadenceSlots()`
 * @returns real date → display date, or `null` for audits that fall outside
 *          the available slots and must be hidden from the view. Returns an
 *          identity map when the keyword needs no remapping.
 */
export function buildDisplayDateMap(
  realDates: Iterable<string>,
  slots: string[] = cadenceSlots(),
): Map<string, string | null> {
  const asc = [...new Set(realDates)].sort();
  const map = new Map<string, string | null>();
  if (asc.length === 0) return map;
  if (!isPreAnchor(asc[0])) {
    for (const d of asc) map.set(d, d);
    return map;
  }
  /* Keep the most recent audits that fit the elapsed slots; the oldest kept
     audit becomes the Jul 1 baseline. Older audits are hidden from this view
     (the rows still exist untouched in the database). */
  const kept = asc.slice(-slots.length);
  const dropped = asc.slice(0, asc.length - kept.length);
  for (const d of dropped) map.set(d, null);
  kept.forEach((d, i) => map.set(d, slots[i]));
  return map;
}

/**
 * Build per-keyword display-date maps for a whole result set in one pass.
 *
 * @param rows  anything carrying a keyword id and a real audit date
 * @returns `keywordId → (realDate → displayDate|null)`
 */
export function buildKeywordDateMaps(
  rows: Iterable<{ keywordId: number | null; date: string | null }>,
  slots: string[] = cadenceSlots(),
): Map<number, Map<string, string | null>> {
  const byKeyword = new Map<number, Set<string>>();
  for (const r of rows) {
    if (r.keywordId == null || !r.date) continue;
    const set = byKeyword.get(r.keywordId) ?? new Set<string>();
    set.add(r.date);
    byKeyword.set(r.keywordId, set);
  }
  const out = new Map<number, Map<string, string | null>>();
  for (const [keywordId, dates] of byKeyword) {
    out.set(keywordId, buildDisplayDateMap(dates, slots));
  }
  return out;
}
