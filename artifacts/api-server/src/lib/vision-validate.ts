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

const SYSTEM_PROMPT = `You are shown a screenshot of an AI assistant answer that recommends local businesses, usually as a NUMBERED LIST (1., 2., 3., ...), sometimes with a burned-in "[RANK: X/Y]" footer and a narrative paragraph. Consider spelling/format variations when matching the tracked business (e.g. "Jenhaug" == "Jennifer Haug"). A business only mentioned in a paragraph but NOT as a numbered list entry is NOT "in the list".`;

function buildUserPrompt(businessName: string): string {
  return `Tracked business: "${businessName}". Return ONLY strict minified JSON: {"trackedInList":true|false,"trackedPosition":<int or null>,"trackedNamedAs":"<how shown or ABSENT>","burnedRankLabel":"<X/Y or null>"}`;
}

interface VisionVerdictJson {
  trackedInList?: boolean;
  trackedPosition?: number | string | null;
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

/**
 * Validates ONE ranking_reports row against its top-3 screenshot. Returns
 * true iff the tracked business is a numbered-list entry at exactly
 * `rankingPosition`; false if it's absent or at a different position.
 * Throws VisionValidationError on any failure to get a usable verdict.
 */
export async function validateScreenshotRank(params: {
  rankingPosition: number;
  screenshotUrl: string;
  businessName: string;
}): Promise<boolean> {
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
    const position = Number(parsed.trackedPosition);
    return inList && position === params.rankingPosition;
  }
  throw new VisionValidationError("rate limited after 3 attempts");
}
