import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

async function seedAdmin() {
  const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
  const passwordHash = crypto.createHmac("sha256", salt).update("Admin123!").digest("hex");

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, "admin@signalaeo.com"));
  if (existing.length > 0) {
    console.log("Admin user already exists, updating password hash...");
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.email, "admin@signalaeo.com"));
    console.log("Updated admin@signalaeo.com");
    return;
  }

  await db.insert(usersTable).values({
    email: "admin@signalaeo.com",
    passwordHash,
    name: "Signal AEO Admin",
    role: "admin",
  });

  console.log("Created admin user: admin@signalaeo.com / Admin123!");
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
