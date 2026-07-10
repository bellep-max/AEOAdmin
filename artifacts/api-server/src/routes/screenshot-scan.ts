/**
 * @file screenshot-scan.ts
 * @route /api/screenshot-scan
 *
 * Admin-only "Scan screenshots" tool. New top-3 ranking screenshots arrive
 * with screenshot_rank_visible = NULL and are held from surfacing (sales
 * proof, portal, etc.) until a vision model confirms the tracked business is
 * actually in the numbered list at the claimed position. This endpoint lets
 * an admin run that validation from the Rankings page instead of only via
 * scripts/validate-screenshot-ranks-vision.mjs.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  rankingReportsTable,
  keywordsTable,
  businessesTable,
  clientsTable,
} from "@workspace/db/schema";
import { and, between, eq, isNull, like, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/role-auth";
import {
  validateScreenshotRank,
  VisionValidationError,
} from "../lib/vision-validate";

const router = Router();

const SCAN_BATCH_SIZE = 25;
const SCAN_CONCURRENCY = 6;

/** Shared WHERE clause: unscanned ranked rows (1–50, so both before and
 *  after screenshots at any rank get validated) with an S3 screenshot. */
const UNSCANNED_CONDITIONS = and(
  isNull(rankingReportsTable.screenshotRankVisible),
  between(rankingReportsTable.rankingPosition, 1, 50),
  like(rankingReportsTable.screenshotUrl, "s3://%"),
);

router.get("/unscanned-count", requireAdmin, async (req, res) => {
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rankingReportsTable)
      .where(UNSCANNED_CONDITIONS);
    res.json({ count: row?.count ?? 0 });
  } catch (err) {
    req.log.error({ err }, "Error counting unscanned screenshots");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/scan", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: rankingReportsTable.id,
        rankingPosition: rankingReportsTable.rankingPosition,
        screenshotUrl: rankingReportsTable.screenshotUrl,
        businessName: sql<
          string | null
        >`COALESCE(${businessesTable.name}, ${clientsTable.businessName})`,
      })
      .from(rankingReportsTable)
      .innerJoin(
        keywordsTable,
        eq(keywordsTable.id, rankingReportsTable.keywordId),
      )
      .leftJoin(
        businessesTable,
        eq(businessesTable.id, keywordsTable.businessId),
      )
      .leftJoin(clientsTable, eq(clientsTable.id, keywordsTable.clientId))
      .where(UNSCANNED_CONDITIONS)
      .orderBy(rankingReportsTable.id)
      .limit(SCAN_BATCH_SIZE);

    let scanned = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        if (
          row.rankingPosition == null ||
          !row.screenshotUrl ||
          !row.businessName
        ) {
          continue;
        }
        try {
          const verdict = await validateScreenshotRank({
            rankingPosition: row.rankingPosition,
            screenshotUrl: row.screenshotUrl,
            businessName: row.businessName,
          });
          await db
            .update(rankingReportsTable)
            .set({ screenshotRankVisible: verdict })
            .where(eq(rankingReportsTable.id, row.id));
          scanned++;
        } catch (err) {
          if (err instanceof VisionValidationError) {
            req.log.warn(
              { err, rankingReportId: row.id },
              "Screenshot scan: row left unscanned",
            );
          } else {
            throw err;
          }
        }
      }
    }
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, () => worker()));

    const [remainingRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rankingReportsTable)
      .where(UNSCANNED_CONDITIONS);

    res.json({ scanned, remaining: remainingRow?.count ?? 0 });
  } catch (err) {
    req.log.error({ err }, "Error scanning screenshots");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
