import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";

export const sessionPlatformsTable = pgTable("session_platforms", {
  id:              serial("id").primaryKey(),
  sessionId:       integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  platform:        text("platform").notNull(),
  status:          text("status").notNull().default("pending"),
  steps:           jsonb("steps"),
  backlinkClicked: text("backlink_clicked"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
});

export const insertSessionPlatformSchema = createInsertSchema(sessionPlatformsTable).omit({ id: true, createdAt: true });
export type InsertSessionPlatform = z.infer<typeof insertSessionPlatformSchema>;
export type SessionPlatform = typeof sessionPlatformsTable.$inferSelect;
