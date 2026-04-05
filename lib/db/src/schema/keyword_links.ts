import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { keywordsTable } from "./keywords";

export const keywordLinksTable = pgTable("keyword_links", {
  id:                    serial("id").primaryKey(),
  keywordId:             integer("keyword_id").notNull().references(() => keywordsTable.id, { onDelete: "cascade" }),
  linkUrl:               text("link_url"),
  linkTypeLabel:         text("link_type_label"),
  linkActive:            boolean("link_active").notNull().default(true),
  initialRankReportLink: text("initial_rank_report_link"),
  currentRankReportLink: text("current_rank_report_link"),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
});

export type KeywordLink = typeof keywordLinksTable.$inferSelect;
