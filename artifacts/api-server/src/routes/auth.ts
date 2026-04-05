import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

function hashPassword(password: string): string {
  const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
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

    (req.session as Record<string, unknown>).userId = user.id;
    (req.session as Record<string, unknown>).userEmail = user.email;
    (req.session as Record<string, unknown>).userName = user.name;
    (req.session as Record<string, unknown>).userRole = user.role;

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
  const session = req.session as Record<string, unknown>;
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
    const session = req.session as Record<string, unknown>;
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

export { hashPassword };
export default router;
