import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const PACKAGE_CREATORS = ["Belle", "Mary", "Erik", "Erven", "Sales Teams", "Development Teams"] as const;
export type PackageCreator = typeof PACKAGE_CREATORS[number];

export const customPackagesTable = pgTable("custom_packages", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),
  description: text("description"),
  target:      text("target"),
  features:    text("features"),        // JSON-serialised string[]
  color:       text("color").notNull(), // hex colour chosen in UI
  tier:        text("tier"),
  createdBy:   text("created_by").notNull(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export const insertCustomPackageSchema = createInsertSchema(customPackagesTable).omit({ id: true, createdAt: true });
export type InsertCustomPackage = z.infer<typeof insertCustomPackageSchema>;
export type CustomPackage = typeof customPackagesTable.$inferSelect;
