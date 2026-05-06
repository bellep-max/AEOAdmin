import { pgTable, serial, integer, text, timestamp, date, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyReportsTable = pgTable("daily_reports", {
  id: serial("id").primaryKey(),
  reportDate:      date("report_date").notNull(),
  scope:           text("scope").notNull().default("all"),
  scopeId:         integer("scope_id"),
  modelUsed:       text("model_used"),
  inputSummary:    jsonb("input_summary"),
  reportMarkdown:  text("report_markdown"),
  recommendations: jsonb("recommendations"),
  generatedAt:     timestamp("generated_at", { withTimezone: true }).defaultNow(),
  durationMs:      integer("duration_ms"),
  costUsd:         numeric("cost_usd", { precision: 10, scale: 4 }),
});

export const insertDailyReportSchema = createInsertSchema(dailyReportsTable).omit({ id: true, generatedAt: true });
export type InsertDailyReport = z.infer<typeof insertDailyReportSchema>;
export type DailyReport = typeof dailyReportsTable.$inferSelect;
