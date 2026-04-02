import { pgTable, serial, text, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  planId: text("plan_id").notNull(),
  planName: text("plan_name").notNull(),
  cost: numeric("cost", { precision: 10, scale: 2 }).notNull().default("0"),
  numberOfDays: integer("number_of_days").notNull().default(30),
  noOfKeywords: integer("no_of_keywords").notNull().default(2),
  noOfClicks: integer("no_of_clicks").notNull().default(200),
  totalDailyClicks: integer("total_daily_clicks").notNull().default(7),
  noOfBacklinkClicks: integer("no_of_backlink_clicks").notNull().default(7),
  backlinkClickPercentage: integer("backlink_click_percentage").notNull().default(100),
  aeoSearch: integer("aeo_search").notNull().default(0),
  pageTraverse: boolean("page_traverse").notNull().default(true),
  radious: integer("radious").notNull().default(1),
  status: boolean("status").notNull().default(true),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
