import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

// Short-lived email one-time codes for passwordless customer-portal sign-in.
// A row is created only when the email matches an existing client; the code
// itself is never stored in plaintext (HMAC hash only).
export const loginCodesTable = pgTable("login_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  // Client resolved at request time, so verify doesn't have to re-match.
  clientId: integer("client_id").references(() => clientsTable.id),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type LoginCode = typeof loginCodesTable.$inferSelect;
