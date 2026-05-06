import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { keywordsTable } from "./keywords";

export const keywordVariantsTable = pgTable("keyword_variants", {
  id: serial("id").primaryKey(),
  keywordId: integer("keyword_id").notNull().references(() => keywordsTable.id, { onDelete: "cascade" }),
  variantText: text("variant_text").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const insertKeywordVariantSchema = createInsertSchema(keywordVariantsTable).omit({ id: true });
export type InsertKeywordVariant = z.infer<typeof insertKeywordVariantSchema>;
export type KeywordVariant = typeof keywordVariantsTable.$inferSelect;
