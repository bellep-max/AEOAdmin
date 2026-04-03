import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const proxiesTable = pgTable("proxies", {
  id: serial("id").primaryKey(),
  label: text("label"),
  proxyUrl: text("proxy_url"),
  proxyType: text("proxy_type").notNull().default("mobile"),
  host: text("host"),
  port: integer("port"),
  username: text("username"),
  password: text("password"),
  deviceId: integer("device_id"),
  sessionCount: integer("session_count").notNull().default(0),
  lastUsed: timestamp("last_used"),
});

export const insertProxySchema = createInsertSchema(proxiesTable).omit({ id: true });
export type InsertProxy = z.infer<typeof insertProxySchema>;
export type Proxy = typeof proxiesTable.$inferSelect;
