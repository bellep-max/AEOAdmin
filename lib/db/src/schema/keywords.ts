import { pgTable, serial, integer, text, boolean, timestamp, date, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { clientAeoPlansTable } from "./client_aeo_plans";

export const keywordsTable = pgTable("keywords", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  aeoPlanId: integer("aeo_plan_id").references(() => clientAeoPlansTable.id, { onDelete: "set null" }),
  keywordText: varchar("keyword_text", { length: 512 }).notNull(),
  keywordType: integer("keyword_type").default(3),
  isActive:   boolean("is_active").notNull().default(true),
  isPrimary:  integer("is_primary").notNull().default(0),
  verificationStatus: varchar("verification_status", { length: 50 }),
  dateAdded: date("date_added"),
  initialSearchCount30Days: integer("initial_search_count_30_days"),
  followupSearchCount30Days: integer("followup_search_count_30_days"),
  initialSearchCountLife: integer("initial_search_count_life"),
  followupSearchCountLife: integer("followup_search_count_life"),
  initialRankReportCount: integer("initial_rank_report_count"),
  currentRankReportCount: integer("current_rank_report_count"),
  linkTypeLabel: varchar("link_type_label", { length: 100 }),
  linkActive: boolean("link_active").default(true),
  initialRankReportLink: varchar("initial_rank_report_link", { length: 512 }),
  currentRankReportLink: varchar("current_rank_report_link", { length: 512 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertKeywordSchema = createInsertSchema(keywordsTable).omit({ id: true });
export type InsertKeyword = z.infer<typeof insertKeywordSchema>;
export type Keyword = typeof keywordsTable.$inferSelect;
