import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
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
  websiteLinkedOnGmb:    text("website_linked_on_gmb"),
  accountUser:           text("account_user"),
  /* ── Account / Billing ── */
  accountType:     text("account_type"),
  accountUserName: text("account_user_name"),
  accountEmail:    text("account_email"),
  billingEmail:    text("billing_email"),
  startDate:       text("start_date"),
  nextBillDate:    text("next_bill_date"),
  subscriptionId:  text("subscription_id"),
  lastFourCard:    text("last_four_card"),
  /* ── Location ── */
  latitude:  doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  timezone:  text("timezone"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
