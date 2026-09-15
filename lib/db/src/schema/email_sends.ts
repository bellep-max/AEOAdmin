import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { businessesTable } from "./businesses";
import { clientAeoPlansTable } from "./client_aeo_plans";

export const emailSendsTable = pgTable("email_sends", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clientsTable.id, {
    onDelete: "set null",
  }),
  businessId: integer("business_id").references(() => businessesTable.id, {
    onDelete: "set null",
  }),
  aeoPlanId: integer("aeo_plan_id").references(() => clientAeoPlansTable.id, {
    onDelete: "set null",
  }),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  recipients: jsonb("recipients").$type<string[]>().notNull(),
  fromEmail: text("from_email").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull(),
  sendgridMessageId: text("sendgrid_message_id"),
  error: text("error"),
  /* When SAFE_RECIPIENT_OVERRIDE is active, this records the original
     recipients we WOULD have used so the audit trail isn't misleading. */
  intendedRecipients: jsonb("intended_recipients").$type<string[]>(),
  /* 'report' (Send Report) or 'sales' (Sales Email). Old rows are null. */
  kind: text("kind"),
  /* The exact rendered HTML that was sent — the Sent Emails page replays it. */
  html: text("html"),
  /* Send-specific context: keyword, platform, beforeRank, afterRank, etc. */
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  /* GHL one-way record: 'posted' | 'no_contact' | 'disabled' | 'failed: …' */
  ghlStatus: text("ghl_status"),
  /* Which channel actually delivered this send: 'ghl' | 'sendgrid'. Promoted
     from meta so webhook correlation and the Status column don't parse jsonb. */
  deliveredVia: text("delivered_via"),
  /* GHL message id (from ghlSendEmail) so GHL webhook events correlate back. */
  ghlMessageId: text("ghl_message_id"),
  /* Furthest-reached normalized lifecycle status, updated by provider webhooks:
     sent → delivered → opened → clicked, or terminal bounced/spam/failed. */
  latestStatus: text("latest_status"),
  latestEventAt: timestamp("latest_event_at"),
  openedCount: integer("opened_count").notNull().default(0),
  clickedCount: integer("clicked_count").notNull().default(0),
});
