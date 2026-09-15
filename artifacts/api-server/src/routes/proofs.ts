/**
 * GET /api/proofs — CRM-facing read of qualifying top-3 proofs.
 *
 * Same data the S3 manifests carry, served as JSON so the CRM can poll an API
 * instead of listing S3. Token-gated with the shared free-trial token.
 *
 * Query params (all optional): brand, leadRef, clientId, since (YYYY-MM-DD),
 * limit (default 500). Returns one proof per (keyword, date) — best rank —
 * with a short-lived signed screenshot URL.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  rankingReportsTable,
  clientsTable,
  keywordsTable,
  clientAeoPlansTable,
} from "@workspace/db/schema";
import { and, asc, between, eq, gte, isNotNull } from "drizzle-orm";

const FREE_TRIAL_PLAN_TYPE = "Free Trial Plans";
const DEFAULT_BRAND = "signalaeo";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireFreeTrialToken } from "../middlewares/free-trial-auth";
import {
  isBranded,
  proofScreenshotKey,
  writeProofForKeywordDate,
} from "../services/proof-export";

const router = Router();
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri.trim());
  return m ? { bucket: m[1], key: m[2] } : null;
}

router.get("/", requireFreeTrialToken, async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit) || 500, 1), 2000);

    const conds = [
      eq(clientAeoPlansTable.planType, FREE_TRIAL_PLAN_TYPE),
      between(rankingReportsTable.rankingPosition, 1, 3),
      isNotNull(rankingReportsTable.screenshotUrl),
    ];
    if (q.brand) conds.push(eq(clientsTable.brand, q.brand));
    if (q.leadRef) conds.push(eq(clientsTable.leadRef, q.leadRef));
    if (q.email)
      conds.push(eq(clientsTable.contactEmail, q.email.toLowerCase()));
    if (q.clientId && /^\d+$/.test(q.clientId)) {
      conds.push(eq(rankingReportsTable.clientId, Number(q.clientId)));
    }
    if (q.since) conds.push(gte(rankingReportsTable.date, q.since));

    const rows = await db
      .select({
        clientId: rankingReportsTable.clientId,
        businessId: rankingReportsTable.businessId,
        keywordId: rankingReportsTable.keywordId,
        keyword: rankingReportsTable.keyword,
        platform: rankingReportsTable.platform,
        rank: rankingReportsTable.rankingPosition,
        date: rankingReportsTable.date,
        timestamp: rankingReportsTable.timestamp,
        createdAt: rankingReportsTable.createdAt,
        screenshotUrl: rankingReportsTable.screenshotUrl,
        brand: clientsTable.brand,
        leadRef: clientsTable.leadRef,
        email: clientsTable.contactEmail,
        slug: clientsTable.slug,
        businessName: clientsTable.businessName,
        campaignId: keywordsTable.aeoPlanId,
      })
      .from(rankingReportsTable)
      .innerJoin(
        clientsTable,
        eq(clientsTable.id, rankingReportsTable.clientId),
      )
      .innerJoin(
        keywordsTable,
        eq(keywordsTable.id, rankingReportsTable.keywordId),
      )
      .innerJoin(
        clientAeoPlansTable,
        eq(clientAeoPlansTable.id, keywordsTable.aeoPlanId),
      )
      .where(and(...conds))
      .orderBy(asc(rankingReportsTable.rankingPosition));

    // One proof per (keyword, date): rows are rank-ascending, so the first
    // occurrence of each pair is the best. Drop branded keywords.
    const seen = new Set<string>();
    const proofs = [];
    for (const r of rows) {
      if (!r.date || !r.keyword) continue;
      if (isBranded(r.keyword, r.businessName ?? "")) continue;
      const dedupe = `${r.keywordId}:${r.date}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const src = r.screenshotUrl ? parseS3Uri(r.screenshotUrl) : null;
      let signedUrl: string | null = null;
      if (src) {
        signedUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: src.bucket, Key: src.key }),
          { expiresIn: 3600 },
        );
      }
      const brand = r.brand ?? DEFAULT_BRAND;
      proofs.push({
        brand,
        leadRef: r.leadRef ?? null,
        email: r.email ?? null,
        proofClientSlug: r.slug ?? null,
        clientId: r.clientId,
        businessId: r.businessId ?? null,
        campaignId: r.campaignId ?? null,
        keywordId: r.keywordId,
        keyword: r.keyword,
        platform: r.platform ?? null,
        rank: r.rank,
        date: r.date,
        capturedAt: (r.timestamp ?? r.createdAt ?? new Date()).toISOString(),
        screenshotKey: proofScreenshotKey({
          brand,
          clientId: r.clientId,
          campaignId: r.campaignId,
          keywordId: r.keywordId,
          date: r.date,
        }),
        screenshotUrl: signedUrl,
      });
      if (proofs.length >= limit) break;
    }

    res.json({ ok: true, count: proofs.length, proofs });
  } catch (err) {
    req.log.error({ err }, "Error listing proofs");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/proofs/backfill — (re)write S3 proof artifacts for all qualifying
 * top-3 captures. Idempotent; safe to re-run. Optional body { since: "YYYY-MM-DD" }.
 */
router.post("/backfill", requireFreeTrialToken, async (req, res) => {
  try {
    const since =
      typeof (req.body as { since?: unknown })?.since === "string"
        ? (req.body as { since: string }).since
        : null;

    const conds = [
      eq(clientAeoPlansTable.planType, FREE_TRIAL_PLAN_TYPE),
      between(rankingReportsTable.rankingPosition, 1, 3),
      isNotNull(rankingReportsTable.screenshotUrl),
    ];
    if (since) conds.push(gte(rankingReportsTable.date, since));

    const pairs = await db
      .selectDistinct({
        keywordId: rankingReportsTable.keywordId,
        date: rankingReportsTable.date,
      })
      .from(rankingReportsTable)
      .innerJoin(
        keywordsTable,
        eq(keywordsTable.id, rankingReportsTable.keywordId),
      )
      .innerJoin(
        clientAeoPlansTable,
        eq(clientAeoPlansTable.id, keywordsTable.aeoPlanId),
      )
      .where(and(...conds));

    let written = 0;
    for (const p of pairs) {
      if (!p.date) continue;
      const r = await writeProofForKeywordDate(p.keywordId, p.date);
      if (r) written += 1;
    }
    res.json({ ok: true, candidates: pairs.length, written });
  } catch (err) {
    req.log.error({ err }, "Error backfilling proofs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
