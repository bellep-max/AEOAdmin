import { VARIANT_PROMPT_TEMPLATE } from "./variant-generator";

/**
 * Read-only registry of the prompt templates that drive the AEO pipeline.
 * Mirror of the executor's prompts so admins can review what is being sent
 * to the AI platforms without having to read the executor source.
 *
 * Source of truth for the variant-generation prompt is variant-generator.ts.
 * Source of truth for search + followup prompts lives in the executor
 * (aeo-appium/agents/prompt_generator.py) — these snapshots are kept in
 * sync manually; surface them here so Mary/Russ can audit what is shipping.
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  variables: string[];
  template: string;
}

const SEARCH_PROMPT_TEMPLATE = `Generate ONE natural-sounding search question a real local customer would ask an AI assistant. The question must:

- Be about the business "{{business_name}}" implicitly (do NOT name it directly).
- Use the keyword variant "{{keyword_variant}}" buried inside a longer query.
- Reference the search area "{{city}}, {{state}}" (or "near me" if city is unknown).
- Sound conversational, like the customer is unsure and asking for a recommendation.
- Be 1–2 sentences, max ~30 words.
- Do not include the zip code, do not greet the AI, do not number the question.

Output ONLY the question text — no quotes, no preamble.`;

const FOLLOWUP_PROMPT_TEMPLATE = `The user just asked an AI assistant: "{{prior_prompt}}"
The AI responded with information about local businesses including "{{business_name}}".

Generate ONE timeless follow-up question the same user might naturally ask next. Rules:
- Conversational tone, like a real chat.
- Do NOT use recency words: recent, latest, new, this year, 2024, 2025, 2026.
- Stay on the same intent (still looking for the same kind of business).
- 1 sentence, max ~20 words.

Output ONLY the follow-up question.`;

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "variant_generation",
    name: "Variant Generation",
    description: "Generates high-intent search-phrase variants per keyword. Run weekly per campaign. DeepSeek V4.",
    variables: ["keyword", "location", "business", "count"],
    template: VARIANT_PROMPT_TEMPLATE,
  },
  {
    id: "search_prompt",
    name: "Search Prompt (AI Platform Query)",
    description: "Wraps a randomly-picked variant into the actual question sent to ChatGPT / Gemini / Perplexity during a daily session.",
    variables: ["business_name", "keyword_variant", "city", "state"],
    template: SEARCH_PROMPT_TEMPLATE,
  },
  {
    id: "followup_prompt",
    name: "Follow-up Prompt",
    description: "Optional second turn in the AI conversation. Timeless phrasing — strips recency words.",
    variables: ["prior_prompt", "business_name"],
    template: FOLLOWUP_PROMPT_TEMPLATE,
  },
];
