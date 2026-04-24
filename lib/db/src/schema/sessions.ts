import { pgTable, serial, integer, text, timestamp, boolean, doublePrecision, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { businessesTable } from "./businesses";
import { keywordsTable } from "./keywords";
import { devicesTable } from "./devices";
import { proxiesTable } from "./proxies";
import { clientAeoPlansTable } from "./client_aeo_plans";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  /* ── FKs ── */
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "set null" }),
  campaignId: integer("campaign_id").references(() => clientAeoPlansTable.id, { onDelete: "set null" }),
  keywordId: integer("keyword_id").references(() => keywordsTable.id, { onDelete: "set null" }),
  deviceId: integer("device_id").references(() => devicesTable.id, { onDelete: "set null" }),
  proxyId: integer("proxy_id").references(() => proxiesTable.id, { onDelete: "set null" }),
  /* ── Snapshot strings (from executor) ── */
  clientName:    text("client_name"),
  bizName:       text("biz_name"),
  campaignName:  text("campaign_name"),
  keywordText:   text("keyword_text"),
  city:          text("city"),
  state:         text("state"),
  /* ── Run identity / time ── */
  date:          date("date"),
  timestamp:     timestamp("timestamp").notNull().defaultNow(),
  durationSeconds: doublePrecision("duration_seconds"),
  /* ── Run details ── */
  promptText:    text("prompt_text"),
  followupText:  text("followup_text"),
  hasFollowUp:   boolean("has_follow_up").default(false),
  status:        text("status").notNull().default("pending"),
  type:          text("type").notNull().default("aeo"),
  errorClass:    text("error_class"),
  errorMessage:  text("error_message"),
  aiPlatform:    text("ai_platform").notNull().default("gemini"),
  screenshotUrl: text("screenshot_url"),
  /* ── Device identity ── */
  deviceIdentifier: text("device_identifier"),
  /* ── Proxy ── */
  proxyStatus:    text("proxy_status"),
  proxySessionId: text("proxy_session_id"),
  proxyUsername:  text("proxy_username"),
  proxyHost:      text("proxy_host"),
  proxyPort:      integer("proxy_port"),
  proxyIp:        text("proxy_ip"),
  proxyCity:      text("proxy_city"),
  proxyRegion:    text("proxy_region"),
  proxyCountry:   text("proxy_country"),
  proxyZip:       text("proxy_zip"),
  /* ── GPS / timezone ── */
  baseLatitude:    doublePrecision("base_latitude"),
  baseLongitude:   doublePrecision("base_longitude"),
  mockedLatitude:  doublePrecision("mocked_latitude"),
  mockedLongitude: doublePrecision("mocked_longitude"),
  mockedTimezone:  text("mocked_timezone"),
  /* ── Backlinks ── */
  backlinksExpected: integer("backlinks_expected"),
  backlinkInjected:  boolean("backlink_injected").default(false),
  backlinkFound:     boolean("backlink_found").default(false),
  backlinkUrl:       text("backlink_url"),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, timestamp: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
