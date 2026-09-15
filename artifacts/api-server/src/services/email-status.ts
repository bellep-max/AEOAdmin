import { db } from "@workspace/db";
import { emailEventsTable, emailSendsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

/* ────────────────────────────────────────────────────────────
   Email lifecycle status normalization.

   GHL and SendGrid emit different event vocabularies; we normalize both into a
   single ladder and denormalize the furthest-reached state onto
   email_sends.latest_status for the Sent Emails page.
   ──────────────────────────────────────────────────────────── */

export type NormalizedEvent =
  | "processed"
  | "delivered"
  | "open"
  | "click"
  | "bounce"
  | "dropped"
  | "spam"
  | "unsub"
  | "deferred"
  | "failed";

export type LatestStatus =
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "dropped"
  | "spam"
  | "unsubscribed"
  | "failed";

/* Positive ladder — higher rank wins when no hard failure is present. */
const POSITIVE_RANK: Record<string, number> = {
  sent: 0,
  delivered: 1,
  opened: 2,
  clicked: 3,
};

/* Hard failures override the positive ladder; earlier in the list wins. */
const HARD_FAILURE_PRIORITY: LatestStatus[] = [
  "failed",
  "bounced",
  "dropped",
  "spam",
];

const SENDGRID_MAP: Record<string, NormalizedEvent> = {
  processed: "processed",
  delivered: "delivered",
  open: "open",
  click: "click",
  bounce: "bounce",
  dropped: "dropped",
  spamreport: "spam",
  unsubscribe: "unsub",
  group_unsubscribe: "unsub",
  deferred: "deferred",
  blocked: "failed",
};

const GHL_MAP: Record<string, NormalizedEvent> = {
  delivered: "delivered",
  opened: "open",
  open: "open",
  clicked: "click",
  click: "click",
  bounced: "bounce",
  bounce: "bounce",
  complained: "spam",
  complaint: "spam",
  unsubscribed: "unsub",
  failed: "failed",
  rejected: "failed",
};

export function normalizeEvent(
  provider: "sendgrid" | "ghl",
  rawEvent: string,
): NormalizedEvent | null {
  const key = (rawEvent ?? "").toLowerCase().trim();
  return (provider === "sendgrid" ? SENDGRID_MAP : GHL_MAP)[key] ?? null;
}

/* The lifecycle position a normalized event implies (null = no status bump,
   e.g. processed/deferred are in-flight). */
function eventToStatus(event: NormalizedEvent): LatestStatus | null {
  switch (event) {
    case "delivered":
      return "delivered";
    case "open":
      return "opened";
    case "click":
      return "clicked";
    case "bounce":
      return "bounced";
    case "dropped":
      return "dropped";
    case "spam":
      return "spam";
    case "failed":
      return "failed";
    case "unsub":
      return "unsubscribed";
    case "processed":
    case "deferred":
      return null;
  }
}

export interface DerivedStatus {
  latestStatus: LatestStatus;
  latestEventAt: Date | null;
  openedCount: number;
  clickedCount: number;
  unsubscribed: boolean;
}

/* Pure: fold an email's events into its furthest-reached status. Hard failures
   win; otherwise the highest positive rank. Opens/clicks may repeat — counted,
   but latest_status only advances. */
export function deriveLatestStatus(
  events: Array<{ event: string; occurredAt: Date | string | null }>,
): DerivedStatus {
  let bestPositive: LatestStatus = "sent";
  let hardFailure: LatestStatus | null = null;
  let openedCount = 0;
  let clickedCount = 0;
  let unsubscribed = false;
  let latestEventAt: Date | null = null;

  for (const e of events) {
    const norm = e.event as NormalizedEvent;
    if (norm === "open") openedCount++;
    if (norm === "click") clickedCount++;
    if (norm === "unsub") unsubscribed = true;

    const status = eventToStatus(norm);
    if (status && HARD_FAILURE_PRIORITY.includes(status)) {
      if (
        hardFailure == null ||
        HARD_FAILURE_PRIORITY.indexOf(status) <
          HARD_FAILURE_PRIORITY.indexOf(hardFailure)
      ) {
        hardFailure = status;
      }
    } else if (status && POSITIVE_RANK[status] != null) {
      if (POSITIVE_RANK[status] > POSITIVE_RANK[bestPositive]) {
        bestPositive = status;
      }
    }

    if (e.occurredAt) {
      const d =
        e.occurredAt instanceof Date ? e.occurredAt : new Date(e.occurredAt);
      if (!latestEventAt || d > latestEventAt) latestEventAt = d;
    }
  }

  return {
    latestStatus: hardFailure ?? bestPositive,
    latestEventAt,
    openedCount,
    clickedCount,
    unsubscribed,
  };
}

/* Recompute and persist the denormalized status for one send. Call after every
   webhook event ingest. */
export async function recomputeLatestStatus(
  emailSendId: number,
): Promise<DerivedStatus> {
  const events = await db
    .select({
      event: emailEventsTable.event,
      occurredAt: emailEventsTable.occurredAt,
    })
    .from(emailEventsTable)
    .where(eq(emailEventsTable.emailSendId, emailSendId));

  const derived = deriveLatestStatus(events);

  await db
    .update(emailSendsTable)
    .set({
      latestStatus: derived.latestStatus,
      latestEventAt: derived.latestEventAt,
      openedCount: derived.openedCount,
      clickedCount: derived.clickedCount,
    })
    .where(eq(emailSendsTable.id, emailSendId));

  return derived;
}
