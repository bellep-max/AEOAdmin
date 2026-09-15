/**
 * Narrative guardrail. The LLM writes prose over data we fetched; this module
 * proves the prose didn't invent anything. It extracts every number and date
 * from the narrative and checks each against an allowlist derived ENTIRELY from
 * the `Dataset`. Anything not traceable to the data is a violation.
 *
 * Pure and fully unit-tested — the anti-hallucination acceptance criterion is
 * asserted directly against `validateNarrative`.
 */
import type { Dataset, GuardrailResult, GuardrailViolation } from "./types";

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

/**
 * Structural numbers that are product vocabulary, not data claims: the "top 3"
 * and "top 10" thresholds, and the count of platforms (always 3). Allowing
 * these avoids false positives without weakening claims about actual ranks.
 */
const STRUCTURAL_NUMBERS = new Set<number>([3, 10]);

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Allowlist stores only the full YYYY-MM-DD. A bare MM-DD from the narrative
 *  is matched separately (in dateAllowed) against real full dates, so it can
 *  only pass when a genuine observation shares that exact month-day. */
function dateForms(iso: string): string[] {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? [iso] : [];
}

/** Extract distinct number and date tokens from narrative text. */
export function extractFigures(text: string): {
  numbers: number[];
  dates: string[];
} {
  const dateSet = new Set<string>();

  // ISO dates first, and remove them so their digits aren't re-read as numbers.
  let scratch = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y, mo, d) => {
    dateSet.add(`${y}-${mo}-${d}`);
    return " ";
  });

  // Month-name dates: "March 5, 2026", "Mar 5 2026", "March 5".
  const monthNameRe =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
  scratch = scratch.replace(
    monthNameRe,
    (_m, mon: string, day: string, year?: string) => {
      const mi = MONTHS[mon.toLowerCase()];
      if (mi) {
        const md = `${pad2(mi)}-${pad2(Number(day))}`;
        dateSet.add(year ? `${year}-${md}` : md);
      }
      return " ";
    },
  );

  // Numbers: integers/decimals, optionally prefixed by # or suffixed by % or an
  // ordinal. Year-like tokens already removed as part of dates above.
  const numbers = new Set<number>();
  const numRe = /#?(\d+(?:\.\d+)?)(%)?(?:st|nd|rd|th)?/gi;
  let nm: RegExpExecArray | null;
  while ((nm = numRe.exec(scratch)) !== null) {
    const val = Number(nm[1]);
    if (!Number.isNaN(val)) numbers.add(val);
  }

  return { numbers: [...numbers], dates: [...dateSet] };
}

interface Allowlist {
  numbers: Set<number>;
  /** 1-decimal-rounded numbers, checked with tolerance. */
  approx: number[];
  dates: Set<string>;
}

function addNumber(set: Set<number>, n: number | null | undefined): void {
  if (n === null || n === undefined || Number.isNaN(n)) return;
  set.add(n);
  set.add(Math.round(n));
}

/** Build the numeric + date allowlist from the dataset. Only values derivable
 *  from fetched data (plus documented structural numbers) are permitted. */
export function buildAllowlist(dataset: Dataset): Allowlist {
  const numbers = new Set<number>(STRUCTURAL_NUMBERS);
  const approx: number[] = [];
  const dates = new Set<string>();

  addNumber(numbers, dataset.coverage.rowCount);
  for (const d of [dataset.coverage.earliest, dataset.coverage.latest]) {
    if (d) for (const f of dateForms(d)) dates.add(f);
  }

  const pushPositionsAndChange = (
    rows: {
      initialPosition: number | null;
      currentPosition: number | null;
      change: number | null;
      initialDate: string | null;
      currentDate: string | null;
    }[],
  ): void => {
    for (const r of rows) {
      addNumber(numbers, r.initialPosition);
      addNumber(numbers, r.currentPosition);
      if (r.change !== null) {
        addNumber(numbers, r.change);
        addNumber(numbers, Math.abs(r.change));
      }
      for (const d of [r.initialDate, r.currentDate]) {
        if (d) for (const f of dateForms(d)) dates.add(f);
      }
    }
  };

  const total = dataset.summary?.totalKeywords ?? 0;
  // Percentages go ONLY into the tight-tolerance approx list — never the
  // exact-match number set — so a rounded ratio can't silently "verify" an
  // unrelated fabricated integer.
  const addPct = (part: number): void => {
    if (total > 0) approx.push((part / total) * 100);
  };

  if (dataset.summary) {
    const s = dataset.summary;
    for (const c of [
      s.totalKeywords,
      s.topThreeCount,
      s.improvedCount,
      s.declinedCount,
      s.steadyCount,
    ]) {
      addNumber(numbers, c);
    }
    if (s.avgCurrentPosition !== null) {
      numbers.add(Math.round(s.avgCurrentPosition));
      approx.push(s.avgCurrentPosition);
    }
    addPct(s.topThreeCount);
    addPct(s.improvedCount);
    addPct(s.declinedCount);
    addPct(s.steadyCount);
    pushPositionsAndChange(s.keywords);
  }

  if (dataset.series) {
    for (const row of dataset.series) {
      addNumber(numbers, row.rankingPosition);
      for (const f of dateForms(row.date)) dates.add(f);
    }
  }

  if (dataset.platformStats) {
    for (const p of dataset.platformStats) {
      addNumber(numbers, p.count);
      addNumber(numbers, p.topThreeCount);
      if (p.avgPosition !== null) {
        numbers.add(Math.round(p.avgPosition));
        approx.push(p.avgPosition);
      }
      addPct(p.count);
    }
  }

  if (dataset.movers) pushPositionsAndChange(dataset.movers);
  if (dataset.keywordList) addNumber(numbers, dataset.keywordList.length);

  return { numbers, approx, dates };
}

const APPROX_TOLERANCE = 0.1;

function numberAllowed(value: number, allow: Allowlist): boolean {
  if (allow.numbers.has(value)) return true;
  return allow.approx.some((a) => Math.abs(a - value) <= APPROX_TOLERANCE);
}

function dateAllowed(token: string, allow: Allowlist): boolean {
  if (allow.dates.has(token)) return true;
  // A bare MM-DD in the narrative matches any allowlisted full date sharing it.
  if (/^\d{2}-\d{2}$/.test(token)) {
    for (const d of allow.dates) if (d.endsWith(token)) return true;
  }
  return false;
}

/**
 * Validate a narrative against the dataset. `ok` is true only when every number
 * and date it contains traces back to fetched data. Never throws.
 */
export function validateNarrative(
  text: string,
  dataset: Dataset,
): GuardrailResult {
  const allow = buildAllowlist(dataset);
  const { numbers, dates } = extractFigures(text);
  const violations: GuardrailViolation[] = [];

  for (const n of numbers) {
    if (!numberAllowed(n, allow)) {
      violations.push({ value: String(n), kind: "number" });
    }
  }
  for (const d of dates) {
    if (!dateAllowed(d, allow)) {
      violations.push({ value: d, kind: "date" });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    checkedCount: numbers.length + dates.length,
  };
}
