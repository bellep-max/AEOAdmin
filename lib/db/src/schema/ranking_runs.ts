import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rankingRunStatusEnum = pgEnum("ranking_run_status", [
  "running",
  "success",
  "partial",
  "failed",
]);

export const rankingRunsTable = pgTable("ranking_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: rankingRunStatusEnum("status").notNull().default("running"),
  keywordsAttempted: integer("keywords_attempted").notNull().default(0),
  keywordsSucceeded: integer("keywords_succeeded").notNull().default(0),
  keywordsFailed: integer("keywords_failed").notNull().default(0),
  notes: text("notes"),
});

export const insertRankingRunSchema = createInsertSchema(rankingRunsTable).omit({
  id: true,
  startedAt: true,
});
export type InsertRankingRun = z.infer<typeof insertRankingRunSchema>;
export type RankingRun = typeof rankingRunsTable.$inferSelect;
