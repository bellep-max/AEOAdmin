import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { usersTable, clientsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

const router = Router();

function hashPassword(password: string): string {
  const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

// Mirror the session writes done by /login so register-customer and /google
// emit identical session state. Caller is responsible for res.json.
function setSessionForUser(
  req: Request,
  user: { id: number; email: string; name: string; role: string },
): void {
  const session = req.session as unknown as Record<string, unknown>;
  session.userId = user.id;
  session.userEmail = user.email;
  session.userName = user.name;
  session.userRole = user.role;
}

// express-session writes asynchronously; for POST handlers that respond
// immediately with the new session, we wait for the store roundtrip so the
// Set-Cookie header is on the response by the time we send it.
function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const hashed = hashPassword(password);
    if (user.passwordHash !== hashed) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    (req.session as unknown as Record<string, unknown>).userId = user.id;
    (req.session as unknown as Record<string, unknown>).userEmail = user.email;
    (req.session as unknown as Record<string, unknown>).userName = user.name;
    (req.session as unknown as Record<string, unknown>).userRole = user.role;

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

router.get("/me", (req, res) => {
  const session = req.session as unknown as Record<string, unknown>;
  if (!session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({
    id: session.userId,
    email: session.userEmail,
    name: session.userName,
    role: session.userRole,
  });
});

router.post("/change-password", async (req, res) => {
  try {
    const session = req.session as unknown as Record<string, unknown>;
    if (!session.userId) return res.status(401).json({ error: "Not authenticated" });

    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, Number(session.userId)));
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.passwordHash !== hashPassword(currentPassword)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    await db.update(usersTable)
      .set({ passwordHash: hashPassword(newPassword) })
      .where(eq(usersTable.id, user.id));

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Change password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Customer self-signup. Creates a `clients` row + a `users` row with
 * role='customer' linked to it, then opens a session (same shape as /login).
 */
router.post("/register-customer", async (req, res) => {
  try {
    const { email, password, name, businessName } = (req.body ?? {}) as {
      email?: unknown;
      password?: unknown;
      name?: unknown;
      businessName?: unknown;
    };

    if (typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (businessName !== undefined && typeof businessName !== "string") {
      return res.status(400).json({ error: "businessName must be a string" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const resolvedBusinessName =
      typeof businessName === "string" && businessName.trim()
        ? businessName.trim()
        : `${trimmedName}'s Business`;

    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const [client] = await db
      .insert(clientsTable)
      .values({
        businessName: resolvedBusinessName,
        accountUser: trimmedName,
        contactEmail: normalizedEmail,
        status: "active",
      })
      .returning({ id: clientsTable.id });

    const [user] = await db
      .insert(usersTable)
      .values({
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        name: trimmedName,
        role: "customer",
        clientId: client.id,
      })
      .returning();

    setSessionForUser(req, user);
    await saveSession(req);

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    req.log.error({ err }, "Register-customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Sign-in with a Google ID token. Verifies via google-auth-library, then
 * find-or-creates a customer user. Existing admin users with matching emails
 * are also allowed to sign in this way (same `users` table, same session).
 */
router.post("/google", async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: "Google sign-in not configured" });
    }

    const { credential } = (req.body ?? {}) as { credential?: unknown };
    if (typeof credential !== "string" || !credential) {
      return res.status(400).json({ error: "credential is required" });
    }

    const oauthClient = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await oauthClient.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      req.log.warn({ err: verifyErr }, "Google ID token verify failed");
      return res.status(401).json({ error: "Invalid Google credential" });
    }

    const rawEmail = payload?.email;
    if (typeof rawEmail !== "string" || !payload?.email_verified) {
      return res.status(401).json({ error: "Google account email not verified" });
    }

    const email = rawEmail.trim().toLowerCase();
    const name =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : email.split("@")[0];

    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (existing) {
      setSessionForUser(req, existing);
      await saveSession(req);
      return res.json({
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role,
      });
    }

    const [client] = await db
      .insert(clientsTable)
      .values({
        businessName: `${name}'s Business`,
        accountUser: name,
        contactEmail: email,
        status: "active",
      })
      .returning({ id: clientsTable.id });

    // Google accounts never use the password column, but the schema makes
    // it NOT NULL. Store a random unguessable value so password login fails
    // (no plaintext can hash to it).
    const oauthPlaceholder = `oauth:google:${crypto.randomBytes(32).toString("hex")}`;

    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        passwordHash: oauthPlaceholder,
        name,
        role: "customer",
        clientId: client.id,
      })
      .returning();

    setSessionForUser(req, user);
    await saveSession(req);

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    req.log.error({ err }, "Google sign-in error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { hashPassword };
export default router;
