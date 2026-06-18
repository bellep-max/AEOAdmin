import { Router, type Request } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  clientsTable,
  loginCodesTable,
} from "@workspace/db/schema";
import { eq, or, and, sql, desc, isNull, gt } from "drizzle-orm";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import sgMail from "@sendgrid/mail";
import rateLimit from "express-rate-limit";

const router = Router();

// Per-IP throttle on the unauthenticated code endpoints. The per-email DB
// limit (below) stops one client's inbox from being spammed; this stops an
// attacker rotating across many emails to burn SendGrid quota or brute-force.
// trustProxy validation is disabled because App Runner sits behind a fixed
// CloudFront hop and `app.set("trust proxy", true)` is intentional there.
const requestCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please wait a few minutes and try again.",
  },
  validate: { trustProxy: false },
});
const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many attempts. Please wait a few minutes and try again.",
  },
  validate: { trustProxy: false },
});

// ── Passwordless sign-in config ──
const CODE_TTL_MS = 10 * 60 * 1000; // a code is valid for 10 minutes
const MAX_VERIFY_ATTEMPTS = 5; // wrong-code tries before a code is dead
const MAX_CODES_PER_WINDOW = 3; // request-code calls per email per window
const CODE_WINDOW_MS = 15 * 60 * 1000;
const NOT_A_CLIENT_MESSAGE =
  "This email isn't associated with an account. Contact your account manager for access.";

/**
 * Case-insensitive match of an email against any client email field.
 *
 * An email can appear on more than one client (e.g. it was reassigned from an
 * old/paused client to a live one). Prefer the active client and break ties by
 * lowest id so the result is deterministic — otherwise a portal login could
 * resolve to a stale inactive client.
 */
async function findClientByEmail(email: string) {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(
      or(
        sql`lower(${clientsTable.contactEmail}) = ${e}`,
        sql`lower(${clientsTable.accountEmail}) = ${e}`,
        sql`lower(${clientsTable.billingEmail}) = ${e}`,
      ),
    )
    .orderBy(
      sql`case when lower(${clientsTable.status}) = 'active' then 0 else 1 end`,
      clientsTable.id,
    )
    .limit(1);
  return client ?? null;
}

/** Find the portal user for an email, or create one linked to the client. */
async function findOrCreateCustomerUser(
  email: string,
  name: string,
  clientId: number,
) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (existing) {
    // An email can be reassigned to a different client (the admin changed which
    // client owns this address). The user row must follow, otherwise the portal
    // keeps scoping to the old client_id and shows the wrong client's data.
    if (existing.role === "customer" && existing.clientId !== clientId) {
      const [updated] = await db
        .update(usersTable)
        .set({ clientId })
        .where(eq(usersTable.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }
  // Passwordless accounts never use the password column, but the schema makes
  // it NOT NULL. Store a random unguessable value so password login can't work.
  const placeholder = `otp:${crypto.randomBytes(32).toString("hex")}`;
  // onConflictDoNothing makes this safe against a concurrent insert of the
  // same email (users.email is UNIQUE) — e.g. a double-submitted code.
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: placeholder,
      name,
      role: "customer",
      clientId,
    })
    .onConflictDoNothing({ target: usersTable.email })
    .returning();
  if (user) return user;
  // Lost the race: another request inserted it first — re-fetch.
  const [winner] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (!winner)
    throw new Error(`User row vanished after insert conflict for ${email}`);
  return winner;
}

function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** HMAC of the code, bound to the email so a code can't be replayed elsewhere. */
function hashCode(email: string, code: string): string {
  const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
  return crypto
    .createHmac("sha256", salt)
    .update(`${email.toLowerCase()}:${code}`)
    .digest("hex");
}

/** Constant-time compare of two hex digests of equal length. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function sendLoginCodeEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  const fromName = process.env.SENDGRID_FROM_NAME ?? "AEO Platform";
  if (!apiKey || !fromEmail) {
    throw new Error("SENDGRID_API_KEY / SENDGRID_FROM_EMAIL not configured");
  }
  sgMail.setApiKey(apiKey);
  await sgMail.send({
    to: email,
    from: { email: fromEmail, name: fromName },
    subject: `Your sign-in code: ${code}`,
    text: `Your AEO Platform sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    html: `<p>Your AEO Platform sign-in code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
  });
}

function hashPassword(password: string): string {
  const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

// Mirror the session writes done by /login so verify-code and /google emit
// identical session state. Caller is responsible for res.json.
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

// Issue a fresh session id at the moment of authentication so a pre-auth
// cookie planted in the victim's browser can't be reused (session fixation).
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
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
    if (!session.userId)
      return res.status(401).json({ error: "Not authenticated" });

    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ error: "New password must be at least 8 characters" });
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, Number(session.userId)));
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.passwordHash !== hashPassword(currentPassword)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    await db
      .update(usersTable)
      .set({ passwordHash: hashPassword(newPassword) })
      .where(eq(usersTable.id, user.id));

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Change password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Step 1 of passwordless sign-in. Emails a one-time code, but ONLY if the
 * address matches an existing client. Unknown emails are told so explicitly
 * (product decision); abuse is bounded by per-email rate limiting.
 */
router.post("/request-code", requestCodeLimiter, async (req, res) => {
  try {
    const { email } = (req.body ?? {}) as { email?: unknown };
    if (typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    const normalizedEmail = email.trim().toLowerCase();

    const client = await findClientByEmail(normalizedEmail);
    if (!client) {
      return res.status(422).json({ error: NOT_A_CLIENT_MESSAGE });
    }

    // Rate limit: cap codes requested per email per window.
    const windowStart = new Date(Date.now() - CODE_WINDOW_MS);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(loginCodesTable)
      .where(
        and(
          eq(loginCodesTable.email, normalizedEmail),
          gt(loginCodesTable.createdAt, windowStart),
        ),
      );
    if (count >= MAX_CODES_PER_WINDOW) {
      return res.status(429).json({
        error:
          "Too many code requests. Please wait a few minutes and try again.",
      });
    }

    const code = generateCode();
    await db.insert(loginCodesTable).values({
      email: normalizedEmail,
      codeHash: hashCode(normalizedEmail, code),
      clientId: client.id,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });

    const isProd = process.env.NODE_ENV === "production";
    try {
      await sendLoginCodeEmail(normalizedEmail, code);
    } catch (mailErr) {
      req.log.error({ err: mailErr }, "Login code email failed");
      // In prod a send failure is fatal (user can't get the code). In dev we
      // tolerate it and surface the code in the response so e2e can proceed.
      if (isProd) {
        return res
          .status(502)
          .json({ error: "Could not send the code email. Try again shortly." });
      }
    }

    // Never leak the code in production responses.
    return res.json(
      isProd ? { success: true } : { success: true, devCode: code },
    );
  } catch (err) {
    req.log.error({ err }, "request-code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Step 2 of passwordless sign-in. Validates the emailed code and opens a
 * session (same shape as /login), find-or-creating the customer user.
 */
router.post("/verify-code", verifyCodeLimiter, async (req, res) => {
  try {
    const { email, code } = (req.body ?? {}) as {
      email?: unknown;
      code?: unknown;
    };
    if (typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "A 6-digit code is required" });
    }
    const normalizedEmail = email.trim().toLowerCase();

    const [record] = await db
      .select()
      .from(loginCodesTable)
      .where(
        and(
          eq(loginCodesTable.email, normalizedEmail),
          isNull(loginCodesTable.consumedAt),
          gt(loginCodesTable.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(loginCodesTable.createdAt))
      .limit(1);

    if (!record) {
      return res
        .status(400)
        .json({ error: "Code expired or not found. Request a new one." });
    }
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      return res
        .status(429)
        .json({ error: "Too many attempts. Request a new code." });
    }

    // Always record the attempt before comparing. SQL-expression increment is
    // atomic, so concurrent wrong guesses can't under-count the attempt cap.
    await db
      .update(loginCodesTable)
      .set({ attempts: sql`${loginCodesTable.attempts} + 1` })
      .where(eq(loginCodesTable.id, record.id));

    if (!safeEqual(record.codeHash, hashCode(normalizedEmail, code))) {
      return res.status(401).json({ error: "Invalid code." });
    }

    // Atomically consume the code: the WHERE guard means only one concurrent
    // request can flip consumed_at, so a correct code yields exactly one login.
    const consumed = await db
      .update(loginCodesTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(loginCodesTable.id, record.id),
          isNull(loginCodesTable.consumedAt),
        ),
      )
      .returning({ id: loginCodesTable.id });
    if (consumed.length === 0) {
      return res
        .status(400)
        .json({ error: "Code expired or not found. Request a new one." });
    }

    // The client must still exist (could have been deleted between steps).
    const client = record.clientId
      ? (
          await db
            .select()
            .from(clientsTable)
            .where(eq(clientsTable.id, record.clientId))
        )[0]
      : await findClientByEmail(normalizedEmail);
    if (!client) {
      return res.status(422).json({ error: NOT_A_CLIENT_MESSAGE });
    }

    const name = client.accountUser?.trim() || normalizedEmail.split("@")[0];
    const user = await findOrCreateCustomerUser(
      normalizedEmail,
      name,
      client.id,
    );

    await regenerateSession(req);
    setSessionForUser(req, user);
    await saveSession(req);

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    req.log.error({ err }, "verify-code error");
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
      return res
        .status(401)
        .json({ error: "Google account email not verified" });
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
      await regenerateSession(req);
      setSessionForUser(req, existing);
      await saveSession(req);
      return res.json({
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role,
      });
    }

    // First-time Google sign-in is allowed ONLY if the verified Google email
    // matches an existing client. No self-signup / no new client is created.
    const client = await findClientByEmail(email);
    if (!client) {
      return res.status(422).json({ error: NOT_A_CLIENT_MESSAGE });
    }

    const user = await findOrCreateCustomerUser(email, name, client.id);

    await regenerateSession(req);
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
