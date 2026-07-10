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
import type { Request } from "express";
import { and, between, eq, isNull, like, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/role-auth";
import {
  validateScreenshotRank,
  VisionValidationError,
} from "../lib/vision-validate";

const router = Router();

const SCAN_BATCH_SIZE = 25;
const SCAN_CONCURRENCY = 6;

/**
 * Same token check the sales/screenshot endpoint uses: accept the shared
 * READ_API_TOKEN via Bearer Authorization, x-api-key header, OR ?token= query.
 * Used to gate the device-agent-facing /verify route (no admin session).
 */
function hasValidReadToken(req: Request): boolean {
  const expected = process.env.READ_API_TOKEN ?? "";
  if (!expected) return false;
  const authz = (req.headers["authorization"] as string | undefined) ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const provided =
    bearer ||
    ((req.headers["x-api-key"] as string | undefined) ?? "").trim() ||
    (typeof req.query.token === "string" ? req.query.token.trim() : "");
  return provided === expected;
}

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
          const { verdict } = await validateScreenshotRank({
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

/**
 * POST /verify — device-agent-facing single-screenshot validation. Token-gated
 * (READ_API_TOKEN), NOT a session route, so the capture pipeline can call it
 * right after uploading. Body accepts EITHER:
 *   { rankingReportId }                             → look the row up + persist
 *   { screenshotUrl, businessName, rankingPosition } → ad-hoc, no persistence
 */
router.post("/verify", async (req, res) => {
  if (!hasValidReadToken(req)) return res.status(401).send("unauthorized");

  try {
    const body = (req.body ?? {}) as {
      rankingReportId?: unknown;
      screenshotUrl?: unknown;
      businessName?: unknown;
      rankingPosition?: unknown;
    };

    let rankingReportId: number | null = null;
    let rankingPosition: number;
    let screenshotUrl: string;
    let businessName: string;

    if (body.rankingReportId !== undefined) {
      const id = Number(body.rankingReportId);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid rankingReportId" });
      }
      const [row] = await db
        .select({
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
        .where(eq(rankingReportsTable.id, id))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Not found" });
      if (
        row.rankingPosition == null ||
        !row.screenshotUrl ||
        !row.businessName
      ) {
        return res
          .status(400)
          .json({ error: "Row missing rank, screenshot, or business name" });
      }
      rankingReportId = id;
      rankingPosition = row.rankingPosition;
      screenshotUrl = row.screenshotUrl;
      businessName = row.businessName;
    } else {
      const position = Number(body.rankingPosition);
      if (
        typeof body.screenshotUrl !== "string" ||
        !body.screenshotUrl.trim() ||
        typeof body.businessName !== "string" ||
        !body.businessName.trim() ||
        !Number.isInteger(position)
      ) {
        return res.status(400).json({
          error:
            "Provide rankingReportId, or screenshotUrl + businessName + rankingPosition",
        });
      }
      rankingPosition = position;
      screenshotUrl = body.screenshotUrl.trim();
      businessName = body.businessName.trim();
    }

    const { verdict, inList, position } = await validateScreenshotRank({
      rankingPosition,
      screenshotUrl,
      businessName,
    });

    let updated = false;
    if (rankingReportId !== null) {
      await db
        .update(rankingReportsTable)
        .set({ screenshotRankVisible: verdict })
        .where(eq(rankingReportsTable.id, rankingReportId));
      updated = true;
    }

    res.json({ valid: verdict, inList, position, rankingPosition, updated });
  } catch (err) {
    if (err instanceof VisionValidationError) {
      req.log.warn({ err }, "Screenshot verify: could not validate");
      return res.status(502).json({ error: "Vision validation failed" });
    }
    req.log.error({ err }, "Error verifying screenshot");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
