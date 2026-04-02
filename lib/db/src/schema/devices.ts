import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const devicesTable = pgTable("devices", {
  id: serial("id").primaryKey(),
  deviceIdentifier: text("device_identifier").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("available"),
  retiredToday: boolean("retired_today").notNull().default(false),
  lastUsedAt: timestamp("last_used_at"),
});

export const insertDeviceSchema = createInsertSchema(devicesTable).omit({ id: true });
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type Device = typeof devicesTable.$inferSelect;
