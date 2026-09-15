/**
 * Retention / status calculation engine for the Locked Keyword Monitoring
 * page. Reuses the real lock truth (keywords.status='locked', set by
 * rotateWinners in keyword-rotation.ts) and derives everything else —
 * retention rate, consecutive-absent streak, per-platform coverage, next
 * check due, and an overall status — from ranking_reports rows recorded
 * since the keyword locked.
 *
 * "Valid check" = a ranking_reports row with status='success'. 'error' rows
 * are technical failures and are excluded from retention math entirely, so
 * a bad scan can never masquerade as a ranking loss (mirrors the business
 * rule captured in admin_panel_locked_keyword_ui_fix_spec.md §13).
 */
import { db } from "@workspace/db";
import {
  keywordsTable,
  rankingReportsTable,
  clientsTable,
  businessesTable,
  clientAeoPlansTable,
} from "@workspace/db/schema";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { ROTATION_PLATFORMS, TOP3_THRESHOLD } from "./keyword-rotation";

export type Platform = (typeof ROTATION_PLATFORMS)[number];
export type LockedKeywordStatus =
  | "healthy"
  | "monitor"
  | "unlock_recommended"
  | "unlock_now"
  | "insufficient_data";

export interface PlatformCheckSummary {
  platform: Platform;
  /** Most recent VALID position on this platform since lock. null = absent. */
  latestPosition: number | null;
  latestValidCheckAt: string | null;
  /** Any row (valid or failed) recorded on this platform in the current cycle. */
  checkedInCycle: boolean;
}

export interface LockedKeywordRecord {
  id: number;
  clientId: number;
  clientName: string | null;
  businessId: number | null;
  businessName: string | null;
  city: string | null;
  state: string | null;
  aeoPlanId: number | null;
  campaignName: string | null;
  keywordText: string;
  lockedAt: string | null;
  maintenanceLevel: "minimum" | "recommended" | "custom";
  platformChecks: PlatformCheckSummary[];
  validChecks: number;
  topThreeChecks: number;
  absentChecks: number;
  totalChecksInCycle: number;
  consecutiveAbsentChecks: number;
  retentionRate: number | null;
  lastValidCheckAt: string | null;
  nextCheckDueAt: string | null;
  nextCheckDueNow: boolean;
  status: LockedKeywordStatus;
}

interface RawReport {
  keywordId: number | null;
  platform: string | null;
  status: string | null;
  rankingPosition: number | null;
  date: string | null;
  createdAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Fallback monitoring window for legacy keywords locked before lockedAt
// existed (see keywords.ts comment) — mirrors the ~14-day bi-weekly cadence
// the real lock rule already runs on.
const FALLBACK_CYCLE_DAYS = 14;

function reportTimeMs(r: RawReport): number {
  if (r.date) {
    const t = new Date(`${r.date}T00:00:00Z`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return r.createdAt ? r.createdAt.getTime() : 0;
}

function computeRecord(
  kw: {
    id: number;
    clientId: number;
    clientName: string | null;
    businessId: number | null;
    businessName: string | null;
    city: string | null;
    state: string | null;
    aeoPlanId: number | null;
    campaignName: string | null;
    keywordText: string;
    lockedAt: Date | null;
    maintenanceLevel: string | null;
  },
  reports: RawReport[],
  nowMs: number,
): LockedKeywordRecord {
  const maintenanceLevel = (kw.maintenanceLevel ?? "recommended") as LockedKeywordRecord["maintenanceLevel"];
  const cycleStartMs = kw.lockedAt ? kw.lockedAt.getTime() : nowMs - FALLBACK_CYCLE_DAYS * DAY_MS;

  const inCycle = reports.filter((r) => reportTimeMs(r) >= cycleStartMs);
  const valid = inCycle.filter((r) => r.status === "success" && r.platform);
  const validSorted = [...valid].sort((a, b) => reportTimeMs(b) - reportTimeMs(a));

  const validChecks = validSorted.length;
  const topThreeChecks = validSorted.filter(
    (r) => r.rankingPosition != null && r.rankingPosition >= 1 && r.rankingPosition <= TOP3_THRESHOLD,
  ).length;
  const absentChecks = validSorted.filter((r) => r.rankingPosition == null).length;
  const totalChecksInCycle = inCycle.length;
  const retentionRate = validChecks === 0 ? null : (topThreeChecks / validChecks) * 100;

  // Consecutive-absent: walk newest-first valid checks only. A technical
  // failure never appears here (it was filtered out of `valid` above), so it
  // can neither start nor break a streak — matches spec Scenario E.
  let consecutiveAbsentChecks = 0;
  for (const r of validSorted) {
    if (r.rankingPosition == null) consecutiveAbsentChecks++;
    else break;
  }

  const lastValidCheckAt = validSorted[0] ? new Date(reportTimeMs(validSorted[0])).toISOString() : null;
  const intervalDays = maintenanceLevel === "minimum" ? 14 : 7;

  let nextCheckDueAt: string | null = null;
  let nextCheckDueNow = false;
  const platformChecks: PlatformCheckSummary[] = ROTATION_PLATFORMS.map((platform) => {
    const platValid = validSorted.filter((r) => r.platform === platform);
    const platAny = inCycle.filter((r) => r.platform === platform);
    const latest = platValid[0] ?? null;
    const checkedInCycle = platAny.length > 0;
    if (!checkedInCycle) {
      nextCheckDueNow = true;
    } else if (latest) {
      const due = reportTimeMs(latest) + intervalDays * DAY_MS;
      if (nextCheckDueAt === null || due < new Date(nextCheckDueAt).getTime()) {
        nextCheckDueAt = new Date(due).toISOString();
      }
    }
    return {
      platform,
      latestPosition: latest ? latest.rankingPosition : null,
      latestValidCheckAt: latest ? new Date(reportTimeMs(latest)).toISOString() : null,
      checkedInCycle,
    };
  });

  const hasIncompleteCoverage = platformChecks.some((p) => !p.checkedInCycle);
  const isOverdue = nextCheckDueAt !== null && new Date(nextCheckDueAt).getTime() < nowMs;

  // Status priority mirrors admin_panel_locked_keyword_ui_fix_spec.md §27 exactly.
  let status: LockedKeywordStatus;
  if (consecutiveAbsentChecks >= 2) {
    status = "unlock_now";
  } else if (validChecks === 0 || retentionRate === null) {
    status = "insufficient_data";
  } else if (retentionRate < 50) {
    status = "unlock_recommended";
  } else if (retentionRate < 70 || isOverdue || hasIncompleteCoverage) {
    status = "monitor";
  } else {
    status = "healthy";
  }

  return {
    id: kw.id,
    clientId: kw.clientId,
    clientName: kw.clientName,
    businessId: kw.businessId,
    businessName: kw.businessName,
    city: kw.city,
    state: kw.state,
    aeoPlanId: kw.aeoPlanId,
    campaignName: kw.campaignName,
    keywordText: kw.keywordText,
    lockedAt: kw.lockedAt ? kw.lockedAt.toISOString() : null,
    maintenanceLevel,
    platformChecks,
    validChecks,
    topThreeChecks,
    absentChecks,
    totalChecksInCycle,
    consecutiveAbsentChecks,
    retentionRate,
    lastValidCheckAt,
    nextCheckDueAt,
    nextCheckDueNow,
    status,
  };
}

export async function getLockedKeywordMonitoring(filters: {
  clientId?: number;
  businessId?: number;
  aeoPlanId?: number;
  keywordIds?: number[] | null;
}): Promise<LockedKeywordRecord[]> {
  const conds: SQL[] = [eq(keywordsTable.status, "locked")];
  if (filters.clientId != null) conds.push(eq(keywordsTable.clientId, filters.clientId));
  if (filters.businessId != null) conds.push(eq(keywordsTable.businessId, filters.businessId));
  if (filters.aeoPlanId != null) conds.push(eq(keywordsTable.aeoPlanId, filters.aeoPlanId));
  if (filters.keywordIds != null) {
    if (filters.keywordIds.length === 0) return [];
    conds.push(inArray(keywordsTable.id, filters.keywordIds));
  }

  const rows = await db
    .select({
      id: keywordsTable.id,
      clientId: keywordsTable.clientId,
      businessId: keywordsTable.businessId,
      aeoPlanId: keywordsTable.aeoPlanId,
      keywordText: keywordsTable.keywordText,
      lockedAt: keywordsTable.lockedAt,
      maintenanceLevel: keywordsTable.maintenanceLevel,
      clientName: clientsTable.businessName,
      businessName: businessesTable.name,
      city: businessesTable.city,
      state: businessesTable.state,
      campaignName: clientAeoPlansTable.name,
    })
    .from(keywordsTable)
    .leftJoin(clientsTable, eq(keywordsTable.clientId, clientsTable.id))
    .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
    .leftJoin(clientAeoPlansTable, eq(keywordsTable.aeoPlanId, clientAeoPlansTable.id))
    .where(and(...conds));

  if (rows.length === 0) return [];

  const keywordIds = rows.map((r) => r.id);
  const reports: RawReport[] = await db
    .select({
      keywordId: rankingReportsTable.keywordId,
      platform: rankingReportsTable.platform,
      status: rankingReportsTable.status,
      rankingPosition: rankingReportsTable.rankingPosition,
      date: rankingReportsTable.date,
      createdAt: rankingReportsTable.createdAt,
    })
    .from(rankingReportsTable)
    .where(inArray(rankingReportsTable.keywordId, keywordIds));

  const reportsByKeyword = new Map<number, RawReport[]>();
  for (const r of reports) {
    if (r.keywordId == null) continue;
    const list = reportsByKeyword.get(r.keywordId) ?? [];
    list.push(r);
    reportsByKeyword.set(r.keywordId, list);
  }

  const nowMs = Date.now();
  return rows.map((kw) => computeRecord(kw, reportsByKeyword.get(kw.id) ?? [], nowMs));
}

export interface LockedKeywordSummary {
  totalLocked: number;
  healthy: number;
  monitor: number;
  unlockRecommended: number;
  unlockNow: number;
  insufficientData: number;
}

export function summarize(records: LockedKeywordRecord[]): LockedKeywordSummary {
  const summary: LockedKeywordSummary = {
    totalLocked: records.length,
    healthy: 0,
    monitor: 0,
    unlockRecommended: 0,
    unlockNow: 0,
    insufficientData: 0,
  };
  for (const r of records) {
    if (r.status === "healthy") summary.healthy++;
    else if (r.status === "monitor") summary.monitor++;
    else if (r.status === "unlock_recommended") summary.unlockRecommended++;
    else if (r.status === "unlock_now") summary.unlockNow++;
    else summary.insufficientData++;
  }
  return summary;
}
