/**
 * Keyword research service — local keyword discovery.
 *
 * Pipeline (ported from device-agent/keyword_research.py):
 *   Google Autocomplete (free) → DeepSeek enrichment (intent, commercial-intent,
 *   reasoning, AI-search questions) → LVS score (provisional; volume proxy).
 *
 * DeepSeek is called through the shared chatCompletion() wrapper so cost is tracked
 * the same way as the rest of the app. Difficulty is left null here — it requires a
 * real SERP scrape (the device fleet), wired separately.
 */
import { chatCompletion, type ChatCompletionResult } from "./llm-client";
import { logger } from "../lib/logger";

const AUTOCOMPLETE_URL = "https://suggestqueries.google.com/complete/search";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
const PREFIX_MODIFIERS = ["best", "affordable", "cheap", "top", "licensed", "near me", "24 hour"];
const SUFFIX_MODIFIERS = ["near me", "prices", "cost", "reviews", "open now"];

export interface ScoringWeights {
  volume: number;
  intent: number;
  difficulty: number;
}
export const DEFAULT_WEIGHTS: ScoringWeights = { volume: 0.4, intent: 0.35, difficulty: 0.3 };

export interface KeywordIdea {
  keyword: string;
  listType: "traditional" | "ai_search";
  popularity: number | null;
  intent: string | null;
  commercialIntent: number | null;
  reasoning: string | null;
  difficulty: number | null;
  difficultyBasis: string | null;
  lvs: number | null;
}

export interface KeywordResearchResult {
  traditional: KeywordIdea[];
  aiSearch: KeywordIdea[];
  costUsd: number;
}

export interface RunKeywordResearchOptions {
  seed: string;
  location?: string;
  gl?: string;
  hl?: string;
  maxIdeas?: number;
  aiCount?: number;
  weights?: ScoringWeights;
}

// ── 1. idea generation (free Google Autocomplete) ───────────────────────────────

async function autocomplete(query: string, gl: string, hl: string): Promise<string[]> {
  const params = new URLSearchParams({ client: "firefox", hl, gl, q: query });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${AUTOCOMPLETE_URL}?${params.toString()}`, {
      headers: { "User-Agent": "Mozilla/5.0 (keyword-research)" },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = JSON.parse(await res.text()) as unknown;
    return Array.isArray(data) && Array.isArray(data[1]) ? (data[1] as string[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

function sharesToken(seed: string, kw: string): boolean {
  const a = new Set(seed.match(/\w+/g) ?? []);
  const b = new Set(kw.match(/\w+/g) ?? []);
  for (const t of a) if (b.has(t)) return true;
  return false;
}

async function generateIdeas(
  seed: string,
  location: string,
  gl: string,
  hl: string,
  maxIdeas: number,
): Promise<{ keyword: string; popularity: number }[]> {
  seed = seed.trim().toLowerCase();
  const cityFirst = (location || "").split(",")[0].trim();

  const queries = [seed, `${seed} `];
  for (const c of ALPHABET) queries.push(`${seed} ${c}`);
  for (const m of PREFIX_MODIFIERS) queries.push(`${m} ${seed}`);
  for (const m of SUFFIX_MODIFIERS) queries.push(`${seed} ${m}`);
  if (cityFirst) queries.push(`${seed} in ${cityFirst}`, `${seed} ${cityFirst}`, `best ${seed} ${cityFirst}`);
  const uniqueQueries = [...new Set(queries)];

  const freq = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;

  // sequential with a tiny gap — gentle on the endpoint, mirrors the prototype
  for (const q of uniqueQueries) {
    const suggestions = await autocomplete(q, gl, hl);
    for (const s of suggestions) {
      order += 1;
      const key = s.trim().toLowerCase();
      if (!key) continue;
      if (!key.includes(seed) && !sharesToken(seed, key)) continue;
      freq.set(key, (freq.get(key) ?? 0) + 1);
      if (!firstSeen.has(key)) firstSeen.set(key, order);
    }
  }

  if (freq.size === 0) return [];
  const maxFreq = Math.max(...freq.values());
  const ideas = [...freq.entries()].map(([kw, f]) => {
    const breadth = f / maxFreq;
    const early = 1.0 - Math.min(firstSeen.get(kw) ?? 200, 200) / 200;
    const popularity = Math.round((0.7 * breadth + 0.3 * early) * 10000) / 10000;
    return { keyword: kw, popularity };
  });
  ideas.sort((a, b) => b.popularity - a.popularity);
  return ideas.slice(0, maxIdeas);
}

// ── 2. DeepSeek enrichment ──────────────────────────────────────────────────────

function parseJsonLoose(s: string): unknown {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  return JSON.parse(slice);
}

function clip01(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

interface EnrichRow {
  keyword?: string;
  intent?: string;
  commercial_intent?: number;
  reasoning?: string;
}

async function enrichKeywords(
  ideas: { keyword: string; popularity: number }[],
  seed: string,
  location: string,
): Promise<{ map: Map<string, EnrichRow>; cost: number }> {
  if (ideas.length === 0) return { map: new Map(), cost: 0 };
  const sys =
    "You are a local-SEO keyword analyst. For each keyword, return its search intent and a " +
    "commercial-intent score. Respond with ONLY a JSON object: " +
    '{"results":[{"keyword":..., "intent":"informational|navigational|commercial|transactional", ' +
    '"commercial_intent":0.0-1.0, "reasoning":"<=12 words why it matters for this local business"}]}';
  const user =
    `Business seed: ${seed}\nLocation: ${location}\nKeywords:\n` +
    ideas.map((i) => `- ${i.keyword}`).join("\n");

  let result: ChatCompletionResult;
  try {
    result = await chatCompletion({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.3,
    });
  } catch (err) {
    logger.error({ err }, "keyword-research: enrichment call failed");
    return { map: new Map(), cost: 0 };
  }

  const map = new Map<string, EnrichRow>();
  try {
    const parsed = parseJsonLoose(result.content) as { results?: EnrichRow[] };
    for (const r of parsed.results ?? []) {
      if (r.keyword) map.set(r.keyword.trim().toLowerCase(), r);
    }
  } catch (err) {
    logger.error({ err }, "keyword-research: failed to parse enrichment JSON");
  }
  return { map, cost: result.costUsd };
}

async function generateAiSearch(
  seed: string,
  location: string,
  n: number,
): Promise<{ items: EnrichRow[]; cost: number }> {
  const sys =
    "Generate natural, conversational questions a person would ask an AI assistant " +
    "(ChatGPT, Gemini) when looking for this local service. Respond with ONLY a JSON object: " +
    '{"results":[{"keyword":"<question>","intent":"commercial|informational",' +
    '"commercial_intent":0.0-1.0,"reasoning":"<=12 words"}]}';
  const user = `Service: ${seed}\nLocation: ${location}\nProduce ${n} distinct questions.`;
  let result: ChatCompletionResult;
  try {
    result = await chatCompletion({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.7,
    });
  } catch (err) {
    logger.error({ err }, "keyword-research: ai-search call failed");
    return { items: [], cost: 0 };
  }
  try {
    const parsed = parseJsonLoose(result.content) as { results?: EnrichRow[] };
    const items = (parsed.results ?? []).filter((r) => r.keyword && r.keyword.trim());
    return { items, cost: result.costUsd };
  } catch (err) {
    logger.error({ err }, "keyword-research: failed to parse ai-search JSON");
    return { items: [], cost: result.costUsd };
  }
}

/** Derive a likely core service search term from a business name (used to pre-fill the
 *  seed when the business has no category/keywords). Returns null on any failure. */
export async function suggestSeedFromName(businessName: string, hint?: string): Promise<string | null> {
  const name = (businessName ?? "").trim();
  if (!name) return null;
  try {
    const result = await chatCompletion({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "Given a local business name, return the single core service search term (1-3 words, " +
            'lowercase) a customer would type into Google. Respond with ONLY JSON: {"seed":"..."}.',
        },
        { role: "user", content: `Business: ${name}${hint ? `\nContext: ${hint}` : ""}` },
      ],
      temperature: 0.2,
    });
    const parsed = parseJsonLoose(result.content) as { seed?: string };
    const seed = (parsed.seed ?? "").trim().toLowerCase();
    return seed || null;
  } catch {
    return null;
  }
}

// ── 3. scoring ──────────────────────────────────────────────────────────────────

function computeLvs(
  opts: { popularity: number | null; commercialIntent: number | null; difficulty: number | null },
  w: ScoringWeights,
): number {
  const pop = opts.popularity ?? 0.5;
  const ci = opts.commercialIntent ?? 0.5;
  const diffNorm = opts.difficulty == null ? 0.5 : opts.difficulty / 100;
  const z = w.volume * pop + w.intent * ci - w.difficulty * diffNorm;
  const lvs = 100 / (1 + Math.exp(-4 * (z - 0.15)));
  return Math.max(1, Math.round(lvs));
}

// ── orchestration ─────────────────────────────────────────────────────────────

export async function runKeywordResearch(opts: RunKeywordResearchOptions): Promise<KeywordResearchResult> {
  const seed = opts.seed.trim();
  const location = opts.location ?? "";
  const gl = opts.gl ?? "us";
  const hl = opts.hl ?? "en";
  const maxIdeas = opts.maxIdeas ?? 40;
  const aiCount = opts.aiCount ?? 8;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;

  const rawIdeas = await generateIdeas(seed, location, gl, hl, maxIdeas);

  const [enrich, ai] = await Promise.all([
    enrichKeywords(rawIdeas, seed, location),
    generateAiSearch(seed, location, aiCount),
  ]);

  const traditional: KeywordIdea[] = rawIdeas.map((idea) => {
    const e = enrich.map.get(idea.keyword) ?? {};
    const commercialIntent = e.commercial_intent != null ? clip01(e.commercial_intent) : 0.5;
    const lvs = computeLvs({ popularity: idea.popularity, commercialIntent, difficulty: null }, weights);
    return {
      keyword: idea.keyword,
      listType: "traditional",
      popularity: idea.popularity,
      intent: e.intent ?? "unknown",
      commercialIntent,
      reasoning: e.reasoning ?? "",
      difficulty: null,
      difficultyBasis: null,
      lvs,
    };
  });
  traditional.sort((a, b) => (b.lvs ?? 0) - (a.lvs ?? 0));

  const aiSearch: KeywordIdea[] = ai.items.map((r) => {
    const commercialIntent = r.commercial_intent != null ? clip01(r.commercial_intent) : 0.6;
    const lvs = computeLvs({ popularity: null, commercialIntent, difficulty: null }, weights);
    return {
      keyword: (r.keyword ?? "").trim(),
      listType: "ai_search",
      popularity: null,
      intent: r.intent ?? "commercial",
      commercialIntent,
      reasoning: r.reasoning ?? "",
      difficulty: null,
      difficultyBasis: null,
      lvs,
    };
  });
  aiSearch.sort((a, b) => (b.lvs ?? 0) - (a.lvs ?? 0));

  return { traditional, aiSearch, costUsd: enrich.cost + ai.cost };
}
