import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import crypto from "crypto";

async function seedAdmin() {
  const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
  const passwordHash = crypto.createHmac("sha256", salt).update("Admin123!").digest("hex");

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

  console.log(`✓ Admin user: ${user.email} (password: Admin123!)`);
  console.log(`  Hash generated with SESSION_SECRET: ${process.env.SESSION_SECRET ? "✓ (from env)" : "⚠ (using fallback)"}`);
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
