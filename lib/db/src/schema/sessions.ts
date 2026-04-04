import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { keywordsTable } from "./keywords";
import { devicesTable } from "./devices";
import { proxiesTable } from "./proxies";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  keywordId: integer("keyword_id").references(() => keywordsTable.id),
  deviceId: integer("device_id").references(() => devicesTable.id),
  proxyId: integer("proxy_id").references(() => proxiesTable.id),
  promptText: text("prompt_text"),
  followupText: text("followup_text"),
  status: text("status").notNull().default("pending"),
  aiPlatform: text("ai_platform").notNull().default("gemini"),
  screenshotUrl: text("screenshot_url"),
  proxySessionId: text("proxy_session_id"),
  proxyUsername:  text("proxy_username"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, timestamp: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
