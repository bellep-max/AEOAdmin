import { VARIANT_PROMPT_TEMPLATE } from "./variant-generator";
import {
  SEEDING_SYSTEM_PROMPT_V1,
  FOLLOWUP_SYSTEM_PROMPT_V1,
} from "./session-prompt-builder";
import { AUDIT_PROMPT_V2 } from "./audit-prompt-builder";

/**
 * Read-only registry of the prompt templates that drive the AEO pipeline.
 * Now sources the search + followup prompts from session-prompt-builder.ts
 * (the authoritative copy that the LLM service uses), so the admin UI
 * always shows what's actually shipping — no manual sync needed.
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  variables: string[];
  template: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "variant_generation",
    name: "Variant Generation",
    description: "Generates high-intent search-phrase variants per keyword. Run weekly per campaign. Source: services/variant-generator.ts.",
    variables: ["keyword", "location", "business", "count"],
    template: VARIANT_PROMPT_TEMPLATE,
  },
  {
    id: "search_prompt",
    name: "Search Prompt (AI Platform Query)",
    description: "Seeding system prompt used per session — wraps a variant + voice archetype into the actual question sent to ChatGPT / Gemini / Perplexity. Source: services/session-prompt-builder.ts.",
    variables: ["voice", "business", "category", "city", "state", "keyword (variant)", "neighborhood_hint", "context_hooks", "naturalness_filler"],
    template: SEEDING_SYSTEM_PROMPT_V1,
  },
  {
    id: "followup_prompt",
    name: "Follow-up Prompt",
    description: "Follow-up system prompt — optional second turn, timeless phrasing, motivation-driven. Source: services/session-prompt-builder.ts.",
    variables: ["business", "city", "keyword (variant)", "motivation_hint", "platform_phrasing_hint", "original_message"],
    template: FOLLOWUP_SYSTEM_PROMPT_V1,
  },
  {
    id: "audit_ranking_prompt",
    name: "Audit Ranking Prompt",
    description: "Sent to ChatGPT / Gemini / Perplexity during ranking audits. Rotates a keyword variant into the lead question; the [RANK: X/Y] contract is preserved so the runner's parser still works. Source: services/audit-prompt-builder.ts.",
    variables: ["keyword_phrase (variant)", "city", "state", "biz_name", "biz_url"],
    template: AUDIT_PROMPT_V2,
  },
];
