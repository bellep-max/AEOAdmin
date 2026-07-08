/**
 * Narrative prompt construction. We hand the LLM a COMPACT context object
 * containing only figures already derivable from the dataset (and thus on the
 * guardrail allowlist), plus strict instructions to use nothing else. The
 * visuals are rendered separately by code — the LLM only writes the prose.
 */
import type { Dataset, Intent } from "./types";
import { scopeFocus } from "./types";

/** Small, guardrail-aligned view of the dataset for the LLM. Never the raw
 *  5000-row payload — just the aggregates the answer should describe. */
export function buildNarrativeContext(
  dataset: Dataset,
): Record<string, unknown> {
  const focus = scopeFocus(dataset.scope);
  const ctx: Record<string, unknown> = {
    // The exact entity in focus, so the narrative names the right thing: the
    // campaign if one is selected, else the business, else the client.
    focus: { level: focus.level, name: focus.name },
    client: dataset.scope.clientName,
    business: dataset.scope.businessName,
    campaign: dataset.scope.campaignName,
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
  "You are a warm, conversational analytics partner who helps people understand",
  "how their business shows up in AI search (ChatGPT, Gemini, Perplexity). You",
  "talk like a helpful human colleague, not a report generator. Charts and cards",
  "are shown alongside your text, so do NOT render tables — just talk it through.",
  "",
  "NAME WHAT'S IN FOCUS:",
  "- The DATA has a `focus` object with a `level` (client, business, or campaign)",
  "  and a `name`. Open by naming THAT specific thing, by name, conversationally.",
  "  If the user picked a campaign, talk about that campaign; if a business, that",
  "  business; if only the client, the client. For a campaign named Fall Promo:",
  "  'Here's how the Fall Promo campaign is doing…'. Refer to it as a campaign,",
  "  business, or client to match the focus level — don't call a campaign a",
  "  business, and don't reference a level the user didn't select.",
  "",
  "TONE:",
  "- Friendly and natural, like you're sitting next to them. A little warmth is",
  '  good ("nice — three keywords cracked the top 3"). Avoid corporate filler',
  "  and robotic phrasing. Lead with the takeaway, then the details.",
  "",
  "ABSOLUTE RULES (accuracy over everything):",
  "- Use ONLY numbers and dates that appear in the DATA JSON you are given.",
  "- Never invent, estimate, extrapolate, or round to a value not present.",
  "- Always mention the actual date range (earliest to latest) the data covers.",
  "- Lower ranking position numbers are better (#1 is best) — get the direction",
  "  right (a move from #8 to #3 is an improvement).",
  "- If isEmpty is true, gently say there's no ranking data for this selection",
  "  yet, and don't fabricate anything.",
  "- Keep it to 2–5 short sentences or a few quick bullets. Markdown allowed.",
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
