/**
 * Keyword generator — calls DeepSeek to produce the buyer-intent local search
 * keywords we TRACK for a business (the "core" phrases, e.g. "bilingual
 * childcare san francisco"). Unlike variants, keywords KEEP the location — they
 * are the tracked targets. Generation lives here in the admin BE (not the
 * marketing site) so the admin owns the keyword set for a signup.
 */
import { logger } from "../lib/logger";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_COUNT = 5;

export interface KeywordGenerationInput {
  businessName: string;
  service?: string | null;
  location?: string | null;
  website?: string | null;
  count?: number;
}

export interface KeywordGenerationResult {
  keywords: string[];
  model: string;
}

const PROMPT_TEMPLATE = `You generate buyer-intent LOCAL search keywords for a business, for AI Engine Optimization (AEO) rank tracking.

Business: {{business}}
Service / category: {{service}}
Location: {{location}}
Website (context only): {{website}}

Produce {{count}} distinct buyer-intent local search phrases a real customer would type into Google or an AI assistant when looking for THIS kind of business in THIS area.

RULES:
- Each phrase names the core service or offering — infer it from the business, service, and website.
- Include the city/area in MOST phrases — these are tracked target keywords, so the location IS wanted here.
- Vary the modifier across the set: best, licensed, near me, top rated, affordable, and specific sub-services.
- 3 to 7 words. Lowercase. No punctuation. Realistic search phrases, not marketing copy.
- No duplicates. Do not include the business's own name.

OUTPUT:
- {{count}} lines, one phrase per line.
- No numbering, no bullets, no quotes, no commentary, no blank lines.`;

function buildPrompt(input: KeywordGenerationInput): string {
  const count = input.count ?? DEFAULT_COUNT;
  return PROMPT_TEMPLATE.replaceAll("{{business}}", input.businessName)
    .replaceAll(
      "{{service}}",
      input.service?.trim() || "(infer from the business + website)",
    )
    .replaceAll(
      "{{location}}",
      input.location?.trim() || "(no location given — use generic phrasing)",
    )
    .replaceAll("{{website}}", input.website?.trim() || "(none)")
    .replaceAll("{{count}}", String(count));
}

function parseKeywords(raw: string, businessName: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const bizLower = businessName.toLowerCase().trim();
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line
      .replace(/^[\s\-*•\d.()[\]]+/, "")
      .replace(/["']/g, "")
      .trim()
      .toLowerCase();
    if (!cleaned || cleaned.length < 3) continue;
    if (bizLower && cleaned.includes(bizLower)) continue; // drop phrases naming the business
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/**
 * Generate the tracked keyword set for a business. Throws on config/API error or
 * if nothing usable comes back — callers decide whether that's fatal.
 */
export async function generateKeywords(
  input: KeywordGenerationInput,
): Promise<KeywordGenerationResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
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
        {
          role: "system",
          content:
            "You output only the requested list with no extra commentary.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 512,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error(
      { status: response.status, body },
      "DeepSeek keyword call failed",
    );
    throw new Error(
      `DeepSeek API error ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const keywords = parseKeywords(content, input.businessName).slice(0, count);
  if (keywords.length === 0)
    throw new Error("DeepSeek returned no usable keywords");

  return { keywords, model: DEFAULT_MODEL };
}
