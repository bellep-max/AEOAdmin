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
Business: {{business}}

Produce {{count}} natural-sounding variants a real customer might type. Rules:
- Bury or rewrite the core keyword inside a longer phrase. Do NOT just append a city.
- Use "near me", neighborhood names, or local cues — but never the raw zip code.
- Mix intents: best, top rated, affordable, reviews, open now, hours, etc.
- Vary length and word order. Lowercase. No punctuation except apostrophes.
- One phrase per line. No numbering, no bullets, no extra commentary.
- Do not output the core keyword by itself.

Output format: {{count}} lines, one variant per line.`;

function buildPrompt(input: VariantGenerationInput): string {
  const count = input.count ?? DEFAULT_COUNT;
  const locationParts: string[] = [];
  if (input.city) locationParts.push(input.city);
  if (input.state) locationParts.push(input.state);
  const location = locationParts.length > 0 ? locationParts.join(", ") : "(no city — use generic 'near me' phrasing)";
  const business = input.businessName ?? "(unspecified)";

  return PROMPT_TEMPLATE
    .replace("{{keyword}}", input.keyword)
    .replace("{{location}}", location)
    .replace("{{business}}", business)
    .replace(/\{\{count\}\}/g, String(count));
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
