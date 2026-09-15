import { describe, it, expect } from "vitest";
import { validateNarrative } from "../guardrail";
import type { Dataset } from "../types";

// total=2 combos, both in top 3, both improved → ratios are 100/100/0/0.
function ds(): Dataset {
  return {
    intentKind: "business_summary",
    scope: { clientId: 1, clientName: "Acme", businessId: null, businessName: null, aeoPlanId: null, campaignName: null },
    coverage: { earliest: "2026-05-01", latest: "2026-06-30", rowCount: 8, platforms: ["chatgpt"] },
    summary: {
      keywords: [
        { keywordId: 1, keywordText: "a", initialDate: "2026-05-01", initialPosition: 8, currentDate: "2026-06-30", currentPosition: 3, change: 5 },
        { keywordId: 2, keywordText: "b", initialDate: "2026-05-01", initialPosition: 4, currentDate: "2026-06-30", currentPosition: 2, change: 2 },
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

describe("guardrail hardening (post-review)", () => {
  it("flags a fabricated percentage not derivable from real ratios", () => {
    // Real ratios here are only 0 and 100. 73% is invented.
    const r = validateNarrative("Rankings are up 73% this period.", ds());
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.value === "73")).toBe(true);
  });

  it("accepts a genuine percentage that matches a real ratio", () => {
    const d = ds();
    d.summary!.topThreeCount = 1; // 1/2 = 50%
    const r = validateNarrative("Half — 50% — of combos are in the top 3.", d);
    expect(r.ok).toBe(true);
  });

  it("flags a same-month-day date from a DIFFERENT year", () => {
    const r = validateNarrative("A dip occurred on 2019-06-30.", ds());
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.value === "2019-06-30")).toBe(true);
  });

  it("flags a bare month-name date with no matching real month-day", () => {
    const r = validateNarrative("Things spiked on March 6.", ds());
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "date")).toBe(true);
  });

  it("accepts a bare month-name date that matches a real observation", () => {
    // 2026-06-30 exists, so "June 30" (no year) is legitimate.
    const r = validateNarrative("The latest reading was on June 30.", ds());
    expect(r.ok).toBe(true);
  });
});
