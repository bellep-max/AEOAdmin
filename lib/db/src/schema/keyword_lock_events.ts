import { pgTable, serial, integer, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { keywordsTable } from "./keywords";

/* Admin-action history for locked keywords — who unlocked/changed what, when,
   and why. Distinct from audit_logs, which is a session-run execution log
   (device/platform/prompt), not an admin-action trail. Populated going
   forward as monitoring actions ship; empty for history predating this
   table. */
export const keywordLockEventsTable = pgTable("keyword_lock_events", {
  id: serial("id").primaryKey(),
  keywordId: integer("keyword_id").notNull().references(() => keywordsTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // "locked" | "unlocked" | "maintenance_changed" | "note"
  reason: text("reason"),
  note: text("note"),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  retentionAtAction: doublePrecision("retention_at_action"),
  actorEmail: text("actor_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertKeywordLockEventSchema = createInsertSchema(keywordLockEventsTable).omit({ id: true, createdAt: true });
export type InsertKeywordLockEvent = z.infer<typeof insertKeywordLockEventSchema>;
export type KeywordLockEvent = typeof keywordLockEventsTable.$inferSelect;
