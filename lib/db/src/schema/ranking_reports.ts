import { pgTable, serial, integer, text, timestamp, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { businessesTable } from "./businesses";
import { keywordsTable } from "./keywords";
import { rankingRunsTable } from "./ranking_runs";

export const rankingReportsTable = pgTable("ranking_reports", {
  id: serial("id").primaryKey(),
  /* ── FKs ── */
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "cascade" }),
  keywordId: integer("keyword_id").notNull().references(() => keywordsTable.id, { onDelete: "cascade" }),
  /* ── Snapshots (denormalized) ── */
  clientName: text("client_name"),
  bizName: text("biz_name"),
  searchAddress: text("search_address"),
  keyword: text("keyword"),
  /* ── Identity ── */
  timestamp: timestamp("timestamp"),
  date: text("date"),
  platform: text("platform"),
  deviceIdentifier: text("device_identifier"),
  /* ── Status ── */
  status: text("status"),
  durationSeconds: doublePrecision("duration_seconds"),
  /* ── Ranking ── */
  rankingPosition: integer("ranking_position"),
  rankingTotal: text("ranking_total"),
  reasonRecommended: text("reason_recommended"),
  /* ── Output ── */
  mapsPresence: text("maps_presence"),
  mapsUrl: text("maps_url"),
  screenshotUrl: text("screenshot_url"),
  textRanking: text("text_ranking"),
  isInitialRanking: boolean("is_initial_ranking").default(false),
  /* ── Proxy ── */
  proxyStatus: text("proxy_status"),
  proxyUsername: text("proxy_username"),
  proxyHost: text("proxy_host"),
  proxyPort: integer("proxy_port"),
  proxyIp: text("proxy_ip"),
  proxyCity: text("proxy_city"),
  proxyRegion: text("proxy_region"),
  proxyCountry: text("proxy_country"),
  proxyZip: text("proxy_zip"),
  /* ── Geo ── */
  baseLatitude: doublePrecision("base_latitude"),
  baseLongitude: doublePrecision("base_longitude"),
  mockedLatitude: doublePrecision("mocked_latitude"),
  mockedLongitude: doublePrecision("mocked_longitude"),
  mockedTimezone: text("mocked_timezone"),
  /* ── Error ── */
  failureStep: text("failure_step"),
  error: text("error"),
  /* ── Bookkeeping ── */
  runId: integer("run_id").references(() => rankingRunsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRankingReportSchema = createInsertSchema(rankingReportsTable).omit({ id: true, createdAt: true });
export type InsertRankingReport = z.infer<typeof insertRankingReportSchema>;
export type RankingReport = typeof rankingReportsTable.$inferSelect;
