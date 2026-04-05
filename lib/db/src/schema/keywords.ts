import { pgTable, serial, integer, text, boolean, timestamp, date, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const keywordsTable = pgTable("keywords", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  keywordText: varchar("keyword_text", { length: 512 }).notNull(),
  verificationStatus: varchar("verification_status", { length: 50 }),
  dateAdded: date("date_added"),
  initialSearchCount30Days: integer("initial_search_count_30_days"),
  followupSearchCount30Days: integer("followup_search_count_30_days"),
  initialSearchCountLife: integer("initial_search_count_life"),
  followupSearchCountLife: integer("followup_search_count_life"),
  linkTypeLabel: varchar("link_type_label", { length: 100 }),
  linkActive: boolean("link_active").default(true),
  initialRankReportLink: varchar("initial_rank_report_link", { length: 512 }),
  currentRankReportLink: varchar("current_rank_report_link", { length: 512 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertKeywordSchema = createInsertSchema(keywordsTable).omit({ id: true });
export type InsertKeyword = z.infer<typeof insertKeywordSchema>;
export type Keyword = typeof keywordsTable.$inferSelect;
