import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const proxiesTable = pgTable("proxies", {
  id: serial("id").primaryKey(),
  label: text("label"),
  proxyUrl: text("proxy_url"),
  proxyType: text("proxy_type").notNull().default("mobile"),
  provider: text("provider").default("decodo"),
  host: text("host"),
  port: integer("port"),
  username: text("username"),
  baseUser: text("base_user"),
  password: text("password"),
  country:  text("country"),
  zip:      text("zip"),
  sessionDuration: integer("session_duration"),
  deviceId: integer("device_id"),
  lastUsed: timestamp("last_used"),
});

export const insertProxySchema = createInsertSchema(proxiesTable).omit({ id: true });
export type InsertProxy = z.infer<typeof insertProxySchema>;
export type Proxy = typeof proxiesTable.$inferSelect;
