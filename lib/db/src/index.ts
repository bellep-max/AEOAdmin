import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;
const forceSsl =
  process.env.DATABASE_SSL === "true" ||
  /\.rds\.amazonaws\.com|\.supabase\.co|\.neon\.tech/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: forceSsl ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
