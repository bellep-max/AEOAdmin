import {
  pgTable,
  integer,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

/* Per-(keyword, platform) judgment of whether the AI answer GENUINELY recommends
   the business — derived by an LLM judge reading audit_logs.response_text, which
   ignores the coerced "[RANK: X/Y]" line. Used to gate the GHL/CRM sync so only
   real top results are surfaced as proof. */
export const keywordVerdictsTable = pgTable("keyword_verdicts", {
  keywordId: integer("keyword_id").notNull(),
  platform: text("platform").notNull(),
  genuine: boolean("genuine"),
  sentiment: text("sentiment"),
  note: text("note"),
  responseDate: text("response_date"),
  judgedAt: timestamp("judged_at").notNull().defaultNow(),
});

export type KeywordVerdict = typeof keywordVerdictsTable.$inferSelect;
