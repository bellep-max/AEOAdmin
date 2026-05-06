/**
 * Variant generator — calls DeepSeek V4 to produce high-intent search-phrase
 * variants for a keyword. Per the May 5 product call: variants must NOT include
 * the literal zip code; location is implied via "near me", neighborhood names,
 * city names. Variants drive the daily AEO search prompt randomization.
 */
import { logger } from "../lib/logger";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_COUNT = 50;

export interface VariantGenerationInput {
  keyword: string;
  zipCode?: string | null;
  city?: string | null;
  state?: string | null;
  businessName?: string | null;
  count?: number;
}

export interface VariantGenerationResult {
  variants: string[];
  model: string;
  prompt: string;
  generationParams: {
    keyword: string;
    zipCode: string | null;
    city: string | null;
    state: string | null;
    businessName: string | null;
    count: number;
  };
}

const PROMPT_TEMPLATE = `You generate high-intent local search-query variants for AI Engine Optimization (AEO).

Core keyword: "{{keyword}}"
Search location: {{location}}
Business (context only — NEVER mention by name): {{business}}

Produce {{count}} natural-sounding variants a real customer might type into Google or an AI assistant.

LOCATION DISTRIBUTION (this is the most important rule — count carefully):
- About 30% of variants: NO location at all (just intent + keyword, e.g. "best mommy makeover for moms")
- About 30% of variants: use "near me" (e.g. "mommy makeover near me with reviews")
- About 25% of variants: reference a NEIGHBORHOOD, district, or street name nearby — never the city itself
- About 15% of variants: mention the city, but BURIED in the middle of the phrase, never as a trailing tag
- 0% of variants: append "{{city_name}}" or "{{state_code}}" at the end like a SEO tag — this is forbidden

PHRASING RULES:
- Bury or rewrite the core keyword inside a longer phrase. Do NOT just append a city or state.
- Vary intents: best, top rated, affordable, reviews, before and after, open now, cost, financing, recovery, consultation, who does, where to get, what is, recommendations
- Vary length: some 3-5 words, some full sentences (~10-12 words), a few questions
- Lowercase. No punctuation except apostrophes. Occasional missing apostrophe is fine (5%).
- NEVER include the business name "{{business}}" or any obvious identifying detail (doctor names, brand names from the business).
- NEVER include the raw zip code.
- Do NOT use these words: amazing, excellent, professional, highly recommend, outstanding, premier, world-class.
- Do not output the core keyword by itself.

OUTPUT:
- {{count}} lines, one variant per line.
- No numbering, no bullets, no quotes, no commentary, no blank lines.`;

function buildPrompt(input: VariantGenerationInput): string {
  const count = input.count ?? DEFAULT_COUNT;
  const locationParts: string[] = [];
  if (input.city) locationParts.push(input.city);
  if (input.state) locationParts.push(input.state);
  const location = locationParts.length > 0 ? locationParts.join(", ") : "(no city — use generic 'near me' phrasing)";
  const business = input.businessName ?? "(unspecified)";
  const cityName = input.city ?? "the city";
  const stateCode = input.state ?? "the state";

  return PROMPT_TEMPLATE
    .replaceAll("{{keyword}}", input.keyword)
    .replaceAll("{{location}}", location)
    .replaceAll("{{business}}", business)
    .replaceAll("{{city_name}}", cityName)
    .replaceAll("{{state_code}}", stateCode)
    .replaceAll("{{count}}", String(count));
}

function parseVariants(raw: string, keyword: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const keywordLower = keyword.toLowerCase().trim();

  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line
      .replace(/^[\s\-*•\d.()\[\]]+/, "")
      .trim()
      .toLowerCase();
    if (!cleaned) continue;
    if (cleaned === keywordLower) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

export async function generateVariants(input: VariantGenerationInput): Promise<VariantGenerationResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }

  const count = input.count ?? DEFAULT_COUNT;
  const prompt = buildPrompt(input);

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: "You output only the requested list with no extra commentary." },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, "DeepSeek call failed");
    throw new Error(`DeepSeek API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const variants = parseVariants(content, input.keyword);

  if (variants.length === 0) {
    throw new Error("DeepSeek returned no usable variants");
  }

  return {
    variants,
    model: DEFAULT_MODEL,
    prompt,
    generationParams: {
      keyword: input.keyword,
      zipCode: input.zipCode ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      businessName: input.businessName ?? null,
      count,
    },
  };
}

export const VARIANT_PROMPT_TEMPLATE = PROMPT_TEMPLATE;
