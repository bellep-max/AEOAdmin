import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { keywordsTable } from "./keywords";

export const clientBacklinksTable = pgTable("client_backlinks", {
  id:        serial("id").primaryKey(),
  keywordId: integer("keyword_id").notNull().references(() => keywordsTable.id, { onDelete: "cascade" }),
  url:       text("url").notNull(),
});

export const insertClientBacklinkSchema = createInsertSchema(clientBacklinksTable).omit({ id: true });
export type InsertClientBacklink = z.infer<typeof insertClientBacklinkSchema>;
export type ClientBacklink = typeof clientBacklinksTable.$inferSelect;
