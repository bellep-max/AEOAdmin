import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import crypto from "crypto";

const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
const passwordHash = crypto.createHmac("sha256", salt).update("Admin123!").digest("hex");

try {
  const [user] = await db
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

  console.log(`✓ Admin user: ${user.email}`);
  console.log(`  Password: Admin123!`);
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
