/**
 * Create or update a user, and optionally set their role.
 *
 * Roles supported by the app:
 *   - "owner"  → super-admin, sees beta features (Reports, Variants admin)
 *   - "admin"  → existing admin surface only (default)
 *
 * Usage:
 *   # Promote yourself to owner (no password change)
 *   pnpm tsx scripts/manage-user.ts --email you@example.com --role owner
 *
 *   # Create Mary as a regular admin (cannot see beta pages yet)
 *   pnpm tsx scripts/manage-user.ts --email mary@signalaeo.com --name "Mary" \
 *     --password 'StrongPass!23' --role admin
 *
 *   # Update password for an existing account
 *   pnpm tsx scripts/manage-user.ts --email u@example.com --password 'New!23'
 *
 * Requires DATABASE_URL + SESSION_SECRET in env (same hash salt as auth.ts).
 */
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

interface Args {
  email: string;
  name?: string;
  password?: string;
  role?: "owner" | "admin";
}

function parseArgs(): Args {
  const out: Partial<Args> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email")    out.email    = argv[++i];
    else if (a === "--name")     out.name     = argv[++i];
    else if (a === "--password") out.password = argv[++i];
    else if (a === "--role") {
      const v = argv[++i];
      if (v !== "owner" && v !== "admin") {
        throw new Error(`--role must be "owner" or "admin", got: ${v}`);
      }
      out.role = v;
    }
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.email) throw new Error("--email is required");
  return out as Args;
}

function hashPassword(password: string): string {
  const salt = process.env.SESSION_SECRET;
  if (!salt) throw new Error("SESSION_SECRET env var must match the API server");
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

async function run() {
  const args = parseArgs();

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, args.email));
  const found = existing[0];

  if (found) {
    const update: Record<string, unknown> = {};
    if (args.password) update.passwordHash = hashPassword(args.password);
    if (args.role) update.role = args.role;
    if (args.name) update.name = args.name;
    if (Object.keys(update).length === 0) {
      console.log(`User ${args.email} exists. No changes (current role=${found.role}).`);
      return;
    }
    await db.update(usersTable).set(update).where(eq(usersTable.id, found.id));
    console.log(`Updated ${args.email}: ${Object.keys(update).join(", ")}`);
    return;
  }

  if (!args.password) throw new Error("--password is required when creating a new user");
  if (!args.name) throw new Error("--name is required when creating a new user");
  await db.insert(usersTable).values({
    email: args.email,
    name: args.name,
    passwordHash: hashPassword(args.password),
    role: args.role ?? "admin",
  });
  console.log(`Created ${args.email} (role=${args.role ?? "admin"})`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
