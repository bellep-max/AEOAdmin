import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { emailSendsTable } from "./email_sends";

/* Post-send lifecycle events for a sent email, ingested from provider webhooks
   (GHL + SendGrid). One row per provider event; the furthest-reached normalized
   status is denormalized onto email_sends.latest_status for fast list rendering. */
export const emailEventsTable = pgTable(
  "email_events",
  {
    id: serial("id").primaryKey(),
    emailSendId: integer("email_send_id").references(() => emailSendsTable.id, {
      onDelete: "cascade",
    }),
    /* 'ghl' | 'sendgrid' */
    provider: text("provider").notNull(),
    /* normalized: processed|delivered|open|click|bounce|dropped|spam|unsub|deferred|failed */
    event: text("event").notNull(),
    /* provider's raw event name, kept for audit */
    rawEvent: text("raw_event"),
    /* dedup key: SendGrid sg_event_id / GHL event id — unique per provider */
    providerEventId: text("provider_event_id"),
    /* provider event time (ISO-Z string on write, per pg-node timestamp rule) */
    occurredAt: timestamp("occurred_at"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_events_provider_event_uq").on(
      t.provider,
      t.providerEventId,
    ),
  ],
);
