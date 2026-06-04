import { pgTable, serial, integer, text, varchar, jsonb, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { businessesTable } from "./businesses";

/**
 * One keyword-research run: a seed + location expanded into ranked keyword ideas.
 * Discovery is kept separate from the curated `keywords` pool — ideas are promoted
 * into `keywords` individually (see keyword_research_ideas.promotedKeywordId).
 *
 * client/business are nullable so ad-hoc research (no client yet) is allowed.
 */
export const keywordResearchRunsTable = pgTable("keyword_research_runs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
  businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "cascade" }),
  seed: varchar("seed", { length: 512 }).notNull(),
  location: varchar("location", { length: 255 }),
  gl: varchar("gl", { length: 8 }).default("us"),
  hl: varchar("hl", { length: 8 }).default("en"),
  scoringWeights: jsonb("scoring_weights"),
  status: varchar("status", { length: 50 }).notNull().default("success"),
  costUsd: doublePrecision("cost_usd").default(0),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertKeywordResearchRunSchema = createInsertSchema(keywordResearchRunsTable).omit({ id: true, createdAt: true });
export type InsertKeywordResearchRun = z.infer<typeof insertKeywordResearchRunSchema>;
export type KeywordResearchRun = typeof keywordResearchRunsTable.$inferSelect;
