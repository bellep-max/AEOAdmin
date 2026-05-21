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
});
