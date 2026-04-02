import { pgTable, serial, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const schedulesTable = pgTable("schedules", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  frequencyPerDay: integer("frequency_per_day").notNull().default(3),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertScheduleSchema = createInsertSchema(schedulesTable).omit({ id: true });
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedulesTable.$inferSelect;
