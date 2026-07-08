/**
 * Narrative prompt construction. We hand the LLM a COMPACT context object
 * containing only figures already derivable from the dataset (and thus on the
 * guardrail allowlist), plus strict instructions to use nothing else. The
 * visuals are rendered separately by code — the LLM only writes the prose.
 */
import type { Dataset, Intent } from "./types";

/** Small, guardrail-aligned view of the dataset for the LLM. Never the raw
 *  5000-row payload — just the aggregates the answer should describe. */
export function buildNarrativeContext(
  dataset: Dataset,
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    business: dataset.scope.businessName
      ? `${dataset.scope.clientName} → ${dataset.scope.businessName}`
      : dataset.scope.clientName,
    dataCoverage: {
      earliest: dataset.coverage.earliest,
      latest: dataset.coverage.latest,
      observations: dataset.coverage.rowCount,
      platforms: dataset.coverage.platforms,
    },
    isEmpty: dataset.isEmpty,
  };

  if (dataset.summary) {
    const s = dataset.summary;
    ctx.summary = {
      keywordPlatformCombos: s.totalKeywords,
      inTopThree: s.topThreeCount,
      improved: s.improvedCount,
      declined: s.declinedCount,
      steady: s.steadyCount,
      averageCurrentPosition: s.avgCurrentPosition,
    };
  }
  if (dataset.platformStats) {
    ctx.platforms = dataset.platformStats.map((p) => ({
      platform: p.platform,
      averagePosition: p.avgPosition,
      keywordCombos: p.count,
      inTopThree: p.topThreeCount,
    }));
  }
  if (dataset.movers) {
    ctx.biggestMovers = dataset.movers.slice(0, 6).map((m) => ({
      keyword: m.keywordText,
      from: m.initialPosition,
      to: m.currentPosition,
      change: m.change,
    }));
  }
  if (dataset.series) {
    const s = dataset.series;
    const positions = s
      .map((r) => r.rankingPosition)
      .filter((p): p is number => p !== null);
    ctx.trend = {
      keyword: s[0]?.keyword ?? null,
      points: s.length,
      firstDate: s[0]?.date ?? null,
      lastDate: s[s.length - 1]?.date ?? null,
      firstPosition: s[0]?.rankingPosition ?? null,
      lastPosition: s[s.length - 1]?.rankingPosition ?? null,
      best: positions.length ? Math.min(...positions) : null,
      worst: positions.length ? Math.max(...positions) : null,
    };
  }
  if (dataset.keywordList) {
    ctx.keywordCount = dataset.keywordList.length;
    ctx.activeKeywordCount = dataset.keywordList.filter(
      (k) => k.isActive,
    ).length;
  }
  return ctx;
}

const NARRATIVE_SYSTEM = [
  "You are an SEO ranking analytics assistant. You explain ranking data to a",
  "user in clear, friendly prose. A chart or cards are shown alongside your",
  "text, so do NOT render tables — just narrate.",
  "",
  "ABSOLUTE RULES:",
  "- Use ONLY numbers and dates that appear in the DATA JSON you are given.",
  "- Never invent, estimate, extrapolate, or round to a value not present.",
  "- Always state the actual date coverage (earliest to latest) the data spans.",
  "- Lower ranking position numbers are better (#1 is best).",
  "- If isEmpty is true, say plainly there is no ranking data for this",
  "  business/timeframe yet, and suggest nothing fabricated.",
  "- Keep it to 2–5 short sentences or a few bullets. Markdown allowed.",
].join("\n");

export function buildNarrativeMessages(
  dataset: Dataset,
  intent: Intent,
  userText: string,
): { role: "system" | "user"; content: string }[] {
  const context = buildNarrativeContext(dataset);
  return [
    { role: "system", content: NARRATIVE_SYSTEM },
    {
      role: "user",
      content: [
        `The user asked: "${userText}"`,
        `Intent: ${intent.kind}.`,
        "DATA (the only source of truth — use nothing outside it):",
        "```json",
        JSON.stringify(context, null, 2),
        "```",
        "Write the explanation now.",
      ].join("\n"),
    },
  ];
}
