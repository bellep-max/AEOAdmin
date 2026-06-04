import { pgTable, serial, integer, text, varchar, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { keywordResearchRunsTable } from "./keyword_research_runs";
import { keywordsTable } from "./keywords";

/**
 * One keyword idea produced by a research run.
 *  - listType: "traditional" (Google/Bing phrases) | "ai_search" (conversational queries)
 *  - popularity: autocomplete-breadth proxy in 0..1 (null for ai_search)
 *  - difficulty: 0..100 measured from a real SERP (null until the SERP bridge exists)
 *  - lvs: Local Value Score 1..100
 *  - promotedKeywordId: set when the idea is promoted into the curated keywords pool
 */
export const keywordResearchIdeasTable = pgTable("keyword_research_ideas", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => keywordResearchRunsTable.id, { onDelete: "cascade" }),
  keyword: varchar("keyword", { length: 512 }).notNull(),
  listType: varchar("list_type", { length: 20 }).notNull().default("traditional"),
  popularity: real("popularity"),
  intent: varchar("intent", { length: 30 }),
  commercialIntent: real("commercial_intent"),
  reasoning: text("reasoning"),
  difficulty: real("difficulty"),
  difficultyBasis: text("difficulty_basis"),
  lvs: integer("lvs"),
  promotedKeywordId: integer("promoted_keyword_id").references(() => keywordsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertKeywordResearchIdeaSchema = createInsertSchema(keywordResearchIdeasTable).omit({ id: true, createdAt: true });
export type InsertKeywordResearchIdea = z.infer<typeof insertKeywordResearchIdeaSchema>;
export type KeywordResearchIdea = typeof keywordResearchIdeasTable.$inferSelect;
