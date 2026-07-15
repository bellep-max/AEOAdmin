/*
 * Provider email-event webhooks. Ingest post-send lifecycle events from SendGrid
 * and GHL, dedup, and recompute email_sends.latest_status.
 *
 *   POST /api/webhooks/sendgrid  — SendGrid Signed Event Webhook (ECDSA verified)
 *   POST /api/webhooks/ghl       — GHL email events (shared-secret verified)
 *
 * Both are public (no session/executor auth); each verifies its own provider
 * credential. They always return 200 quickly — providers retry on non-2xx, so
 * ingest is best-effort and never throws back to the caller.
 */
import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { emailEventsTable, emailSendsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  normalizeEvent,
  recomputeLatestStatus,
} from "../services/email-status";
import {
  timingSafeEqualStr,
  verifySendgridSignature,
} from "../lib/webhook-verify";

const router = Router();

type RawBodyRequest = Request & { rawBody?: Buffer };

interface SendgridEvent {
  sg_message_id?: string;
  sg_event_id?: string;
  event?: string;
  timestamp?: number;
  email?: string;
  reason?: string;
  [k: string]: unknown;
}

async function findSendByColumn(
  column:
    | typeof emailSendsTable.sendgridMessageId
    | typeof emailSendsTable.ghlMessageId,
  value: string,
): Promise<number | null> {
  if (!value) return null;
  const [row] = await db
    .select({ id: emailSendsTable.id })
    .from(emailSendsTable)
    .where(eq(column, value))
    .limit(1);
  return row?.id ?? null;
}

/* ── SendGrid ─────────────────────────────────────────────── */
router.post("/sendgrid", async (req, res) => {
  const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY ?? "";
  const signature = req.header("X-Twilio-Email-Event-Webhook-Signature") ?? "";
  const timestamp = req.header("X-Twilio-Email-Event-Webhook-Timestamp") ?? "";
  const rawBody = (req as RawBodyRequest).rawBody ?? Buffer.from("");

  if (
    !publicKey ||
    !verifySendgridSignature({
      publicKeyBase64: publicKey,
      payload: rawBody,
      signature,
      timestamp,
    })
  ) {
    req.log.warn("sendgrid webhook: signature verification failed");
    return res.status(403).json({ error: "invalid signature" });
  }

  const events: SendgridEvent[] = Array.isArray(req.body) ? req.body : [];
  const affected = new Set<number>();

  for (const ev of events) {
    const normalized = normalizeEvent("sendgrid", ev.event ?? "");
    if (!normalized) continue;
    const xMessageId = (ev.sg_message_id ?? "").split(".")[0];
    const sendId = await findSendByColumn(
      emailSendsTable.sendgridMessageId,
      xMessageId,
    );
    try {
      await db
        .insert(emailEventsTable)
        .values({
          emailSendId: sendId,
          provider: "sendgrid",
          event: normalized,
          rawEvent: ev.event ?? null,
          providerEventId: ev.sg_event_id ?? null,
          occurredAt: ev.timestamp ? new Date(ev.timestamp * 1000) : null,
          payload: ev as Record<string, unknown>,
        })
        .onConflictDoNothing();
      if (sendId != null) affected.add(sendId);
    } catch (err) {
      req.log.error({ err }, "sendgrid webhook: event insert failed");
    }
  }

  for (const id of affected) {
    try {
      await recomputeLatestStatus(id);
    } catch (err) {
      req.log.error({ err, id }, "sendgrid webhook: recompute failed");
    }
  }

  res.status(200).json({ received: events.length, matched: affected.size });
});

/* ── GHL ──────────────────────────────────────────────────── */
router.post("/ghl", async (req, res) => {
  const secret = process.env.GHL_WEBHOOK_SECRET ?? "";
  const provided =
    req.header("X-Webhook-Secret") ??
    (typeof req.query.token === "string" ? req.query.token : "");

  if (!secret || !timingSafeEqualStr(secret, provided)) {
    req.log.warn("ghl webhook: secret verification failed");
    return res.status(403).json({ error: "invalid secret" });
  }

  /* GHL posts a single event object; field names vary by trigger, so read the
     common aliases defensively and keep the raw payload for later refinement. */
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawEvent = String(body.type ?? body.event ?? body.emailEvent ?? "");
  const messageId = String(
    body.messageId ?? body.emailMessageId ?? body.id ?? "",
  );
  const providerEventId = String(
    body.webhookId ?? body.eventId ?? body.id ?? "",
  );
  const tsRaw = body.timestamp ?? body.dateAdded ?? body.date;

  const normalized = normalizeEvent("ghl", rawEvent);
  if (!normalized) {
    return res.status(200).json({ ignored: rawEvent || "unknown" });
  }

  const sendId = messageId
    ? await findSendByColumn(emailSendsTable.ghlMessageId, messageId)
    : null;

  try {
    await db
      .insert(emailEventsTable)
      .values({
        emailSendId: sendId,
        provider: "ghl",
        event: normalized,
        rawEvent: rawEvent || null,
        providerEventId: providerEventId || null,
        occurredAt: tsRaw ? new Date(String(tsRaw)) : null,
        payload: body,
      })
      .onConflictDoNothing();
    if (sendId != null) await recomputeLatestStatus(sendId);
  } catch (err) {
    req.log.error({ err }, "ghl webhook: event ingest failed");
  }

  res.status(200).json({ received: true, matched: sendId != null });
});

export default router;
