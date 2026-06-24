/*
 * POST /api/ingest/job — unified per-job ingestion for the executor.
 *
 * The executor calls this the moment a job SUCCEEDS, pushing one result straight
 * into the admin. It validates ("checking"), de-duplicates, writes, and returns
 * a clear verdict so the executor can log / retry intelligently:
 *
 *   200 { status: "duplicate", ... }   already imported — no-op
 *   201 { status: "imported",  ... }   written
 *   422 { status: "rejected",  reason } failed a check (bad/missing data)
 *   500 { status: "error",     reason } unexpected
 *
 * kind="daily"   → sessions          (dedup on keyword_id + platform + timestamp)
 * kind="ranking" → ranking_reports   (upsert per keyword_id + platform + date)
 *                  + audit_logs       (append, dedup on keyword_id + platform + timestamp)
 *
 * Screenshots: the executor uploads the PNG to S3 itself and passes the
 * `s3://…` URI as `screenshotUrl` — we only validate + record it.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  sessionsTable,
  rankingReportsTable,
  auditLogsTable,
  keywordsTable,
} from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireExecutorToken } from "../middlewares/executor-auth";
import { exportProofIfQualifies } from "../services/proof-export";
import { rotateWinners, TOP3_THRESHOLD } from "../services/keyword-rotation";
import { logger } from "../lib/logger";

const router = Router();

const PLATFORMS = new Set(["chatgpt", "gemini", "perplexity"]);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const FRESH_WINDOW_DAYS = 7;

type Body = Record<string, unknown>;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function deriveDate(body: Body): string | null {
  const d = str(body.date);
  if (d && YMD.test(d)) return d;
  const ts = str(body.timestamp);
  if (ts && ts.length >= 10 && YMD.test(ts.slice(0, 10)))
    return ts.slice(0, 10);
  return null;
}

/* Parse the executor's timestamp as UTC. A naive timestamp ("2026-06-08T08:01:57"
 * or "2026-06-08 08:01:57") is treated as UTC by appending "Z" — these columns
 * are TZ-naive and the producer emits UTC, so this keeps the stored value (and
 * the dedup comparison) stable regardless of whether the client sent a Z. */
function toUtcDate(raw: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim().replace(" ", "T");
  const withTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const d = new Date(withTz);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* Mirror of ranking-reports' lock-on-sustained-win guard: OFF unless
 * AUTO_ROTATION_ENABLED, never fires on stale/back-filled dates, fire-and-forget. */
function maybeAutoLock(
  keywordId: number,
  rankingPosition: number | null,
  reportDate: string,
): void {
  if (!process.env.AUTO_ROTATION_ENABLED) return;
  if (process.env.AUTO_ROTATION_DISABLED) return;
  if (
    rankingPosition == null ||
    rankingPosition < 1 ||
    rankingPosition > TOP3_THRESHOLD
  )
    return;
  const t = Date.parse(reportDate);
  if (Number.isNaN(t)) return;
  const ageDays = (Date.now() - t) / 86_400_000;
  if (ageDays > FRESH_WINDOW_DAYS || ageDays < -1) return;
  rotateWinners({ keywordId, dryRun: false }).catch((err) =>
    logger.warn({ err, keywordId }, "ingest auto-rotation failed"),
  );
}

router.post("/job", requireExecutorToken, async (req, res) => {
  const reject = (reason: string) =>
    res.status(422).json({ status: "rejected", reason });
  try {
    const body = (req.body ?? {}) as Body;

    // ── universal checks ──────────────────────────────────────────────────
    const kind = String(body.kind ?? "").toLowerCase();
    if (kind !== "daily" && kind !== "ranking")
      return reject("kind must be 'daily' or 'ranking'");

    const platform = (
      str(body.platform) ??
      str(body.aiPlatform) ??
      ""
    ).toLowerCase();
    if (!PLATFORMS.has(platform))
      return reject(
        `platform must be chatgpt/gemini/perplexity (got '${platform || "none"}')`,
      );

    const date = deriveDate(body);
    if (!date)
      return reject(
        "a valid 'date' (YYYY-MM-DD) or ISO 'timestamp' is required",
      );

    const ts = toUtcDate(str(body.timestamp));
    if (str(body.timestamp) && ts == null)
      return reject("timestamp is not a valid date");

    const status = str(body.status)?.toLowerCase() ?? null;

    // ── resolve + validate keyword ────────────────────────────────────────
    let keywordId = numOrNull(body.keywordId);
    if (keywordId == null && str(body.keyword)) {
      const campaignId = numOrNull(body.campaignId);
      const [hit] = await db
        .select({ id: keywordsTable.id })
        .from(keywordsTable)
        .where(
          and(
            sql`lower(${keywordsTable.keywordText}) = ${(str(body.keyword) as string).toLowerCase()}`,
            campaignId != null
              ? eq(keywordsTable.aeoPlanId, campaignId)
              : sql`true`,
          ),
        )
        .limit(1);
      keywordId = hit?.id ?? null;
    }
    if (keywordId == null)
      return reject(
        "keyword unresolved — provide keywordId, or keyword + campaignId",
      );

    const [kw] = await db
      .select({
        id: keywordsTable.id,
        clientId: keywordsTable.clientId,
        businessId: keywordsTable.businessId,
        aeoPlanId: keywordsTable.aeoPlanId,
      })
      .from(keywordsTable)
      .where(eq(keywordsTable.id, keywordId))
      .limit(1);
    if (!kw) return reject(`keywordId ${keywordId} does not exist`);

    const clientId = numOrNull(body.clientId) ?? kw.clientId;
    const businessId = numOrNull(body.businessId) ?? kw.businessId;

    // ══════════════════════════ DAILY ════════════════════════════════════
    if (kind === "daily") {
      if (status && status !== "success")
        return reject(
          `daily ingest accepts successful jobs only (got '${status}')`,
        );

      if (ts) {
        const [dup] = await db
          .select({ id: sessionsTable.id })
          .from(sessionsTable)
          .where(
            and(
              eq(sessionsTable.keywordId, keywordId),
              eq(sessionsTable.aiPlatform, platform),
              eq(sessionsTable.timestamp, ts),
            ),
          )
          .limit(1);
        if (dup)
          return res.json({
            status: "duplicate",
            kind,
            id: dup.id,
            keywordId,
            platform,
            date,
          });
      }

      const [session] = await db
        .insert(sessionsTable)
        .values({
          clientId,
          businessId,
          campaignId: kw.aeoPlanId,
          keywordId,
          clientName: str(body.clientName),
          bizName: str(body.bizName),
          campaignName: str(body.campaignName),
          keywordText: str(body.keyword) ?? str(body.keywordText),
          keywordVariant: str(body.keywordVariant),
          date,
          timestamp: ts ?? undefined,
          durationSeconds: numOrNull(body.durationSeconds),
          promptText: str(body.prompt) ?? str(body.promptText),
          followupText: str(body.followUp) ?? str(body.followupText),
          hasFollowUp: Boolean(body.hasFollowUp),
          status: "success",
          type: str(body.type) ?? "aeo",
          aiPlatform: platform,
          deviceIdentifier: str(body.deviceIdentifier) ?? str(body.deviceId),
          mockedLatitude: numOrNull(body.mockedLatitude),
          mockedLongitude: numOrNull(body.mockedLongitude),
          mockedTimezone: str(body.mockedTimezone),
          backlinksExpected: numOrNull(body.backlinksExpected) ?? 0,
          backlinkInjected: Boolean(body.backlinkInjected),
          backlinkFound: Boolean(body.backlinkFound),
          backlinkUrl: str(body.backlinkUrl),
        })
        .returning({ id: sessionsTable.id });

      if (Boolean(body.backlinkFound)) {
        await db
          .update(keywordsTable)
          .set({
            backlinkClickCount30Days: sql`COALESCE(${keywordsTable.backlinkClickCount30Days}, 0) + 1`,
            backlinkClickCountLife: sql`COALESCE(${keywordsTable.backlinkClickCountLife}, 0) + 1`,
          })
          .where(eq(keywordsTable.id, keywordId));
      }

      return res.status(201).json({
        status: "imported",
        kind,
        id: session.id,
        keywordId,
        platform,
        date,
      });
    }

    // ══════════════════════════ RANKING ══════════════════════════════════
    const rankingPosition =
      numOrNull(body.rankingPosition) ?? numOrNull(body.rankPosition);
    // ranking_reports.rankingTotal is TEXT; audit_logs.rankTotal is numeric.
    const rankTotalNum =
      numOrNull(body.rankTotal) ?? numOrNull(body.rankingTotal);
    const rankingTotalText =
      str(body.rankingTotal) ??
      str(body.rankTotal) ??
      (rankTotalNum != null ? String(rankTotalNum) : null);
    const screenshotUrl = str(body.screenshotUrl) ?? str(body.screenshotS3Uri);
    if (screenshotUrl && !screenshotUrl.startsWith("s3://"))
      return reject("screenshotUrl must be an s3:// URI");

    const durationSeconds = numOrNull(body.durationSeconds);

    const rrValues = {
      clientId,
      businessId,
      keywordId,
      keyword: str(body.keyword),
      keywordVariant: str(body.keywordVariant),
      timestamp: ts,
      date,
      platform,
      deviceIdentifier: str(body.deviceIdentifier) ?? str(body.deviceId),
      status,
      durationSeconds,
      rankingPosition,
      rankingTotal: rankingTotalText,
      isInitialRanking: Boolean(body.isInitialRanking),
      ...(screenshotUrl ? { screenshotUrl } : {}),
    };

    const [existing] = await db
      .select({ id: rankingReportsTable.id })
      .from(rankingReportsTable)
      .where(
        and(
          eq(rankingReportsTable.keywordId, keywordId),
          eq(rankingReportsTable.platform, platform),
          eq(rankingReportsTable.date, date),
        ),
      )
      .limit(1);

    let action: "inserted" | "updated";
    let id: number;
    if (existing) {
      const [u] = await db
        .update(rankingReportsTable)
        .set(rrValues)
        .where(eq(rankingReportsTable.id, existing.id))
        .returning({ id: rankingReportsTable.id });
      action = "updated";
      id = u.id;
    } else {
      const [ins] = await db
        .insert(rankingReportsTable)
        .values(rrValues)
        .returning({ id: rankingReportsTable.id });
      action = "inserted";
      id = ins.id;
    }

    // audit_logs: append unless this exact run is already logged
    let auditAppended = false;
    if (ts) {
      const [adup] = await db
        .select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.keywordId, keywordId),
            eq(auditLogsTable.platform, platform),
            eq(auditLogsTable.timestamp, ts),
          ),
        )
        .limit(1);
      if (!adup) {
        await db.insert(auditLogsTable).values({
          clientId,
          businessId,
          campaignId: kw.aeoPlanId,
          keywordId,
          timestamp: ts,
          keywordText: str(body.keyword),
          keywordVariant: str(body.keywordVariant),
          platform,
          status,
          durationSeconds,
          rankPosition: rankingPosition,
          rankTotal: rankTotalNum,
          mentioned: str(body.mentioned),
          rankContext: str(body.rankContext),
          screenshotPath: screenshotUrl ?? str(body.screenshotPath),
          responseText: str(body.responseText),
          prompt: str(body.prompt),
          error: str(body.error),
        });
        auditAppended = true;
      }
    }

    maybeAutoLock(keywordId, rankingPosition, date);
    exportProofIfQualifies(keywordId, date);

    return res.status(existing ? 200 : 201).json({
      status: "imported",
      kind,
      action,
      id,
      keywordId,
      platform,
      date,
      screenshot: screenshotUrl ? "recorded" : "none",
      auditAppended,
    });
  } catch (err) {
    req.log.error({ err }, "ingest job error");
    return res
      .status(500)
      .json({ status: "error", reason: "internal server error" });
  }
});

export default router;
