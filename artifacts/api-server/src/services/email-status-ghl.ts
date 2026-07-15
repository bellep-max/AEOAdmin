import { db } from "@workspace/db";
import { emailSendsTable } from "@workspace/db/schema";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
} from "drizzle-orm";
import type { LatestStatus } from "./email-status";

/* ────────────────────────────────────────────────────────────
   GHL email lifecycle — PULL.

   GHL's workflow "Email Events" webhook carries a contact record, not the
   email's id or event type, so it can't drive status. Instead we poll GHL's
   LC-Email message endpoint by the messageId we already store on each send:

     GET /conversations/messages/email/{ghlMessageId}
       → { emailMessage: { status, dateUpdated } }

   `status` is the current lifecycle state (delivered / opened / clicked / …),
   which is exactly what the Sent Emails page shows — and it includes
   "delivered", which the workflow trigger never emits.
   ──────────────────────────────────────────────────────────── */

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";

/* Once a send reaches one of these, GHL won't change it — stop polling. */
const TERMINAL: LatestStatus[] = [
  "clicked",
  "bounced",
  "failed",
  "spam",
  "dropped",
  "unsubscribed",
];

/* Mirrors the ladder in email-status.ts so a pull can only ADVANCE status —
   never downgrade an already-Opened send back to Delivered. */
const POSITIVE_RANK: Record<string, number> = {
  sent: 0,
  delivered: 1,
  opened: 2,
  clicked: 3,
};
const HARD_FAILURE = new Set<LatestStatus>([
  "failed",
  "bounced",
  "dropped",
  "spam",
]);

/* GHL LC-Email `message.status` → our LatestStatus. Unknown or in-flight values
   (pending/scheduled/sent/read) return null = no status bump. */
export function mapGhlEmailStatus(ghlStatus: string): LatestStatus | null {
  switch ((ghlStatus ?? "").toLowerCase().trim()) {
    case "delivered":
      return "delivered";
    case "opened":
    case "open":
      return "opened";
    case "clicked":
    case "click":
      return "clicked";
    case "bounced":
    case "bounce":
      return "bounced";
    case "complained":
    case "complaint":
    case "spam":
      return "spam";
    case "unsubscribed":
    case "unsubscribe":
      return "unsubscribed";
    case "failed":
    case "rejected":
    case "undelivered":
      return "failed";
    default:
      return null;
  }
}

interface GhlEmailStatus {
  status: LatestStatus | null;
  at: Date | null;
}

/* Fetch one email's current lifecycle status from GHL. Best-effort: any error
   (network, 4xx, unparseable) yields null so a sweep never fails as a whole. */
export async function fetchGhlEmailStatus(
  ghlMessageId: string,
): Promise<GhlEmailStatus | null> {
  const token = process.env.GHL_PIT_TOKEN;
  if (!token || !ghlMessageId) return null;
  try {
    const resp = await fetch(
      `${GHL_API}/conversations/messages/email/${encodeURIComponent(ghlMessageId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_VERSION,
          Accept: "application/json",
        },
      },
    );
    if (!resp.ok) return null;
    const j = (await resp.json()) as {
      emailMessage?: { status?: string; dateUpdated?: string };
    };
    const em = j.emailMessage;
    if (!em?.status) return null;
    const at = em.dateUpdated ? new Date(em.dateUpdated) : null;
    return {
      status: mapGhlEmailStatus(em.status),
      at: at && !Number.isNaN(at.getTime()) ? at : null,
    };
  } catch {
    return null;
  }
}

/* True if `next` is a strictly-further lifecycle state than `current` — the
   guard that keeps a pull monotonic (advance-only). */
function advances(current: string | null, next: LatestStatus): boolean {
  if (HARD_FAILURE.has(next))
    return current == null || !HARD_FAILURE.has(current as LatestStatus);
  const cur = POSITIVE_RANK[current ?? "sent"] ?? 0;
  const nxt = POSITIVE_RANK[next] ?? -1;
  return nxt > cur;
}

export interface RefreshResult {
  polled: number;
  updated: number;
}

/* Poll GHL for the current status of recent, non-terminal GHL sends and advance
   email_sends.latest_status. Bounded by a time window and a hard cap so it's
   safe to call on page load; never throws (per-send failures are skipped). */
export async function refreshGhlSendStatuses(
  opts: {
    clientId?: number | null;
    clientIds?: number[] | null;
    kind?: string | null;
    sinceHours?: number;
    max?: number;
  } = {},
): Promise<RefreshResult> {
  if (opts.clientIds != null && opts.clientIds.length === 0)
    return { polled: 0, updated: 0 };

  const since = new Date(Date.now() - (opts.sinceHours ?? 168) * 3_600_000);
  const max = opts.max ?? 40;

  const rows = await db
    .select({
      id: emailSendsTable.id,
      ghlMessageId: emailSendsTable.ghlMessageId,
      latestStatus: emailSendsTable.latestStatus,
    })
    .from(emailSendsTable)
    .where(
      and(
        eq(emailSendsTable.deliveredVia, "ghl"),
        isNotNull(emailSendsTable.ghlMessageId),
        gte(emailSendsTable.sentAt, since),
        // Poll rows not yet in a terminal state (NULL latest_status included).
        or(
          isNull(emailSendsTable.latestStatus),
          notInArray(emailSendsTable.latestStatus, TERMINAL),
        ),
        opts.clientId != null
          ? eq(emailSendsTable.clientId, opts.clientId)
          : undefined,
        opts.clientIds != null
          ? inArray(emailSendsTable.clientId, opts.clientIds)
          : undefined,
        opts.kind ? eq(emailSendsTable.kind, opts.kind) : undefined,
      ),
    )
    .orderBy(desc(emailSendsTable.sentAt))
    .limit(max);

  let polled = 0;
  let updated = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + CONCURRENCY).map(async (r) => {
        if (!r.ghlMessageId) return;
        polled++;
        const s = await fetchGhlEmailStatus(r.ghlMessageId);
        if (!s?.status || !advances(r.latestStatus, s.status)) return;
        await db
          .update(emailSendsTable)
          .set({ latestStatus: s.status, latestEventAt: s.at })
          .where(eq(emailSendsTable.id, r.id));
        updated++;
      }),
    );
  }
  return { polled, updated };
}
