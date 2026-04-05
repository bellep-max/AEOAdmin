import { pgTable, serial, text, decimal, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

// Service tiers table - Defines AEO plans and pricing tiers
export const serviceTiersTable = pgTable("service_tiers", {
  id: serial("id").primaryKey(),
  tierName: text("tier_name").notNull(), // e.g., "Starter", "Growth", "Pro", "Enterprise"
  tierLabel: text("tier_label").notNull().unique(), // e.g., "aeo", "seo", "both"
  description: text("description"),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 }),
  keywordLimit: integer("keyword_limit"), // Max keywords allowed in this tier
  searchesPerDay: integer("searches_per_day"), // Daily search quota
  searchesPerMonth: integer("searches_per_month"), // Monthly search quota
  devicesIncluded: integer("devices_included"), // Number of devices included
  features: text("features"), // JSON array of features
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0), // Display order
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Client service tier assignments - Links clients to their tier
export const clientServiceTiersTable = pgTable("client_service_tiers", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  tierId: integer("tier_id").notNull().references(() => serviceTiersTable.id, { onDelete: "restrict" }),
  startDate: timestamp("start_date").notNull().defaultNow(),
  endDate: timestamp("end_date"), // null = ongoing
  isActive: boolean("is_active").notNull().default(true),
  customPrice: decimal("custom_price", { precision: 10, scale: 2 }), // Override price for this client
  customKeywordLimit: integer("custom_keyword_limit"), // Override keyword limit
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertServiceTierSchema = createInsertSchema(serviceTiersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertServiceTier = z.infer<typeof insertServiceTierSchema>;
export type ServiceTier = typeof serviceTiersTable.$inferSelect;

export const insertClientServiceTierSchema = createInsertSchema(clientServiceTiersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClientServiceTier = z.infer<typeof insertClientServiceTierSchema>;
export type ClientServiceTier = typeof clientServiceTiersTable.$inferSelect;
