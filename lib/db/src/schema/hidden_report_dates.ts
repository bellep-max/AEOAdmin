import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { businessesTable } from "./businesses";
import { clientAeoPlansTable } from "./client_aeo_plans";

/* Admin-hidden report dates. A row hides one audit date from graphs/reports
 * within its scope, cascading DOWN only:
 *   client-level  (business_id + aeo_plan_id NULL) → every view of the client
 *   business-level (aeo_plan_id NULL)              → that business + its campaigns
 *   campaign-level                                 → that campaign's view only
 * Date is YYYY-MM-DD text, matching ranking_reports.date. */
export const hiddenReportDatesTable = pgTable("hidden_report_dates", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  businessId: integer("business_id").references(() => businessesTable.id, {
    onDelete: "cascade",
  }),
  aeoPlanId: integer("aeo_plan_id").references(() => clientAeoPlansTable.id, {
    onDelete: "cascade",
  }),
  date: text("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
