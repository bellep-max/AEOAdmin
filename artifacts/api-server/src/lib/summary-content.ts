import { pool } from "@workspace/db";

export const GLOSSARY_VERSION = "2026-07-09";

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  aeo: {
    term: "AEO",
    definition:
      "Answer Engine Optimization — getting your business shown when people ask AI assistants (like ChatGPT, Gemini, and Perplexity) for a business like yours.",
  },
  keyword: {
    term: "Keyword",
    definition:
      "A search phrase we track — the kind of question or term a potential customer would type into an AI assistant.",
  },
  variant: {
    term: "Variant",
    definition:
      "A natural, reworded version of a search phrase. People ask the same thing many ways, so we test several wordings to see where you show up.",
  },
  prompt: {
    term: "Prompt",
    definition:
      "The exact question we ask the AI assistant on your behalf during a check.",
  },
  platform: {
    term: "Platform",
    definition:
      "An AI assistant we measure your visibility on — ChatGPT, Gemini, or Perplexity.",
  },
  "ranking-position": {
    term: "Ranking position",
    definition:
      "Where your business appears in the AI's answer. #1 is the top spot; a lower number is better.",
  },
  "top-3": {
    term: "Top 3",
    definition:
      "Appearing in the first three results of an AI's answer — the most visible spots.",
  },
  "daily-session": {
    term: "Daily session",
    definition:
      "A single automated check, run on a real phone, that asks an AI assistant a search phrase and records where you appear.",
  },
  locked: {
    term: "Locked",
    definition:
      "A phrase you've won — it reached the top 3 on a platform for two checks in a row, so we consider it secured and rotate a fresh phrase in to work on next.",
  },
  watch: {
    term: "Watch",
    definition:
      "A phrase we're keeping an eye on because it has slipped out of the top 3 over recent checks.",
  },
};

export function getGlossaryPayload(): {
  version: string;
  terms: Record<string, GlossaryEntry>;
} {
  return { version: GLOSSARY_VERSION, terms: GLOSSARY };
}

export interface HowAeoWorksStep {
  title: string;
  body: string;
}

/** Curated, static explanation of the optimization method. Never AI-generated —
 *  this describes how AEO works in general, not the client's specific numbers. */
export const HOW_AEO_WORKS: HowAeoWorksStep[] = [
  {
    title: "We track how AI assistants answer",
    body: "For each search phrase, we ask ChatGPT, Gemini, and Perplexity on your behalf and record where your business appears in the answer. A position closer to #1 means you show up nearer the top.",
  },
  {
    title: "We test many wordings",
    body: "People ask the same thing in many ways, so for each phrase we try several natural variants. That gives a fuller picture of where you show up than a single wording would.",
  },
  {
    title: "We work phrases up the rankings",
    body: "Phrases being actively worked on are shown as active. If one slips out of the top 3 over several checks, we flag it as under watch and focus effort there.",
  },
  {
    title: "We lock in wins and rotate",
    body: "When a phrase reaches the top 3 on a platform and holds it across two checks in a row, we consider it won and lock it in, then rotate a fresh phrase in to work on next. That way effort keeps moving to where it counts.",
  },
];

export function getHowAeoWorks(): HowAeoWorksStep[] {
  return HOW_AEO_WORKS;
}

export interface AvailableDate {
  date: string;
  count: number;
}

export async function availableReportDates(
  clientId: number,
  opts: { businessId?: number | null; aeoPlanId?: number | null } = {},
): Promise<AvailableDate[]> {
  const params: unknown[] = [clientId];
  const where: string[] = [
    "rr.client_id = $1",
    "rr.status = 'success'",
    "rr.date IS NOT NULL",
  ];
  let join = "";
  if (opts.businessId != null) {
    params.push(opts.businessId);
    where.push(`rr.business_id = $${params.length}`);
  }
  if (opts.aeoPlanId != null) {
    join = "JOIN keywords k ON k.id = rr.keyword_id";
    params.push(opts.aeoPlanId);
    where.push(`k.aeo_plan_id = $${params.length}`);
  }
  const q = `SELECT rr.date AS date, count(*)::int AS count FROM ranking_reports rr ${join} WHERE ${where.join(
    " AND ",
  )} GROUP BY rr.date ORDER BY rr.date DESC`;
  const { rows } = await pool.query(q, params);
  return rows.map((r) => ({ date: String(r.date), count: Number(r.count) }));
}
