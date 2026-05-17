/**
 * Audit-ranking prompt builder.
 *
 * The audit flow asks each AI platform "where does <biz> rank for <keyword>
 * in <city>" on a fixed cadence (every 2 weeks per keyword × platform).
 * The result is parsed by the runner using the [RANK: X/Y] contract.
 *
 * Two improvements over the legacy hardcoded prompt in audit.py:
 *   1. The lead question is rotated using keyword_variants — same DB pool
 *      the daily session uses, so audit doesn't ask identical text every
 *      run and we get a more honest read of how the model sees this query.
 *   2. The prompt is restructured to read more like a real user asking, so
 *      the model's answer matches what an organic user would see — but the
 *      [RANK: X/Y] contract is preserved verbatim.
 *
 * Contract preserved:
 *   - "[RANK: X/Y]" must appear on its own line, parsed by audit.py /
 *     extract_ranking() and friends. Do not change this token.
 *   - Response should still be ≤200 words, list-style top results, then the
 *     rank line, then a one-sentence rationale.
 */
import {
  loadSessionContext,
  pickRandomVariant,
  type SessionContext,
} from "./session-prompt-builder";

export const AUDIT_PROMPT_TEMPLATE_V2 = `You're someone trying to figure out the best {keyword_phrase} options around {city}, {state}.

Give me the top 3 actual businesses you'd recommend — for each, share the name, 2–3 sentences on what makes them stand out, and whether they appear on Google Maps (yes/no). Plain text only — no images, maps, or embedded content.

Then look at where {biz_name} ({biz_url}) lands in the broader local business landscape for this query. Output this exact line on its own:

[RANK: X/Y]

…where X is the position and Y is the total count of relevant businesses you considered (e.g., [RANK: 7/25]). After that line, give one sentence on why they landed there.

Keep the whole reply under 200 words.`;

export interface BuildAuditPromptInput {
  keywordId: number;
  /** Optional pin; if absent, picks a random active variant. */
  variantId?: number | null;
  /** Optional. Currently informational; reserved for platform-specific tweaks. */
  platform?: string | null;
}

export interface BuildAuditPromptOutput {
  keywordId:    number;
  keywordText:  string;
  variantId:    number | null;
  variantText:  string;
  variantTimesUsed: number | null;
  platform:     string | null;
  prompt:       string;
  bizName:      string | null;
  bizUrl:       string | null;
  city:         string | null;
  state:        string | null;
  searchAddress: string | null;
  templateVersion: "v2";
}

/**
 * Render the audit prompt for one (keyword × platform) audit run.
 * - picks a random active variant (bumps times_used)
 * - falls back to the keyword text if there are no variants
 * - leaves the [RANK: X/Y] contract intact
 */
export async function buildAuditPrompt(input: BuildAuditPromptInput): Promise<BuildAuditPromptOutput> {
  const ctx = await loadSessionContext(input.keywordId);
  if (!ctx) throw new Error(`Keyword ${input.keywordId} not found`);

  const picked = await pickRandomVariant(input.keywordId);
  const variantText = picked?.text ?? ctx.keywordText;

  const prompt = render(AUDIT_PROMPT_TEMPLATE_V2, {
    keyword_phrase: variantText,
    city:           ctx.city  ?? "",
    state:          ctx.state ?? "",
    biz_name:       ctx.bizName    ?? "",
    biz_url:        ctx.websiteUrl ?? ctx.gmbUrl ?? "",
  });

  return {
    keywordId:        ctx.keywordId,
    keywordText:      ctx.keywordText,
    variantId:        picked?.id ?? null,
    variantText,
    variantTimesUsed: picked?.timesUsed ?? null,
    platform:         input.platform ?? null,
    prompt,
    bizName:          ctx.bizName,
    bizUrl:           ctx.websiteUrl ?? ctx.gmbUrl ?? null,
    city:             ctx.city,
    state:            ctx.state,
    searchAddress:    ctx.searchAddress,
    templateVersion:  "v2",
  };
}

/** Naive {placeholder} replacement. Missing keys render as empty string. */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

// Convenience export used by lightweight callers (and tests) that already
// have the SessionContext loaded and a variant text picked.
export function renderAuditPrompt(opts: {
  keywordPhrase: string;
  city: string | null;
  state: string | null;
  bizName: string | null;
  bizUrl: string | null;
}): string {
  return render(AUDIT_PROMPT_TEMPLATE_V2, {
    keyword_phrase: opts.keywordPhrase,
    city:           opts.city  ?? "",
    state:          opts.state ?? "",
    biz_name:       opts.bizName ?? "",
    biz_url:        opts.bizUrl  ?? "",
  });
}

// Re-export so prompt-templates.ts can show it in /admin/prompts without
// duplicating the string.
export { AUDIT_PROMPT_TEMPLATE_V2 as AUDIT_PROMPT_V2 };

// Mark unused-warning suppression for the imported type when only used
// via the `import type` re-export.
export type { SessionContext };

// ───────────────────────────────────────────────────────────────────────
// Stateless variant — caller supplies all context; service only renders
// the template. No DB lookup, no variant rotation.
// ───────────────────────────────────────────────────────────────────────

export interface BuildAuditPromptStaticInput {
  keyword_phrase: string;
  city?:          string | null;
  state?:         string | null;
  biz_name?:      string | null;
  biz_url?:       string | null;
}

export interface BuildAuditPromptStaticOutput {
  keywordPhrase:   string;
  prompt:          string;
  templateVersion: "v2";
}

export function buildAuditPromptStatic(input: BuildAuditPromptStaticInput): BuildAuditPromptStaticOutput {
  if (!input.keyword_phrase || typeof input.keyword_phrase !== "string") {
    throw new Error("keyword_phrase is required and must be a non-empty string");
  }
  const prompt = renderAuditPrompt({
    keywordPhrase: input.keyword_phrase,
    city:          input.city  ?? null,
    state:         input.state ?? null,
    bizName:       input.biz_name ?? null,
    bizUrl:        input.biz_url  ?? null,
  });
  return {
    keywordPhrase:   input.keyword_phrase,
    prompt,
    templateVersion: "v2",
  };
}
