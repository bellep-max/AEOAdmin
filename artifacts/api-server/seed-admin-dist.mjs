// Run from dist after building
import { db } from "../../../lib/db/dist/index.mjs";
import { usersTable } from "../../../lib/db/dist/index.mjs";
import crypto from "crypto";

const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
const passwordHash = crypto.createHmac("sha256", salt).update("Admin123!").digest("hex");

console.log("Attempting to seed admin user...");
console.log("Database URL:", process.env.DATABASE_URL?.split("@")[1] || "not set");
console.log("Session secret:", process.env.SESSION_SECRET ? "set" : "using default");
console.log("Password hash:", passwordHash);

try {
  const result = await db
    .insert(usersTable)
    .values({
      email: "admin@signalaeo.com",
      passwordHash,
      name: "Signal AEO Admin",
      role: "admin",
    })
    .onConflictDoUpdate({
      target: usersTable.email,
      set: { passwordHash, name: "Signal AEO Admin" },
    })
    .returning();

  const user = result[0];
  console.log(`✓ Admin user created: ${user.email}`);
  console.log(`  ID: ${user.id}`);
  console.log(`  Role: ${user.role}`);
  console.log(`  Login with: admin@signalaeo.com / Admin123!`);
  process.exit(0);
} catch (err) {
  console.error("✗ Failed to seed admin user:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
}
