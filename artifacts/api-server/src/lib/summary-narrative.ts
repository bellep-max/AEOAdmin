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

function scopeIdOf(report: SummaryReport, clientId: number): number {
  if (report.scope === "campaign" && report.aeoPlanId != null)
    return report.aeoPlanId;
  if (report.scope === "business" && report.businessId != null)
    return report.businessId;
  return clientId;
}

/** Stable hash of the inputs that would change the prose. `v` is bumped when the
 *  cached payload shape changes so old rows (pre-Overview) miss and regenerate. */
function contentHash(report: SummaryReport): string {
  const shape = {
    v: 2,
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
  "You explain an AI-search ranking Summary Report in plain English to a business owner. " +
  "This report measures how often the business shows up when people ask AI assistants (ChatGPT, Gemini, Perplexity) for businesses like theirs; a position closer to #1 means it appears nearer the top of the AI's answer. " +
  "Write a SEPARATE short explanation for each part. Respond with ONLY a JSON object (no markdown, no code fences) with exactly these string keys:\n" +
  '- "overall": 1-2 sentences on overall standing — phrases tracked, how many reached the top 3, average position and direction.\n' +
  '- "trend": 1-2 sentences on how the ranking has moved since the comparison point.\n' +
  '- "movers": 1-2 sentences naming one or two of the largest improvements. If none, say progress is holding steady.\n' +
  '- "platforms": 1-2 sentences on how visibility differs across the AI assistants. If no per-assistant data, return "".\n' +
  '- "locked": 1-2 sentences on phrases that were won and locked in, and that a fresh phrase rotates in next. If none, return "".\n' +
  '- "declines": 1-2 sentences, honest but reassuring, on phrases that slipped and are being worked back up. If none, return "".\n' +
  "Plain English, warm and encouraging but honest, addressed as 'you' / 'your business'. No markdown inside values. Do not invent numbers beyond the ones given.";

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
      temperature: 0.4,
      maxTokens: 640,
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
    sections = { ...EMPTY_SECTIONS, overall: raw };
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
