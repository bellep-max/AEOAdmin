/**
 * CRM proof export. Turns a qualifying top-3 ranking into the proof artifacts
 * the CRM polls for: a screenshot + manifest under a stable, ID-keyed S3 path.
 *
 * Source of truth is `ranking_reports` (rank + screenshot already exist); this
 * just copies the screenshot into the proof path and writes manifest.json.
 *
 * Qualification (all required):
 *   - client was created from the CRM free-trial flow (clients.brand set)
 *   - ranking_position is 1, 2, or 3
 *   - keyword is non-branded (does not contain the business name)
 *   - a source screenshot exists in S3
 *
 * One proof per (keyword, date): the best-ranked platform wins, so the path
 * stays `.../keywords/{keywordId}/{date}/screenshot.png` (platform in manifest).
 */
import {
  S3Client,
  CopyObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { db } from "@workspace/db";
import {
  rankingReportsTable,
  clientsTable,
  keywordsTable,
} from "@workspace/db/schema";
import { and, asc, between, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const PROOF_BUCKET = process.env.PROOF_BUCKET ?? "aeo-rank-screenshots";
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

export interface ProofManifest {
  brand: string;
  leadRef: string | null;
  proofClientSlug: string | null;
  clientId: number;
  businessId: number | null;
  campaignId: number | null;
  keywordId: number;
  keyword: string;
  platform: string | null;
  rank: number;
  capturedAt: string;
  screenshotKey: string;
}

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri.trim());
  return m ? { bucket: m[1], key: m[2] } : null;
}

/** A keyword is branded if it contains the business name (apostrophes ignored). */
export function isBranded(keyword: string, businessName: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/['’]/g, "").replace(/\s+/g, " ").trim();
  const kw = norm(keyword);
  const biz = norm(businessName);
  return biz.length > 0 && kw.includes(biz);
}

export function proofPrefix(p: {
  brand: string;
  clientId: number;
  campaignId: number | null;
  keywordId: number;
  date: string;
}): string {
  return `${p.brand}/clients/${p.clientId}/campaigns/${p.campaignId ?? "none"}/keywords/${p.keywordId}/${p.date}`;
}

/** The proof screenshot S3 key (where screenshot.png is written). */
export function proofScreenshotKey(p: {
  brand: string;
  clientId: number;
  campaignId: number | null;
  keywordId: number;
  date: string;
}): string {
  return `${proofPrefix(p)}/screenshot.png`;
}

/**
 * Generate (or refresh) the proof for one keyword on one date by selecting the
 * best top-3 capture. No-ops (returns null) when nothing qualifies. Safe to
 * call repeatedly — overwriting the same keys is idempotent.
 */
export async function writeProofForKeywordDate(
  keywordId: number,
  date: string,
): Promise<{ key: string; manifest: ProofManifest } | null> {
  // Best top-3 capture for this keyword/date, with client + keyword context.
  const rows = await db
    .select({
      clientId: rankingReportsTable.clientId,
      businessId: rankingReportsTable.businessId,
      keyword: rankingReportsTable.keyword,
      platform: rankingReportsTable.platform,
      rank: rankingReportsTable.rankingPosition,
      timestamp: rankingReportsTable.timestamp,
      createdAt: rankingReportsTable.createdAt,
      screenshotUrl: rankingReportsTable.screenshotUrl,
      brand: clientsTable.brand,
      leadRef: clientsTable.leadRef,
      slug: clientsTable.slug,
      businessName: clientsTable.businessName,
      campaignId: keywordsTable.aeoPlanId,
      keywordText: keywordsTable.keywordText,
    })
    .from(rankingReportsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, rankingReportsTable.clientId))
    .innerJoin(
      keywordsTable,
      eq(keywordsTable.id, rankingReportsTable.keywordId),
    )
    .where(
      and(
        eq(rankingReportsTable.keywordId, keywordId),
        eq(rankingReportsTable.date, date),
        between(rankingReportsTable.rankingPosition, 1, 3),
      ),
    )
    .orderBy(asc(rankingReportsTable.rankingPosition));

  // Only CRM free-trial clients (brand set) with a real S3 screenshot qualify.
  const best = rows.find(
    (r) =>
      r.brand &&
      r.screenshotUrl &&
      parseS3Uri(r.screenshotUrl) &&
      r.keyword &&
      !isBranded(r.keyword, r.businessName ?? ""),
  );
  if (!best) return null;

  const src = parseS3Uri(best.screenshotUrl as string)!;
  const prefix = proofPrefix({
    brand: best.brand as string,
    clientId: best.clientId,
    campaignId: best.campaignId,
    keywordId,
    date,
  });
  const screenshotKey = `${prefix}/screenshot.png`;
  const manifestKey = `${prefix}/manifest.json`;
  const capturedAt = (
    best.timestamp ??
    best.createdAt ??
    new Date()
  ).toISOString();

  const manifest: ProofManifest = {
    brand: best.brand as string,
    leadRef: best.leadRef ?? null,
    proofClientSlug: best.slug ?? null,
    clientId: best.clientId,
    businessId: best.businessId ?? null,
    campaignId: best.campaignId ?? null,
    keywordId,
    keyword: best.keyword as string,
    platform: best.platform ?? null,
    rank: best.rank as number,
    capturedAt,
    screenshotKey,
  };

  // Copy the existing screenshot into the proof path, then write the manifest.
  await s3.send(
    new CopyObjectCommand({
      Bucket: PROOF_BUCKET,
      CopySource: `/${src.bucket}/${src.key}`,
      Key: screenshotKey,
      ContentType: "image/png",
      MetadataDirective: "REPLACE",
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: PROOF_BUCKET,
      Key: manifestKey,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: "application/json",
    }),
  );

  return { key: screenshotKey, manifest };
}

/** Fire-and-forget wrapper for the ranking-report write path. Never throws. */
export function exportProofIfQualifies(
  keywordId: unknown,
  date: unknown,
): void {
  const kid = Number(keywordId);
  if (!Number.isInteger(kid) || typeof date !== "string" || !date) return;
  writeProofForKeywordDate(kid, date)
    .then((r) => {
      if (r)
        logger.info({ keywordId: kid, date, key: r.key }, "proof exported");
    })
    .catch((err) =>
      logger.warn({ err, keywordId: kid, date }, "proof export failed"),
    );
}
