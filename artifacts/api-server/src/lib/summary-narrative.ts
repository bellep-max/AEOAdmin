import crypto from "crypto";
import { pool } from "@workspace/db";
import { chatCompletion } from "../services/llm-client";
import { getHowAeoWorks, type HowAeoWorksStep } from "./summary-content";
import type { SummaryReport } from "../routes/portal";

/* Shared AI-narrative generator for the Summary Report. Both the portal and
   admin routes call this ONE function so the prose matches. Grounded strictly
   in the buildSummaryReport payload — the model is given the numbers and told
   not to invent any. Durable cache lives in `daily_reports` so a generated
   narrative survives App Runner restarts (unlike an in-memory Map). */

export interface NarrativeSections {
  overall: string;
  trend: string;
  movers: string;
  platforms: string;
  locked: string;
  declines: string;
}

/** One titled block of the long-form Overview write-up. `body` may hold several
 *  paragraphs, separated by "\n\n". */
export interface OverviewBlock {
  heading: string;
  body: string;
}

export interface SummaryNarrative {
  sections: NarrativeSections;
  overview: OverviewBlock[];
  howAeoWorks: HowAeoWorksStep[];
  cached: boolean;
}

const SECTION_KEYS: (keyof NarrativeSections)[] = [
  "overall",
  "trend",
  "movers",
  "platforms",
  "locked",
  "declines",
];

const EMPTY_SECTIONS: NarrativeSections = {
  overall: "",
  trend: "",
  movers: "",
  platforms: "",
  locked: "",
  declines: "",
};

/**
 * Rescue the per-section text when the model's JSON won't parse — almost always
 * because it hit the token ceiling and the object is cut off before its closing
 * brace, leaving the earlier (complete) sections perfectly usable.
 *
 * Pulls each key's string out directly. A raw JSON blob must NEVER reach the
 * report: this used to fall back to `overall: raw`, which rendered the entire
 * object — braces, quotes, every section — as one wall of text in the client's
 * summary. Any key we can't recover is simply left empty and its section hides.
 */
function salvageSections(raw: string): NarrativeSections {
  const out: NarrativeSections = { ...EMPTY_SECTIONS };
  for (const k of SECTION_KEYS) {
    // "key": "…text…"  — tolerate escaped quotes inside the value.
    const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw);
    if (!m) continue;
    try {
      out[k] = (JSON.parse(`"${m[1]}"`) as string).trim();
    } catch {
      // Unescaping failed — better to drop this section than show it mangled.
    }
  }
  return out;
}

function scopeIdOf(report: SummaryReport, clientId: number): number {
  if (report.scope === "campaign" && report.aeoPlanId != null)
    return report.aeoPlanId;
  if (report.scope === "business" && report.businessId != null)
    return report.businessId;
  return clientId;
}

/** Stable hash of the inputs that would change the prose. `v` is bumped when the
 *  cached payload shape changes so old rows (pre-Overview) miss and regenerate.
 *  v4: narratives cached before the truncation fix hold a raw JSON blob in
 *  `overall` — bump so every one of them misses and is rewritten. */
function contentHash(report: SummaryReport): string {
  const shape = {
    v: 4,
    metrics: report.metrics,
    platforms: report.platforms,
    movers: report.movers,
    locked: report.locked.map((l) => ({
      k: l.keyword,
      p: l.platforms.map((x) => `${x.platform}:${x.position}`),
    })),
    watch: report.watch.map((w) => ({
      k: w.keyword,
      p: w.latestPosition,
    })),
    declines: report.declines,
    comparison: report.comparison,
  };
  return crypto.createHash("sha1").update(JSON.stringify(shape)).digest("hex");
}

function buildFacts(report: SummaryReport): string[] {
  const m = report.metrics;
  const started =
    report.comparison === "prior-run" ? "the prior check" : "when we started";
  const facts: string[] = [
    report.date
      ? `Reporting period ends ${report.date} (movement measured against the prior check).`
      : `Reporting period: all-time (movement measured against the first-ever check).`,
    `Search phrases tracked across ChatGPT, Gemini and Perplexity: ${m.tracked} (${m.withRank} have a ranking so far).`,
    `Phrases now in the top 3: ${m.top3}.`,
    `Since ${started} — improved: ${m.improved}, slipped: ${m.declined}, steady: ${m.steady}.`,
    m.avgCurrent != null
      ? `Average position now: about #${m.avgCurrent}${m.avgFirst != null ? ` (was around #${m.avgFirst})` : ""}. Closer to #1 is better.`
      : `Average position: not enough data yet.`,
  ];
  for (const p of report.platforms) {
    if (p.avgCurrent != null)
      facts.push(
        `On ${p.label}: average position about #${p.avgCurrent}, with ${p.top3} of ${p.tracked} phrases in the top 3.`,
      );
  }
  if (report.movers.length) {
    facts.push(
      "Biggest improvements: " +
        report.movers
          .map(
            (x) =>
              `"${x.keyword}" moved from #${x.first ?? "?"} to #${x.current ?? "?"}`,
          )
          .join("; ") +
        ".",
    );
  }
  if (report.locked.length) {
    facts.push(
      "Phrases won and locked in: " +
        report.locked.map((l) => `"${l.keyword}"`).join(", ") +
        ".",
    );
  }
  if (report.watch.length) {
    facts.push(
      "Phrases being watched (stalled / on the radar): " +
        report.watch
          .map(
            (w) =>
              `"${w.keyword}"${w.latestPosition != null ? ` (latest #${w.latestPosition})` : ""}`,
          )
          .join("; ") +
        ".",
    );
  }
  if (report.declines.length) {
    facts.push(
      "Phrases that slipped (data-derived movement only): " +
        report.declines
          .map(
            (d) => `"${d.keyword}" from #${d.from ?? "?"} to #${d.to ?? "?"}`,
          )
          .join("; ") +
        ".",
    );
  }
  return facts;
}

const SYSTEM_PROMPT =
  "You are the account manager for a local business, writing a warm, personal update to the owner about how their business is showing up in AI search. When someone asks ChatGPT, Gemini or Perplexity to recommend a business like theirs, we track whether the AI names them and how near the top — position #1 means the AI mentions them first. " +
  "Write like a real person who genuinely cares about this client and wants to keep them for the long run. Be warm, confident, specific and genuinely encouraging — your job is to help them understand what's happening AND to feel great about the progress and proud to be working with us. Sound human, never like a report or a machine: no jargon, no hype, no stiff 'AI voice', and don't lean on dashes. Always connect the numbers to what they MEAN for the business — more people discovering them, trusting them, and choosing them when they ask AI for a recommendation. Keep every part constructive and motivating; frame dips as a normal, temporary part of the work that you are already actively handling, and end those on a confident, we've-got-this note. " +
  "Write in a bit more depth than a one-liner — enough to reassure and win them over, without padding. Respond with ONLY a JSON object (no markdown, no code fences) with exactly these string keys:\n" +
  '- "overall": 3-4 warm sentences on where they stand right now, what it means for getting found and chosen, and why it is worth being excited about.\n' +
  '- "trend": 2-3 sentences on which way things are moving and what that momentum means for them, kept upbeat.\n' +
  '- "movers": 3-5 sentences that really celebrate one or two phrases that climbed — name them, spell out the jump in plain terms, and paint what that win means (more customers seeing them named first, more calls and visits). If none, reassure them progress is holding steady and building.\n' +
  '- "platforms": 3-4 sentences on how they show up across ChatGPT, Gemini and Perplexity, what the differences mean, and a simple, non-technical reason the assistants can vary. If no per-assistant data, return "".\n' +
  '- "locked": 3-4 sentences on phrases they have won and are holding — reassure them these are secured and defended, celebrate the milestone, and note a fresh phrase gets worked next so momentum keeps going. If none, return "".\n' +
  '- "declines": 3-4 sentences, honest but genuinely reassuring, explaining that a few phrases eased down (completely normal as the AI varies its answers, competitors move, or content freshness shifts), that this is expected and temporary, and exactly that you already have them back in active work and expect them to recover. Leave them confident, never worried. If none, return "".\n' +
  "Address them as 'you' / 'your business'. Never invent numbers or phrase names beyond the facts given. No markdown inside values.";

const OVERVIEW_SYSTEM_PROMPT =
  "You write a long-form, client-facing Summary Overview for a business owner, explaining how their business is showing up when people ask AI assistants (ChatGPT, Gemini, Perplexity) for businesses like theirs. A position closer to #1 means they appear nearer the top of the AI's answer. " +
  'Respond with ONLY a JSON object (no markdown, no code fences) of the form { "blocks": [ { "heading": string, "body": string }, ... ] }. ' +
  "Each body may contain several sentences; separate paragraphs inside a body with a blank line (\\n\\n). Produce the blocks below, IN THIS ORDER, but SKIP any block that has no supporting data in the facts:\n" +
  '1. "Overview" — phrases tracked, how many reached the top 3, the average position and whether it is steady/up/down, and the improved/slipped/steady movement breakdown.\n' +
  '2. "Visibility by platform" — each assistant\'s standing, plus a short plain-language note on why platforms can differ (each AI weighs sources and freshness differently).\n' +
  '3. "Biggest movers" — name the top improvements, and explain briefly why jumps happen (fresh, relevant content the assistants pick up).\n' +
  '4. "Locked wins" — name the locked phrases; explain that "locked" means the top 3 was held across two checks, that we rotate a fresh phrase in to chase new ground, and the trade-off that a locked phrase can soften over time because it is no longer actively reinforced.\n' +
  '5. "Watching" — name the phrases that are stalled or on the radar, and explain that "watching" means we are keeping an eye on them and ready to act before they slip.\n' +
  '6. "Needs attention" — name the phrases that slipped and give common, reassuring reasons phrases decline (competitor gains, AI model updates, content freshness gaps, reduced reinforcement), framed as now back in active rotation.\n' +
  '7. "How it works, end to end" — walk through the pipeline in plain language: tracked phrases become variant questions, we run them on ChatGPT, Gemini and Perplexity, record the positions, then either keep watching / give needs-attention phrases more attention, or lock a win and rotate a fresh phrase in.\n' +
  '8. A final closing block titled "Our commitment" — warm, encouraging, reassuring the client we will keep working to improve their visibility and grow their business.\n' +
  "Warm, encouraging and honest, addressed as 'you' / 'your business'. Never invent numbers or phrase names beyond the facts given. No markdown syntax inside headings or bodies.";

/** Strip code fences a model sometimes wraps JSON in. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

function parseOverview(raw: string): OverviewBlock[] {
  const cleaned = stripFences(raw);
  try {
    const parsed = JSON.parse(cleaned) as { blocks?: unknown };
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    const out: OverviewBlock[] = [];
    for (const b of blocks) {
      if (b && typeof b === "object") {
        const rec = b as Record<string, unknown>;
        const heading =
          typeof rec.heading === "string" ? rec.heading.trim() : "";
        const body = typeof rec.body === "string" ? rec.body.trim() : "";
        if (heading || body) out.push({ heading, body });
      }
    }
    return out.length ? out : [{ heading: "Summary", body: cleaned }];
  } catch {
    return [{ heading: "Summary", body: cleaned }];
  }
}

interface CachedNarrative {
  sections: NarrativeSections;
  overview: OverviewBlock[];
}

async function readCache(
  scope: string,
  scopeId: number,
  reportDate: string,
  hash: string,
): Promise<CachedNarrative | null> {
  const { rows } = await pool.query(
    `SELECT input_summary, report_markdown FROM daily_reports
     WHERE scope = $1 AND scope_id = $2 AND report_date = $3
     ORDER BY generated_at DESC LIMIT 1`,
    [scope, scopeId, reportDate],
  );
  const row = rows[0];
  if (!row || !row.report_markdown) return null;
  const summary = row.input_summary as { hash?: string } | null;
  if (!summary || summary.hash !== hash) return null;
  try {
    const parsed = JSON.parse(row.report_markdown) as {
      sections?: Partial<NarrativeSections>;
      overview?: unknown;
    };
    const sectionsIn = parsed.sections ?? {};
    const sections = { ...EMPTY_SECTIONS };
    for (const k of SECTION_KEYS)
      sections[k] =
        typeof sectionsIn[k] === "string" ? (sectionsIn[k] as string) : "";
    const overview: OverviewBlock[] = Array.isArray(parsed.overview)
      ? (parsed.overview as unknown[]).flatMap((b) => {
          if (!b || typeof b !== "object") return [];
          const rec = b as Record<string, unknown>;
          return [
            {
              heading: typeof rec.heading === "string" ? rec.heading : "",
              body: typeof rec.body === "string" ? rec.body : "",
            },
          ];
        })
      : [];
    return { sections, overview };
  } catch {
    return null;
  }
}

async function writeCache(
  scope: string,
  scopeId: number,
  reportDate: string,
  hash: string,
  report: SummaryReport,
  sections: NarrativeSections,
  overview: OverviewBlock[],
  model: string,
  durationMs: number,
  costUsd: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO daily_reports
       (report_date, scope, scope_id, model_used, input_summary, report_markdown, duration_ms, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      reportDate,
      scope,
      scopeId,
      model,
      JSON.stringify({ hash, metrics: report.metrics }),
      JSON.stringify({ sections, overview }),
      Math.round(durationMs),
      costUsd.toFixed(4),
    ],
  );
}

/**
 * Generate (or return cached) plain-English narrative for a Summary Report.
 * `clientId` anchors the cache scope_id for client-level reports. `nowMs` is
 * passed in (routes use Date.now()) so this module stays deterministic.
 */
export async function generateSummaryNarrative(
  report: SummaryReport,
  clientId: number,
  nowMs: number,
): Promise<SummaryNarrative> {
  const howAeoWorks = getHowAeoWorks();

  // No ranking data yet — no AI call, no cache.
  if (report.metrics.withRank === 0) {
    const emptyMessage =
      "No ranking data has come in yet for this selection. This fills in once the tracked search phrases have been checked on the AI assistants.";
    return {
      sections: { ...EMPTY_SECTIONS, overall: emptyMessage },
      overview: [{ heading: "Overview", body: emptyMessage }],
      howAeoWorks,
      cached: false,
    };
  }

  const scope = report.scope;
  const scopeId = scopeIdOf(report, clientId);
  // daily_reports.report_date is NOT NULL, so only period-ending reports (which
  // carry a real date) use the durable cache. All-time reports regenerate.
  const cacheDate = report.date;
  const hash = contentHash(report);

  if (cacheDate) {
    const cached = await readCache(scope, scopeId, cacheDate, hash);
    if (cached)
      return {
        sections: cached.sections,
        overview: cached.overview,
        howAeoWorks,
        cached: true,
      };
  }

  const start = nowMs;
  const facts = buildFacts(report).join("\n");
  // Two calls: the short per-section blurbs and the long-form Overview. Run them
  // together so one round-trip's latency covers both.
  const [sectionsCompletion, overviewCompletion] = await Promise.all([
    chatCompletion({
      model: "deepseek-chat",
      // Six sections of 3-4 sentences each, JSON-escaped, overran 1400 and the
      // object came back without its closing brace — unparseable. Headroom here
      // is far cheaper than a salvaged (or lost) narrative.
      maxTokens: 3000,
      temperature: 0.5,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Here are this report's numbers. Return the JSON object of per-section explanations:\n\n" +
            facts,
        },
      ],
    }),
    chatCompletion({
      model: "deepseek-chat",
      temperature: 0.5,
      maxTokens: 1100,
      messages: [
        { role: "system", content: OVERVIEW_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Here are this report's numbers. Return the JSON object of Overview blocks:\n\n" +
            facts,
        },
      ],
    }),
  ]);

  const raw = stripFences(sectionsCompletion.content);
  let sections: NarrativeSections = { ...EMPTY_SECTIONS };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const k of SECTION_KEYS)
      sections[k] =
        typeof parsed[k] === "string" ? (parsed[k] as string).trim() : "";
  } catch {
    sections = salvageSections(raw);
  }

  const overview = parseOverview(overviewCompletion.content);

  if (cacheDate) {
    try {
      await writeCache(
        scope,
        scopeId,
        cacheDate,
        hash,
        report,
        sections,
        overview,
        sectionsCompletion.model,
        Date.now() - start,
        sectionsCompletion.costUsd + overviewCompletion.costUsd,
      );
    } catch {
      // Cache write is best-effort; never fail the request over it.
    }
  }

  return { sections, overview, howAeoWorks, cached: false };
}
