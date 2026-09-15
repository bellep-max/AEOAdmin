import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull(),
  gmbUrl: text("gmb_url"),
  websiteUrl: text("website_url"),
  publishedAddress: text("published_address"),
  searchAddress: text("search_address"),
  city: text("city"),
  state: text("state"),
  status: text("status").notNull().default("active"),
  planName: text("plan_name"),
  addressType: integer("address_type").default(1),
  placeId: text("place_id"),
  locationRef: text("location_ref"),
  contactEmail: text("contact_email"),
  /* ── Business / GMB extra ── */
  websitePublishedOnGmb: text("website_published_on_gmb"),
  websiteLinkedOnGmb: text("website_linked_on_gmb"),
  accountUser: text("account_user"),
  /* ── Account / Billing ── */
  accountType: text("account_type"),
  accountUserName: text("account_user_name"),
  accountEmail: text("account_email"),
  billingEmail: text("billing_email"),
  startDate: text("start_date"),
  nextBillDate: text("next_bill_date"),
  subscriptionId: text("subscription_id"),
  lastFourCard: text("last_four_card"),
  /* ── Location ── */
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  timezone: text("timezone"),
  /* ── CRM / device-farm proof integration ── */
  slug: text("slug"), // permanent proof join key (Option A)
  brand: text("brand"), // e.g. "signalaeo" | "top3"
  leadRef: text("lead_ref"), // CRM lead reference
  source: text("source"), // e.g. "crm_farm_ready"
  idempotencyKey: text("idempotency_key"), // resolved "brand:leadRef" dedup key
  /* ── Audit ── */
  createdBy: text("created_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /* ── Lifecycle (mirrors keywords) ──
     status     → active/inactive (Switch toggle, manual pause)
     archivedAt → trash icon stamped this; row hides from /clients
                  and appears on /clients/archived
     lockedAt   → set by the rotation service the first time any
                  keyword on this client hits top-3; row appears on
                  /clients/locked. Archive ≠ Lock — a client can be
                  in both, neither, or just one. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archiveReason: text("archive_reason"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
