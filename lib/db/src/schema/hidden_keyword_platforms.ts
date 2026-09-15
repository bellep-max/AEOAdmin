import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { keywordsTable } from "./keywords";

/* Admin-hidden (keyword, platform) pairs — hides ONE platform's data for a
 * keyword from every graph/report (admin + portal) while the other platforms
 * stay visible. Platform stored lowercase. */
export const hiddenKeywordPlatformsTable = pgTable(
  "hidden_keyword_platforms",
  {
    id: serial("id").primaryKey(),
    keywordId: integer("keyword_id")
      .notNull()
      .references(() => keywordsTable.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("hidden_keyword_platforms_uq").on(t.keywordId, t.platform)],
);
