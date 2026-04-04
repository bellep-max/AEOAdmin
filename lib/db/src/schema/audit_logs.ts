import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { keywordsTable } from "./keywords";
import { devicesTable } from "./devices";

export const auditLogsTable = pgTable("audit_logs", {
  id:             serial("id").primaryKey(),
  clientId:       integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  keywordId:      integer("keyword_id").references(() => keywordsTable.id, { onDelete: "set null" }),
  deviceId:       integer("device_id").references(() => devicesTable.id, { onDelete: "set null" }),
  platform:       text("platform"),
  screenshotPath: text("screenshot_path"),
  responseText:   text("response_text"),
  proxyUsername:  text("proxy_username"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
