import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const isRemote =
  process.env.DATABASE_SSL === "true" ||
  /\.rds\.amazonaws\.com|\.supabase\.co|\.neon\.tech/.test(process.env.DATABASE_URL);

export default defineConfig({
  schema: "./src/schema/*.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ssl: isRemote ? { rejectUnauthorized: false } : false,
  },
});
