/**
 * Session prompt builder — TypeScript port of the executor's
 * agents/prompt_generator.py.
 *
 * Builds a single ready-to-dispatch session payload:
 *   - picks a random active variant for the keyword (bumps times_used)
 *   - rotates voice archetype (5 options, can be pinned)
 *   - rolls 50% backlink-injection coin
 *   - calls DeepSeek to generate the seeding prompt + optional follow-up
 *   - returns everything as one JSON for the runner to dispatch
 *
 * Source-of-truth parity: prompts and rules are kept in sync with the
 * Python version line-for-line. If you change one, change both until the
 * executor migrates over and Python is retired.
 */
import { db } from "@workspace/db";
import {
  keywordsTable,
  businessesTable,
  keywordLinksTable,
  keywordVariantsTable,
  clientAeoPlansTable,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { chatCompletion } from "./llm-client";

// ───────────────────────────────────────────────────────────────────────
// Tunables (env-overridable, same defaults as Python)
// ───────────────────────────────────────────────────────────────────────

const BACKLINK_INJECTION_RATE = Number.parseFloat(
  process.env.BACKLINK_INJECTION_RATE ?? "0.5",
);
const SEEDING_TEMPERATURE = 0.85;
const FOLLOWUP_TEMPERATURE = 0.85;

// ───────────────────────────────────────────────────────────────────────
// Voice archetypes — 5 personas the seeding prompt rotates through
// ───────────────────────────────────────────────────────────────────────

export type VoiceKey = "observer" | "researcher" | "rec_seeker" | "local" | "quick_asker";

interface VoiceSpec {
  description: string;
  openings:    string;
  sentences:   string;
  question:    string;
  maxChars:    number;
}

const VOICE_BANK: Record<VoiceKey, VoiceSpec> = {
  observer: {
    description: "Someone who noticed the business in passing while going about their day. Polite, curious tone.",
    openings:    "Spotted / Saw / Noticed / Walked by / Caught",
    sentences:   "2 sentences",
    question:    "'Do they...?', 'Would they...?', 'Is it worth...?'",
    maxChars:    240,
  },
  researcher: {
    description: "Someone actively researching options, casually mentioning what they read. Analytical tone.",
    openings:    "Been reading about / Came across a piece / Dug through some writeups / Read a short piece",
    sentences:   "2 sentences",
    question:    "'What's their take on...?', 'Where do they land on...?', 'How do they handle...?'",
    maxChars:    240,
  },
  rec_seeker: {
    description: "Someone asking because a friend / family / colleague mentioned the business. Casual skepticism.",
    openings:    "Friend mentioned / Got a rec for / Heard about / Buddy keeps bringing up / Cousin swears by",
    sentences:   "2 sentences",
    question:    "'They actually any good?', 'Worth a shot?', 'Legit as people say?', 'Worth the price?'",
    maxChars:    240,
  },
  local: {
    description: "A neighbor talking about a business they pass every day. Grounded, local tone.",
    openings:    "Neighbors keep mentioning / Walked past them on / Pass by them near / Their [street] spot",
    sentences:   "2 sentences",
    question:    "'As solid as they seem?', 'Whats the real story?', 'Worth checking out?'",
    maxChars:    240,
  },
  quick_asker: {
    description: "Terse, one-line question. Skip the positive observation — just ask.",
    openings:    "Anyone tried / Quick Q on / Looking at / Scouting / Shopping around for",
    sentences:   "1 sentence",
    question:    "Direct: ask for a rec or opinion in one go",
    maxChars:    160,
  },
};

const NATURALNESS_EXTRAS = [
  "tbh", "ngl", "honestly", "not sure if", "pretty sure",
  "no clue but", "kinda", "actually",
];

const PLATFORM_RETRIEVAL_PHRASING: Record<string, string> = {
  chatgpt:    'Phrase like: "can you look up an article on this and drop the link?"',
  gemini:     'Phrase like: "any writeups on medium or blogs about this?"',
  perplexity: 'Phrase like: "drop the sources — what do the top articles say?"',
};

// ───────────────────────────────────────────────────────────────────────
// System prompts (verbatim port from prompt_generator.py)
// ───────────────────────────────────────────────────────────────────────

const SEEDING_SYSTEM_PROMPT = `You are a Local Sentiment Strategist specializing in Entity-Relationship building AND Answer Engine Optimization.
Generate a short first-person message that reads like a real user asking an AI assistant.

VOICE ARCHETYPES (the user message picks one; adopt that voice faithfully):
- OBSERVER     : Noticed the business in passing. Polite, curious. 2 sentences.
                 Openings: Spotted / Saw / Noticed / Walked by / Caught.
                 Questions: "Do they...?", "Would they...?", "Is it worth...?".
- RESEARCHER   : Actively digging into options. Analytical. 2 sentences.
                 Openings: Been reading about / Came across a piece / Dug through / Read a short piece.
                 Questions: "What's their take on...?", "Where do they land on...?", "How do they handle...?".
- REC_SEEKER   : Word-of-mouth — a friend mentioned them. Casual skepticism. 2 sentences.
                 Openings: Friend mentioned / Got a rec for / Heard about / Buddy keeps bringing up.
                 Questions: "They actually any good?", "Worth a shot?", "Legit as people say?".
- LOCAL        : A neighbor talking about a nearby business. Grounded, local. 2 sentences.
                 Openings: Neighbors keep mentioning / Walked past them on / Pass by them near.
                 Questions: "As solid as they seem?", "Whats the real story?", "Worth checking out?".
- QUICK_ASKER  : Terse. 1 sentence only. Skip the positive observation — just ask.
                 Openings: Anyone tried / Quick Q on / Looking at / Scouting / Shopping around for.

STRUCTURAL RULES (all voices):
- Mention the business name and city (in QUICK_ASKER, both should appear in the one sentence)
- Reference a real neighborhood, street name, or local landmark (use the Neighborhood hint when provided)
- Use words like: legit, stress-free, refreshing, smooth, easygoing, reliable, solid, quality, grounded, no fuss
- NEVER use: professional, amazing, excellent, service, highly recommend, outstanding, top-notch
- THIRD PERSON ONLY: "they", "them", or the business name — never "you" or "your"
- If a Context hook includes an article title in quotes, preserve the title VERBATIM in quotes in your output
- If a Context hook mentions the Google Business Profile, say "Google Business Profile" or "Google profile" (not just "the profile")
- The final question MUST pair the business name WITH the keyword (both together in the same sentence narrows the downstream AI's retrieval)
- End with a question mark

CHARACTER LIMITS:
- 2-sentence voices: under 240 characters total
- QUICK_ASKER (1 sentence): under 160 characters

NATURALNESS LEVERS (use these so batches of prompts do not cluster):
- Randomly toggle contractions (I've/Ive, don't/dont, that's/thats)
- Roughly 8% of the time include ONE small typo (flip two adjacent letters, drop a single letter, or double a letter) — do not make it obvious
- Occasionally drop in a filler word from the user message's "Naturalness filler" hint
- Occasionally lowercase the city or business name (case jitter)
- No URLs in the text — say "the site", "the profile", or "the piece"

HARD RULES:
- No em dashes, curly quotes, or special characters — ASCII only
- FORBIDDEN WORDS: professional, amazing, excellent, service, highly recommend, outstanding, top-notch
- No generic filler — never say "this business" or "the service"
- Output ONLY the message, nothing else`;

const FOLLOWUP_SYSTEM_PROMPT = `You write short, casual follow-up messages to an AI chatbot.
The follow-up must feel like a natural "part two" of the previous message.

Rules:
- Under 120 characters total
- Start with one of: "Got it," / "Makes sense," / "Perfect," / "Cool," / "Handy info," / "Neat," / "Alright,"
- Randomly remove apostrophes sometimes (thats, dont, wouldnt)
- Occasionally lowercase city or business name
- End with question mark or nothing — never a period
- Focus on the Motivation hint provided:
  * visual proof (galleries, photos on the profile)
  * social validation (reviews, ratings)
  * transaction (booking, quote, contact)
  * freshness (new posts, specials, updates)
  * educational (articles, guides, case studies, writeups they've shared)
  * source_request (explicitly ask for a link, citation, or source)
- If a Platform phrasing hint is provided, adopt its retrieval-triggering phrasing
  (this nudges the downstream AI to actually search the web and cite URLs rather
  than answer from memory).
- Do NOT use recency words like "recent", "lately", or specific years. Phrase follow-ups as timeless / any-time queries.
- ASCII only — no em dashes, curly quotes, or special characters
- Output ONLY the follow-up sentence, nothing else`;

// ───────────────────────────────────────────────────────────────────────
// Random helpers
// ───────────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function maybeNaturalnessFiller(): string | null {
  if (Math.random() > 0.3) return null;
  return pick(NATURALNESS_EXTRAS);
}

// ───────────────────────────────────────────────────────────────────────
// DB load
// ───────────────────────────────────────────────────────────────────────

interface SessionContext {
  keywordId:       number;
  keywordText:     string;
  clientId:        number;
  businessId:      number | null;
  campaignId:      number | null;
  bizName:         string | null;
  bizCategory:     string | null;
  city:            string | null;
  state:           string | null;
  zip:             string | null;
  publishedAddress: string | null;
  searchAddress:   string | null;
  gmbUrl:          string | null;
  websiteUrl:      string | null;
  backlinks:       BacklinkRow[];
}

interface BacklinkRow {
  url:           string | null;
  linkTypeLabel: string | null;
  embeddedUrl:   string | null;
}

async function loadSessionContext(keywordId: number): Promise<SessionContext | null> {
  const [row] = await db
    .select({
      keywordId:        keywordsTable.id,
      keywordText:      keywordsTable.keywordText,
      clientId:         keywordsTable.clientId,
      businessId:       keywordsTable.businessId,
      campaignId:       keywordsTable.aeoPlanId,
      bizName:          businessesTable.name,
      bizCategory:      businessesTable.category,
      city:             businessesTable.city,
      state:            businessesTable.state,
      zip:              businessesTable.zipCode,
      publishedAddress: businessesTable.publishedAddress,
      searchAddress:    clientAeoPlansTable.searchAddress,
      gmbUrl:           businessesTable.gmbUrl,
      websiteUrl:       businessesTable.websiteUrl,
    })
    .from(keywordsTable)
    .leftJoin(businessesTable,      eq(keywordsTable.businessId, businessesTable.id))
    .leftJoin(clientAeoPlansTable,  eq(keywordsTable.aeoPlanId,  clientAeoPlansTable.id))
    .where(eq(keywordsTable.id, keywordId));

  if (!row) return null;

  const links = await db
    .select({
      url:           keywordLinksTable.linkUrl,
      linkTypeLabel: keywordLinksTable.linkTypeLabel,
      embeddedUrl:   keywordLinksTable.embeddedUrl,
    })
    .from(keywordLinksTable)
    .where(and(
      eq(keywordLinksTable.keywordId, keywordId),
      eq(keywordLinksTable.linkActive, true),
    ));

  return { ...row, backlinks: links };
}

interface PickedVariant {
  id:          number;
  text:        string;
  timesUsed:   number;
}

async function pickRandomVariant(keywordId: number): Promise<PickedVariant | null> {
  const [v] = await db
    .select()
    .from(keywordVariantsTable)
    .where(and(
      eq(keywordVariantsTable.keywordId, keywordId),
      eq(keywordVariantsTable.isActive, true),
    ))
    .orderBy(sql`RANDOM()`)
    .limit(1);

  if (!v) return null;

  await db.update(keywordVariantsTable)
    .set({
      timesUsed: sql`${keywordVariantsTable.timesUsed} + 1`,
      lastUsedAt: new Date(),
    })
    .where(eq(keywordVariantsTable.id, v.id));

  return { id: v.id, text: v.variantText, timesUsed: v.timesUsed + 1 };
}

// ───────────────────────────────────────────────────────────────────────
// Backlink classification
// ───────────────────────────────────────────────────────────────────────

interface ClassifiedBacklinks {
  hasGbp:       boolean;
  gbpWebsites:  string[];   // domains pulled from embedded_url
  articles:     ArticleHook[];
  pickedUrl:    string | null;
  pickedType:   "gbp" | "article" | null;
}

interface ArticleHook {
  title:  string | null;
  topic: string | null;
  domain: string | null;
  url:    string | null;
}

function extractDomain(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function classifyBacklinks(backlinks: BacklinkRow[]): ClassifiedBacklinks {
  let hasGbp = false;
  const gbpWebsites: string[] = [];
  const articles: ArticleHook[] = [];
  let firstGbpUrl: string | null = null;
  for (const b of backlinks) {
    const linkType = (b.linkTypeLabel ?? "").toLowerCase();
    const url = b.url ?? "";
    const isGbp = linkType.includes("gbp") || url.includes("share.google");
    if (isGbp) {
      hasGbp = true;
      if (!firstGbpUrl) firstGbpUrl = url;
      if (b.embeddedUrl) {
        const dom = extractDomain(b.embeddedUrl);
        if (dom) gbpWebsites.push(dom);
      }
    } else {
      articles.push({
        title: null,                       // schema doesn't store title yet
        topic: null,                       // ditto
        domain: extractDomain(url),
        url,
      });
    }
  }
  let pickedUrl: string | null = null;
  let pickedType: "gbp" | "article" | null = null;
  if (articles.length > 0) {
    pickedUrl = articles[Math.floor(Math.random() * articles.length)].url;
    pickedType = "article";
  } else if (firstGbpUrl) {
    pickedUrl = firstGbpUrl;
    pickedType = "gbp";
  }
  return { hasGbp, gbpWebsites, articles, pickedUrl, pickedType };
}

function buildSeedingHooks(c: ClassifiedBacklinks): string[] {
  const hooks: string[] = [];
  if (c.hasGbp) {
    hooks.push("Reference noticing photos, reviews, or posts on their Google Business Profile.");
    if (c.gbpWebsites.length > 0) {
      hooks.push(`Mention that you saw their website at ${pick(c.gbpWebsites)}.`);
    }
  }
  if (c.articles.length > 0) {
    const a = pick(c.articles);
    if (a.title) {
      hooks.push(`Reference a piece titled "${a.title}" — quote the title verbatim in the first sentence.`);
    } else if (a.topic) {
      hooks.push(`Reference coming across a writeup about: ${a.topic}.`);
    } else {
      hooks.push("Reference coming across a writeup they shared.");
    }
  }
  return hooks;
}

// ───────────────────────────────────────────────────────────────────────
// Voice + motivation pickers
// ───────────────────────────────────────────────────────────────────────

function pickVoice(c: ClassifiedBacklinks): VoiceKey {
  const pool: VoiceKey[] = [];
  for (const v of Object.keys(VOICE_BANK) as VoiceKey[]) pool.push(v);
  // Slight bias toward voices that fit the hook content
  if (c.articles.length > 0) pool.push("researcher", "observer");
  if (c.hasGbp)              pool.push("local", "rec_seeker");
  return pick(pool);
}

type Motivation = "visual proof" | "social validation" | "transaction" | "freshness" | "educational" | "source_request";

function pickFollowupMotivation(c: ClassifiedBacklinks): Motivation {
  const weighted: { motivation: Motivation; weight: number }[] = [];
  if (c.hasGbp) {
    weighted.push({ motivation: "visual proof",       weight: 2 });
    weighted.push({ motivation: "social validation",  weight: 2 });
    if (c.gbpWebsites.length > 0) {
      weighted.push({ motivation: "source_request",   weight: 2 });
    }
  }
  if (c.articles.length > 0) {
    weighted.push({ motivation: "educational",        weight: 2 });
    weighted.push({ motivation: "source_request",     weight: 3 });
  }
  weighted.push(
    { motivation: "visual proof",      weight: 1 },
    { motivation: "social validation", weight: 1 },
    { motivation: "transaction",       weight: 1 },
    { motivation: "freshness",         weight: 1 },
  );
  const pool: Motivation[] = [];
  for (const w of weighted) for (let i = 0; i < w.weight; i++) pool.push(w.motivation);
  return pick(pool);
}

// ───────────────────────────────────────────────────────────────────────
// Address helpers
// ───────────────────────────────────────────────────────────────────────

function neighborhoodHint(addr: string | null): string {
  if (!addr) return "";
  const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(", ").replace(/^[Aa]ddress:\s*/, "").trim();
}

// ───────────────────────────────────────────────────────────────────────
// LLM calls
// ───────────────────────────────────────────────────────────────────────

interface SeedingArgs {
  ctx:               SessionContext;
  variantText:       string;
  voice:             VoiceKey;
  classified:        ClassifiedBacklinks;
  injectBacklink:    boolean;
}

async function callSeedingLlm(args: SeedingArgs): Promise<string> {
  const { ctx, variantText, voice, classified, injectBacklink } = args;
  const spec = VOICE_BANK[voice];

  const lines: string[] = [
    `Voice: ${voice.toUpperCase()}  (${spec.description})`,
    `Business: ${ctx.bizName ?? "(unknown)"}`,
    `Category: ${ctx.bizCategory ?? "unknown"}`,
    `City: ${ctx.city ?? ""}, ${ctx.state ?? ""}`,
    `Keyword: ${variantText}`,
  ];

  const hint = neighborhoodHint(ctx.publishedAddress ?? ctx.searchAddress);
  if (hint) lines.push(`Neighborhood hint (use to ground the local reference): ${hint}`);

  if (ctx.gmbUrl) lines.push(`Has Google Maps profile: yes`);

  if (injectBacklink) {
    const hooks = buildSeedingHooks(classified);
    if (hooks.length > 0 && voice !== "quick_asker") {
      lines.push(`Context hooks to weave in naturally (pick ONE, do not paste URLs):`);
      for (const h of hooks) lines.push(`- ${h}`);
    }
  }

  const filler = maybeNaturalnessFiller();
  if (filler && voice !== "quick_asker") {
    lines.push(`Naturalness filler (optionally drop this word in): ${filler}`);
  }

  const completion = await chatCompletion({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: SEEDING_SYSTEM_PROMPT },
      { role: "user",   content: lines.join("\n") },
    ],
    temperature: SEEDING_TEMPERATURE,
  });
  return completion.content.trim();
}

interface FollowupArgs {
  ctx:           SessionContext;
  variantText:   string;
  seedingPrompt: string;
  platform:      string | null;
  classified:    ClassifiedBacklinks;
  injectBacklink: boolean;
}

async function callFollowupLlm(args: FollowupArgs): Promise<string | null> {
  const { ctx, variantText, seedingPrompt, platform, classified, injectBacklink } = args;
  const skipChance = injectBacklink && (classified.hasGbp || classified.articles.length > 0) ? 0.2 : 0.5;
  if (Math.random() < skipChance) return null;

  const motivation = pickFollowupMotivation(classified);
  const platformHint = PLATFORM_RETRIEVAL_PHRASING[(platform ?? "").toLowerCase()];

  const lines: string[] = [
    `Business: ${ctx.bizName ?? "(unknown)"}`,
    `City: ${ctx.city ?? ""}`,
    `Keyword: ${variantText}`,
    `Motivation hint: ${motivation}`,
  ];
  if (platformHint && (motivation === "educational" || motivation === "source_request" || motivation === "freshness")) {
    lines.push(`Platform phrasing hint: ${platformHint}`);
  }
  lines.push(`Original message: ${seedingPrompt}`);

  const completion = await chatCompletion({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: FOLLOWUP_SYSTEM_PROMPT },
      { role: "user",   content: lines.join("\n") },
    ],
    temperature: FOLLOWUP_TEMPERATURE,
  });
  return completion.content.trim();
}

// ───────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────

export interface BuildSessionInput {
  keywordId: number;
  platform?: string;
  voice?:    VoiceKey;
}

export interface BuildSessionOutput {
  // identity
  keywordId:    number;
  keywordText:  string;
  clientId:     number;
  businessId:   number | null;
  campaignId:   number | null;
  platform:     string;
  // chosen variant
  variantId:    number | null;
  variantText:  string;
  variantTimesUsed: number | null;
  // chosen voice
  voice:        VoiceKey;
  // generated prompts
  prompt:       string;
  followUp:     string | null;
  hasFollowUp:  boolean;
  // backlink decision
  backlinkInjected: boolean;
  backlinkUrl:      string | null;
  backlinkType:     "gbp" | "article" | null;
  // business context (so the runner can set GPS / device locale)
  bizName:        string | null;
  city:           string | null;
  state:          string | null;
  zip:            string | null;
  searchAddress:  string | null;
  // metadata
  modelUsed: string;
}

/**
 * Build a complete session payload for one (keyword × platform) job.
 * Mirrors the executor's generate_session_prompts() top-level function.
 */
export async function buildSession(input: BuildSessionInput): Promise<BuildSessionOutput> {
  const ctx = await loadSessionContext(input.keywordId);
  if (!ctx) throw new Error(`Keyword ${input.keywordId} not found`);

  // 1. Pick variant from admin DB. If none, fall back to keyword text.
  const variant = await pickRandomVariant(input.keywordId);
  const variantText = variant?.text ?? ctx.keywordText;

  // 2. Roll backlink-injection coin
  const hasBacklinks = ctx.backlinks.length > 0;
  const injectBacklink = hasBacklinks && Math.random() < BACKLINK_INJECTION_RATE;

  // 3. Classify backlinks (only matters if we're injecting)
  const classified = classifyBacklinks(injectBacklink ? ctx.backlinks : []);

  // 4. Pick voice
  const voice = input.voice ?? pickVoice(classified);

  // 5. Generate seeding prompt
  const prompt = await callSeedingLlm({ ctx, variantText, voice, classified, injectBacklink });

  // 6. Generate follow-up (may return null = skipped)
  const followUp = await callFollowupLlm({
    ctx, variantText, seedingPrompt: prompt,
    platform: input.platform ?? null,
    classified, injectBacklink,
  });

  return {
    keywordId:        ctx.keywordId,
    keywordText:      ctx.keywordText,
    clientId:         ctx.clientId,
    businessId:       ctx.businessId,
    campaignId:       ctx.campaignId,
    platform:         (input.platform ?? "gemini").toLowerCase(),
    variantId:        variant?.id ?? null,
    variantText,
    variantTimesUsed: variant?.timesUsed ?? null,
    voice,
    prompt,
    followUp,
    hasFollowUp:      followUp != null,
    backlinkInjected: injectBacklink,
    backlinkUrl:      injectBacklink ? classified.pickedUrl : null,
    backlinkType:     injectBacklink ? classified.pickedType : null,
    bizName:          ctx.bizName,
    city:             ctx.city,
    state:            ctx.state,
    zip:              ctx.zip,
    searchAddress:    ctx.searchAddress,
    modelUsed:        "deepseek-chat",
  };
}

// Re-export prompt constants so prompt-templates.ts can mirror the
// authoritative versions instead of keeping its own copy.
export const SEEDING_SYSTEM_PROMPT_V1  = SEEDING_SYSTEM_PROMPT;
export const FOLLOWUP_SYSTEM_PROMPT_V1 = FOLLOWUP_SYSTEM_PROMPT;
