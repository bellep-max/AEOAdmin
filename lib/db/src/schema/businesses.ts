import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  doublePrecision,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const businessStatusEnum = pgEnum("business_status", [
  "active",
  "inactive",
]);

export const businessesTable = pgTable("businesses", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /* Trading name(s) the AI platforms actually list this business under, when
     that differs from `name` (comma-separated). Wichita Florist is listed as
     "Flower Factory Flowers"; Custom Holiday Lighting as "Change's Lights".
     Without this the screenshot validator rejects a genuine top-3 as a
     different business, since it matches on exact identity by design. */
  alsoKnownAs: text("also_known_as"),
  gmbUrl: text("gmb_url"),
  websiteUrl: text("website_url"),
  category: text("category"),
  publishedAddress: text("published_address"),
  zipCode: text("zip_code"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  placeId: text("place_id"),
  locationRef: text("location_ref"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  timezone: text("timezone"),
  websitePublishedOnGmb: text("website_published_on_gmb"),
  websiteLinkedOnGmb: text("website_linked_on_gmb"),
  status: businessStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBusinessSchema = createInsertSchema(businessesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Business = typeof businessesTable.$inferSelect;
