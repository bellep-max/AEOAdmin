import { pgTable, serial, integer, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const keywordsTable = pgTable("keywords", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  keywordText: text("keyword_text").notNull(),
  tierLabel: text("tier_label").notNull().default("aeo"),
  isActive: boolean("is_active").notNull().default(true),
  isPrimary: integer("is_primary").notNull().default(1),
  clickCount: integer("click_count").notNull().default(0),
  last30DaysClickCount: integer("last_30_days_click_count").notNull().default(0),
  backlinkCount: integer("backlink_count").notNull().default(0),
  webType: integer("web_type").notNull().default(1),
  keywordType: integer("keyword_type").notNull().default(1),
  verificationStatus: text("verification_status").notNull().default("pending"),
  avgScroll: integer("avg_scroll").notNull().default(0),
});

export const insertKeywordSchema = createInsertSchema(keywordsTable).omit({ id: true });
export type InsertKeyword = z.infer<typeof insertKeywordSchema>;
export type Keyword = typeof keywordsTable.$inferSelect;
