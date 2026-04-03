import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const farmMetrics = pgTable("farm_metrics", {
  id:          serial("id").primaryKey(),
  key:         varchar("key",      { length: 120 }).notNull().unique(),
  label:       varchar("label",    { length: 200 }).notNull(),
  description: text("description"),
  category:    varchar("category", { length: 100 }).notNull(),
  value:       varchar("value",    { length: 500 }),
  unit:        varchar("unit",     { length: 60 }),
  targetValue: varchar("target_value", { length: 200 }),
  isComputed:  boolean("is_computed").notNull().default(false),
  updatedAt:   timestamp("updated_at").defaultNow(),
});
