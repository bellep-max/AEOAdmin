import {
  pgTable,
  serial,
  text,
  numeric,
  timestamp,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const promoCodesTable = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  discountType: text("discount_type").notNull().default("percent"), // percent | amount
  discountValue: numeric("discount_value", { precision: 10, scale: 2 }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  providedBy: text("provided_by"), // who provided/approved the promo
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPromoCodeSchema = createInsertSchema(promoCodesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type PromoCode = typeof promoCodesTable.$inferSelect;
