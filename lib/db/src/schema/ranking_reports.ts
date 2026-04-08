import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { keywordsTable } from "./keywords";

export const rankingReportsTable = pgTable("ranking_reports", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  keywordId: integer("keyword_id").notNull().references(() => keywordsTable.id, { onDelete: "cascade" }),
  rankingPosition: integer("ranking_position"),
  reasonRecommended: text("reason_recommended"),
  mapsPresence: text("maps_presence"),
  mapsUrl: text("maps_url"),
  isInitialRanking: boolean("is_initial_ranking").default(false),
  platform: text("platform"),
  screenshotUrl: text("screenshot_url"),
  textRanking: text("text_ranking"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRankingReportSchema = createInsertSchema(rankingReportsTable).omit({ id: true, createdAt: true });
export type InsertRankingReport = z.infer<typeof insertRankingReportSchema>;
export type RankingReport = typeof rankingReportsTable.$inferSelect;
