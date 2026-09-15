import { Router } from "express";
import { db } from "@workspace/db";
import { keywordLockEventsTable, keywordsTable } from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireViewer, requireScopedEditor } from "../middlewares/role-auth";
import { getScopedClientIds, assertScopedAccessToClient } from "../lib/scoped-access";
import {
  getLockedKeywordMonitoring,
  summarize,
  type LockedKeywordRecord,
  type LockedKeywordStatus,
  type Platform,
} from "../services/locked-keyword-monitoring";
import { ROTATION_PLATFORMS } from "../services/keyword-rotation";

const router = Router();

const UNLOCK_REASONS = new Set([
  "retention_below_50",
  "absent_two_consecutive",
  "manual_campaign_adjustment",
  "incorrectly_locked",
  "other",
]);

/* GET /api/admin/locked-keywords
   Read-only monitoring list for locked (won) keywords. Filters:
     - clientId, businessId, aeoPlanId (numeric ids)
     - platform      (chatgpt|gemini|perplexity — narrows to keywords where
                       that platform is currently NOT a clean top-3 signal:
                       absent, outside top-3, or not checked this cycle)
     - status        (healthy|monitor|unlock_recommended|unlock_now|insufficient_data)
     - maintenanceLevel (minimum|recommended|custom)
     - search        (matches keyword text, client name, or business name)
     - lastCheckedFrom / lastCheckedTo (YYYY-MM-DD, filters lastValidCheckAt)
     - sort          (retention|dueDate|lastValidCheckAt|consecutiveAbsent|lockedAt)
     - direction     (asc|desc, default asc)
     - page, pageSize (default 1 / 25, pageSize capped at 100)
   `summary` in the response reflects the full filtered set, not just the
   current page. This endpoint computes retention/status on the fly from
   ranking_reports — no unlock or write actions here (see keywords.ts PATCH
   for the existing manual unlock path). */

const STATUS_PRIORITY: Record<LockedKeywordStatus, number> = {
  unlock_now: 0,
  unlock_recommended: 1,
  monitor: 2,
  insufficient_data: 3,
  healthy: 4,
};

const intInRange = (raw: unknown, min: number, max: number, fallback: number) => {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

function dueSortValue(r: LockedKeywordRecord): number {
  if (r.nextCheckDueNow) return -Infinity;
  if (r.nextCheckDueAt) return new Date(r.nextCheckDueAt).getTime();
  return Infinity;
}

function isPlatformProblem(r: LockedKeywordRecord, platform: Platform): boolean {
  const p = r.platformChecks.find((c) => c.platform === platform);
  if (!p) return false;
  return !p.checkedInCycle || p.latestPosition == null || p.latestPosition > 3;
}

router.get("/", requireViewer, async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;

    const eligibleIds = await getScopedClientIds(req);
    if (eligibleIds !== null && eligibleIds.length === 0) {
      return res.json({
        items: [],
        summary: { totalLocked: 0, healthy: 0, monitor: 0, unlockRecommended: 0, unlockNow: 0, insufficientData: 0 },
        pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
      });
    }

    const clientId = q.clientId ? parseInt(q.clientId, 10) : undefined;
    const businessId = q.businessId ? parseInt(q.businessId, 10) : undefined;
    const aeoPlanId = q.aeoPlanId ? parseInt(q.aeoPlanId, 10) : undefined;

    let records = await getLockedKeywordMonitoring({ clientId, businessId, aeoPlanId });

    // Scoped roles (sales / account-manager) see only their slice of clients.
    if (eligibleIds !== null) {
      const eligible = new Set(eligibleIds);
      records = records.filter((r) => eligible.has(r.clientId));
    }

    const platform = q.platform?.toLowerCase();
    if (platform && (ROTATION_PLATFORMS as readonly string[]).includes(platform)) {
      records = records.filter((r) => isPlatformProblem(r, platform as Platform));
    }

    const status = q.status;
    if (status && status in STATUS_PRIORITY) {
      records = records.filter((r) => r.status === status);
    }

    if (q.maintenanceLevel) {
      records = records.filter((r) => r.maintenanceLevel === q.maintenanceLevel);
    }

    if (q.search) {
      const needle = q.search.toLowerCase();
      records = records.filter(
        (r) =>
          r.keywordText.toLowerCase().includes(needle) ||
          (r.clientName ?? "").toLowerCase().includes(needle) ||
          (r.businessName ?? "").toLowerCase().includes(needle),
      );
    }

    if (q.lastCheckedFrom) {
      const from = new Date(q.lastCheckedFrom).getTime();
      records = records.filter((r) => r.lastValidCheckAt != null && new Date(r.lastValidCheckAt).getTime() >= from);
    }
    if (q.lastCheckedTo) {
      const to = new Date(q.lastCheckedTo).getTime();
      records = records.filter((r) => r.lastValidCheckAt != null && new Date(r.lastValidCheckAt).getTime() <= to);
    }

    // Full-filtered-set summary, computed before pagination slices it down.
    const summary = summarize(records);

    const direction = q.direction === "desc" ? -1 : 1;
    const sortKey = q.sort;
    const comparators: Record<string, (a: LockedKeywordRecord, b: LockedKeywordRecord) => number> = {
      retention: (a, b) => (a.retentionRate ?? -1) - (b.retentionRate ?? -1),
      dueDate: (a, b) => dueSortValue(a) - dueSortValue(b),
      lastValidCheckAt: (a, b) =>
        (a.lastValidCheckAt ? new Date(a.lastValidCheckAt).getTime() : -Infinity) -
        (b.lastValidCheckAt ? new Date(b.lastValidCheckAt).getTime() : -Infinity),
      consecutiveAbsent: (a, b) => a.consecutiveAbsentChecks - b.consecutiveAbsentChecks,
      lockedAt: (a, b) =>
        (a.lockedAt ? new Date(a.lockedAt).getTime() : -Infinity) - (b.lockedAt ? new Date(b.lockedAt).getTime() : -Infinity),
    };

    if (sortKey && comparators[sortKey]) {
      const cmp = comparators[sortKey];
      records = [...records].sort((a, b) => cmp(a, b) * direction);
    } else {
      // Default: actionable statuses first, then oldest next-check-due first.
      records = [...records].sort((a, b) => {
        const byStatus = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
        if (byStatus !== 0) return byStatus;
        return dueSortValue(a) - dueSortValue(b);
      });
    }

    const page = intInRange(q.page, 1, Number.MAX_SAFE_INTEGER, 1);
    const pageSize = intInRange(q.pageSize, 1, 100, 25);
    const totalItems = records.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = (page - 1) * pageSize;
    const items = records.slice(start, start + pageSize);

    res.json({
      items,
      summary,
      pagination: { page, pageSize, totalItems, totalPages },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching locked-keyword monitoring data");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/admin/locked-keywords/:id/events
   Decision-history read for one keyword — who locked/unlocked/changed
   maintenance and why. Empty today for every keyword (nothing writes to
   keyword_lock_events until the unlock/maintenance actions ship), but the
   read path exists now so the Decision History tab has somewhere real to
   query instead of a hardcoded empty array. */
router.get("/:id/events", requireViewer, async (req, res) => {
  try {
    const keywordId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(keywordId)) return res.status(400).json({ error: "Invalid keyword id" });

    // Same scope rule as the list: the keyword's client must be in the
    // caller's slice (admin-chain users are local-plan-scoped too).
    const [kw] = await db
      .select({ clientId: keywordsTable.clientId })
      .from(keywordsTable)
      .where(eq(keywordsTable.id, keywordId));
    if (!kw) return res.status(404).json({ error: "Not found" });
    if (!(await assertScopedAccessToClient(req, res, kw.clientId))) return;

    const events = await db
      .select()
      .from(keywordLockEventsTable)
      .where(eq(keywordLockEventsTable.keywordId, keywordId))
      .orderBy(desc(keywordLockEventsTable.createdAt));

    res.json({ items: events });
  } catch (err) {
    req.log.error({ err }, "Error fetching keyword lock events");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/locked-keywords/:id/unlock
   The sole unlock path for locked keywords — returns one to active rotation
   and records who did it, when, and why. Body: { reason, note? }. reason
   must be one of UNLOCK_REASONS; note is free text (required for "other"
   on the frontend, not re-validated server-side). Does not delete keyword
   history — only flips status back to "active", matching what the old
   manual-unlock button in the pre-Phase-2 locked-keywords page used to do
   (PATCH /api/keywords/:id with the same field set). */
router.post("/:id/unlock", requireScopedEditor, async (req, res) => {
  try {
    const keywordId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(keywordId)) return res.status(400).json({ error: "Invalid keyword id" });

    const body = req.body as { reason?: string; note?: string };
    if (!body.reason || !UNLOCK_REASONS.has(body.reason)) {
      return res.status(400).json({ error: "A valid reason is required" });
    }

    const [kw] = await db
      .select({ clientId: keywordsTable.clientId, status: keywordsTable.status })
      .from(keywordsTable)
      .where(eq(keywordsTable.id, keywordId));
    if (!kw) return res.status(404).json({ error: "Not found" });
    if (!(await assertScopedAccessToClient(req, res, kw.clientId))) return;
    if (kw.status !== "locked") {
      return res.status(400).json({ error: "This keyword is not currently locked" });
    }

    const [current] = await getLockedKeywordMonitoring({ keywordIds: [keywordId] });
    const retentionAtAction = current?.retentionRate ?? null;
    const actorEmail = ((req.session as unknown as Record<string, unknown>).userEmail as string | undefined) ?? null;

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(keywordsTable)
        .set({ status: "active", isActive: true, archivedAt: null, archiveReason: null })
        .where(and(eq(keywordsTable.id, keywordId), eq(keywordsTable.status, "locked")))
        .returning({ id: keywordsTable.id });
      if (updated.length === 0) {
        throw Object.assign(new Error("Already unlocked"), { statusCode: 409 });
      }

      await tx.insert(keywordLockEventsTable).values({
        keywordId,
        action: "unlocked",
        reason: body.reason,
        note: body.note?.trim() || null,
        previousStatus: "locked",
        newStatus: "active",
        retentionAtAction,
        actorEmail,
      });
    });

    res.json({ success: true });
  } catch (err: any) {
    if (err?.statusCode === 409) {
      return res.status(409).json({ error: "This keyword was already unlocked" });
    }
    req.log.error({ err }, "Error unlocking keyword");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
