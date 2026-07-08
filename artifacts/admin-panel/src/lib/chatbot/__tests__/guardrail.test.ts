import { describe, it, expect } from "vitest";
import {
  extractFigures,
  buildAllowlist,
  validateNarrative,
} from "../guardrail";
import type { Dataset } from "../types";

function summaryDataset(): Dataset {
  return {
    intentKind: "business_summary",
    scope: {
      clientId: 1,
      clientName: "Acme",
      businessId: null,
      businessName: null,
    },
    coverage: {
      earliest: "2026-05-01",
      latest: "2026-06-30",
      rowCount: 42,
      platforms: ["chatgpt", "gemini"],
    },
    summary: {
      keywords: [
        {
          keywordId: 1,
          keywordText: "best dentist · chatgpt",
          initialDate: "2026-05-01",
          initialPosition: 8,
          currentDate: "2026-06-30",
          currentPosition: 3,
          change: 5,
        },
        {
          keywordId: 2,
          keywordText: "emergency dentist · gemini",
          initialDate: "2026-05-01",
          initialPosition: 4,
          currentDate: "2026-06-30",
          currentPosition: 2,
          change: 2,
        },
      ],
      totalKeywords: 2,
      topThreeCount: 2,
      improvedCount: 2,
      declinedCount: 0,
      steadyCount: 0,
      avgCurrentPosition: 2.5,
    },
    isEmpty: false,
  };
}

describe("extractFigures", () => {
  it("pulls ISO dates and does not re-read their digits as numbers", () => {
    const { numbers, dates } = extractFigures("On 2026-05-01 the rank was 8.");
    expect(dates).toContain("2026-05-01");
    expect(numbers).toContain(8);
    expect(numbers).not.toContain(2026);
  });

  it("reads month-name dates with and without a year", () => {
    const withYear = extractFigures("Since May 1, 2026 things improved.");
    expect(withYear.dates).toContain("2026-05-01");
    const noYear = extractFigures("Back on June 30 it peaked.");
    expect(noYear.dates).toContain("06-30");
  });

  it("handles #ranks, percentages, and ordinals", () => {
    const { numbers } = extractFigures("Hit #3, up 40% and 2nd overall.");
    expect(numbers).toEqual(expect.arrayContaining([3, 40, 2]));
  });
});

describe("buildAllowlist", () => {
  it("includes real positions, counts, dates, and derived deltas", () => {
    const allow = buildAllowlist(summaryDataset());
    expect(allow.numbers.has(8)).toBe(true); // initial position
    expect(allow.numbers.has(3)).toBe(true); // current position
    expect(allow.numbers.has(5)).toBe(true); // change (delta)
    expect(allow.numbers.has(2)).toBe(true); // count / position
    expect(allow.dates.has("2026-05-01")).toBe(true);
    expect(allow.dates.has("2026-06-30")).toBe(true);
  });
});

describe("validateNarrative — the anti-hallucination gate", () => {
  it("passes a narrative that only uses real figures", () => {
    const text =
      "Across 2026-05-01 to 2026-06-30, both keyword-platform combos reached the top 3. 'best dentist' climbed from #8 to #3.";
    const result = validateNarrative(text, summaryDataset());
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("FLAGS a fabricated ranking number not present in the data", () => {
    // 47 appears nowhere in the dataset.
    const text = "This keyword is now ranked #47 nationally.";
    const result = validateNarrative(text, summaryDataset());
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([{ value: "47", kind: "number" }]),
    );
  });

  it("FLAGS a fabricated date outside the data coverage", () => {
    const text =
      "Coverage spans 2026-05-01 to 2026-06-30, and we saw a spike on 2024-01-15.";
    const result = validateNarrative(text, summaryDataset());
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([{ value: "2024-01-15", kind: "date" }]),
    );
  });

  it("FLAGS an invented click/traffic figure (data has no such metric)", () => {
    const text = "These rankings drove 1200 clicks last month.";
    const result = validateNarrative(text, summaryDataset());
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.value === "1200")).toBe(true);
  });

  it("allows structural 'top 3' / 'top 10' vocabulary", () => {
    const text = "We track top 3 and top 10 placements closely.";
    const result = validateNarrative(text, summaryDataset());
    expect(result.ok).toBe(true);
  });

  it("allows the rounded average to be described with one decimal", () => {
    const text = "The average current position is 2.5.";
    const result = validateNarrative(text, summaryDataset());
    expect(result.ok).toBe(true);
  });

  it("reports how many figures were checked", () => {
    const text = "From 2026-05-01 the rank moved to #3.";
    const result = validateNarrative(text, summaryDataset());
    expect(result.checkedCount).toBeGreaterThan(0);
  });
});
