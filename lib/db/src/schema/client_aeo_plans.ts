import { pgTable, serial, integer, text, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { businessesTable } from "./businesses";

export const clientAeoPlansTable = pgTable("client_aeo_plans", {
  id:                     serial("id").primaryKey(),
  clientId:               integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  businessId:             integer("business_id").references(() => businessesTable.id, { onDelete: "cascade" }),
  name:                   text("name"),
  businessName:           text("business_name"),
  planType:               text("plan_type").notNull(),          // e.g. "Starter", "Growth", "Pro", or custom
  serviceCategory:        text("service_category"),
  sampleQuestion1:        text("sample_question_1"),
  sampleQuestion2:        text("sample_question_2"),
  sampleQuestion3:        text("sample_question_3"),
  sampleQuestion4:        text("sample_question_4"),
  sampleQuestion5:        text("sample_question_5"),
  sampleQuestion6:        text("sample_question_6"),
  sampleQuestion7:        text("sample_question_7"),
  sampleQuestion8:        text("sample_question_8"),
  sampleQuestion9:        text("sample_question_9"),
  sampleQuestion10:       text("sample_question_10"),
  currentAnswerPresence:  text("current_answer_presence"),      // e.g. "0%"
  searchBoostTarget:      integer("search_boost_target"),        // 3-month target # of question searches
  monthlyAeoBudget:       numeric("monthly_aeo_budget", { precision: 10, scale: 2 }),
  schemaImplementor:      text("schema_implementor"),            // "us" | "client_dev" | custom
  searchAddress:          text("search_address"),
  subscriptionId:         text("subscription_id"),
  subscriptionStartDate:  date("subscription_start_date"),
  nextBillingDate:        date("next_billing_date"),
  cardLast4:              text("card_last4"),
  createdAt:              timestamp("created_at").notNull().defaultNow(),
  updatedAt:              timestamp("updated_at").notNull().defaultNow(),
});

export const insertClientAeoPlanSchema = createInsertSchema(clientAeoPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClientAeoPlan = z.infer<typeof insertClientAeoPlanSchema>;
export type ClientAeoPlan = typeof clientAeoPlansTable.$inferSelect;
