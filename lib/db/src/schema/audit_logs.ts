import { pgTable, serial, integer, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { businessesTable } from "./businesses";
import { keywordsTable } from "./keywords";
import { devicesTable } from "./devices";
import { clientAeoPlansTable } from "./client_aeo_plans";

export const auditLogsTable = pgTable("audit_logs", {
  id:             serial("id").primaryKey(),
  /* ── FKs ── */
  clientId:       integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  businessId:     integer("business_id").references(() => businessesTable.id, { onDelete: "set null" }),
  campaignId:     integer("campaign_id").references(() => clientAeoPlansTable.id, { onDelete: "set null" }),
  keywordId:      integer("keyword_id").references(() => keywordsTable.id, { onDelete: "set null" }),
  deviceId:       integer("device_id").references(() => devicesTable.id, { onDelete: "set null" }),
  /* ── Snapshots ── */
  bizName:        text("biz_name"),
  campaignName:   text("campaign_name"),
  keywordText:    text("keyword_text"),
  /* ── Run identity ── */
  timestamp:      timestamp("timestamp").notNull().defaultNow(),
  platform:       text("platform"),
  mode:           text("mode"),
  device:         text("device"),
  status:         text("status"),
  durationSeconds: doublePrecision("duration_seconds"),
  /* ── Ranking ── */
  rankPosition:   integer("rank_position"),
  rankTotal:      integer("rank_total"),
  mentioned:      text("mentioned"),
  rankContext:    text("rank_context"),
  /* ── Output ── */
  screenshotPath: text("screenshot_path"),
  responseText:   text("response_text"),
  prompt:         text("prompt"),
  error:          text("error"),
  /* ── Proxy ── */
  proxyUsername:  text("proxy_username"),
  proxyIp:        text("proxy_ip"),
  proxyCity:      text("proxy_city"),
  proxyRegion:    text("proxy_region"),
  proxyZip:       text("proxy_zip"),
  /* ── Bookkeeping ── */
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
