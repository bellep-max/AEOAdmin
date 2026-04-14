import { pgTable, serial, integer, text, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { devicesTable } from "./devices";
import { clientsTable } from "./clients";
import { keywordsTable } from "./keywords";

export const rotationStatusEnum = pgEnum("rotation_status", ["pending", "running", "completed", "failed"]);

export const deviceRotationsTable = pgTable("device_rotations", {
  id:          serial("id").primaryKey(),
  date:        date("date").notNull(),
  deviceId:    integer("device_id").references(() => devicesTable.id, { onDelete: "set null" }),
  clientId:    integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  keywordId:   integer("keyword_id").references(() => keywordsTable.id, { onDelete: "set null" }),
  platform:    text("platform"),
  status:      rotationStatusEnum("status").notNull().default("pending"),
  startedAt:   timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const insertDeviceRotationSchema = createInsertSchema(deviceRotationsTable).omit({ id: true });
export type InsertDeviceRotation = z.infer<typeof insertDeviceRotationSchema>;
export type DeviceRotation = typeof deviceRotationsTable.$inferSelect;
