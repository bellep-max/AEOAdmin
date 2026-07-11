/**
 * @file vision-validate.ts
 *
 * Vision-model validator for top-3 ranking screenshots. Ports the prompt and
 * verdict logic from scripts/validate-screenshot-ranks-vision.mjs so the
 * admin panel's "Scan screenshots" button can validate rows on demand instead
 * of only via the standalone script.
 *
 * A ranking_reports row's screenshot_rank_visible is true iff the tracked
 * business appears as a NUMBERED LIST entry (not just narrative prose) at
 * exactly its claimed ranking_position.
 */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const MODEL = "qwen/qwen3-vl-8b-instruct";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

const SYSTEM_PROMPT = `You are shown a screenshot of an AI assistant answer that recommends local businesses. It usually contains a NUMBERED LIST (1., 2., 3., ...), sometimes a burned-in "[RANK: X/Y]" footer, and a narrative/summary paragraph.

Judge the tracked business by its EXACT name. Minor punctuation, casing or spacing differences are fine, but a DIFFERENT business with a similar or partially-overlapping name is NOT a match (e.g. "Crown Roofing" is NOT "Crown Industrial Roofing"; "Mend Spa" is NOT "Mend - Grapevine").

Report TWO things:
1. trackedInList / trackedPosition: whether the tracked business appears as a genuine NUMBERED LIST ENTRY and at which position. Do NOT count it as "in the list" when it appears only in a narrative/summary sentence (e.g. "X ranks around position 4", "X is an emerging presence").
2. listKind — classify the numbered list itself:
   - "ranking": a genuine ORDERED ranking of businesses where the item number reflects the business's rank (best first).
   - "unordered": the numbered list is NOT a ranking — it says "in no particular order", is an illustrative/example/typical-options set, is a verification or how-to CHECKLIST (e.g. "1. Check if X appears in the top results", "steps to verify..."), or each item carries its OWN separate "[RANK: x/y]" label so the list order does not reflect rank.
   - "none": there is no numbered list of businesses (narrative/prose only).

The item's list order is only meaningful as a rank when listKind is "ranking". Do NOT infer a good position from mere list order when the list is "unordered".`;

function buildUserPrompt(businessName: string): string {
  return `Tracked business: "${businessName}". Return ONLY strict minified JSON: {"trackedInList":true|false,"trackedPosition":<int or null>,"listKind":"ranking"|"unordered"|"none","trackedNamedAs":"<how shown or ABSENT>","burnedRankLabel":"<X/Y or null>"}`;
}

export type ListKind = "ranking" | "unordered" | "none" | "unknown";

function normalizeListKind(raw: unknown): ListKind {
  const v = String(raw ?? "").toLowerCase();
  if (v === "ranking" || v === "unordered" || v === "none") return v;
  return "unknown";
}

interface VisionVerdictJson {
  trackedInList?: boolean;
  trackedPosition?: number | string | null;
  listKind?: unknown;
}

function parseVisionResponse(
  text: string | undefined | null,
): VisionVerdictJson | null {
  if (!text) return null;
  const match = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as VisionVerdictJson;
  } catch {
    return null;
  }
}

/** Thrown when a row can't be classified (missing key, bad screenshot ref,
 *  rate-limited, unparseable model output). Callers should leave the row's
 *  screenshot_rank_visible unchanged and let it retry on the next scan. */
export class VisionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionValidationError";
  }
}

/** Result of one screenshot validation.
 *  - `verdict`: the screenshot_rank_visible value to persist — true iff the
 *    screenshot genuinely shows the business at its EFFECTIVE rank (the stored
 *    rank, or `correctedRank` when set).
 *  - `inList` / `position` / `listKind`: what the model actually saw.
 *  - `correctedRank`: a SAFE downgrade to apply to ranking_position, or null.
 *    Only set when the answer is a genuine ranking AND the business's real list
 *    position is WORSE than the stored (AI-self-reported) rank — i.e. the stored
 *    rank was inflated. Never an upgrade: a "better" vision read is not trusted
 *    (checklist/illustrative first-item traps), so it never mutates the rank. */
export interface VisionVerdict {
  verdict: boolean;
  inList: boolean;
  position: number | null;
  listKind: ListKind;
  correctedRank: number | null;
}

/**
 * Validates ONE ranking_reports row against its screenshot and, when the stored
 * rank is an inflated self-report, computes a safe downgrade correction.
 *
 * `verdict` (screenshot_rank_visible) is true iff the screenshot is a genuine
 * ranking that shows the business at its effective rank. `correctedRank` is a
 * worse-than-stored genuine list position to write back to ranking_position, or
 * null. Throws VisionValidationError on any failure to get a usable verdict.
 */
export async function validateScreenshotRank(params: {
  rankingPosition: number;
  screenshotUrl: string;
  businessName: string;
}): Promise<VisionVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new VisionValidationError("OPENROUTER_API_KEY not configured");
  }

  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(params.screenshotUrl);
  if (!match) {
    throw new VisionValidationError("bad screenshot reference");
  }
  const [, bucket, key] = match;

  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) {
    throw new VisionValidationError("empty screenshot body");
  }
  const base64 = Buffer.from(await obj.Body.transformToByteArray()).toString(
    "base64",
  );

  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: 400,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: buildUserPrompt(params.businessName) },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${base64}` },
          },
        ],
      },
    ],
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (response.status === 429 || response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = parseVisionResponse(json?.choices?.[0]?.message?.content);
    if (!parsed) {
      throw new VisionValidationError("could not parse model response");
    }
    const inList = parsed.trackedInList === true;
    const rawPosition = Number(parsed.trackedPosition);
    const position = Number.isFinite(rawPosition) ? rawPosition : null;
    const listKind = normalizeListKind(parsed.listKind);
    const genuineRanking = listKind === "ranking";

    // The stored rank is the AI's self-reported "[RANK: X/Y]" number, which it
    // routinely inflates (narrates "#1" while the business is really list item
    // #3, or only in prose). Only a GENUINE ranking's list position is a
    // trustworthy rank. Correction policy is deliberately ASYMMETRIC:
    //   - worse real position than stored  -> de-inflate (safe, monotonic).
    //   - better real position than stored -> DO NOT trust (checklist /
    //     "no particular order" / illustrative first-item traps upgrade #19->#1);
    //     hold the row instead of fabricating a better rank.
    let verdict = false;
    let correctedRank: number | null = null;
    if (genuineRanking && inList && position !== null) {
      if (position === params.rankingPosition) {
        verdict = true;
      } else if (position > params.rankingPosition) {
        correctedRank = position;
        verdict = true; // screenshot matches the corrected (worse) rank
      }
    }
    return { verdict, inList, position, listKind, correctedRank };
  }
  throw new VisionValidationError("rate limited after 3 attempts");
}
