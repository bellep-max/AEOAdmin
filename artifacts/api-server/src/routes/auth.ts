import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { ok, badRequest, unauthorized, serverError } from "../lib/response";
import "../middleware/auth";

const router = Router();

function hashPassword(password: string): string {
  const salt = process.env.SESSION_SECRET;
  if (!salt) throw new Error("SESSION_SECRET environment variable is required");
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return badRequest(res, "Email and password are required");
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!user) {
      return unauthorized(res, "Invalid credentials");
    }

    const hashed = hashPassword(password);
    if (user.passwordHash !== hashed) {
      return unauthorized(res, "Invalid credentials");
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    req.session.userRole = user.role;

    ok(res, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    serverError(res);
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    ok(res, { message: "Logged out" });
  });
});

router.get("/me", (req, res) => {
  if (!req.session.userId) {
    return unauthorized(res);
  }
  ok(res, {
    id: req.session.userId,
    email: req.session.userEmail,
    name: req.session.userName,
    role: req.session.userRole,
  });
});

router.post("/change-password", async (req, res) => {
  try {
    if (!req.session.userId) return unauthorized(res);

    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      return badRequest(res, "currentPassword and newPassword are required");
    }
    if (newPassword.length < 8) {
      return badRequest(res, "New password must be at least 8 characters");
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (!user) return unauthorized(res, "User not found");

    if (user.passwordHash !== hashPassword(currentPassword)) {
      return unauthorized(res, "Current password is incorrect");
    }

    await db.update(usersTable)
      .set({ passwordHash: hashPassword(newPassword) })
      .where(eq(usersTable.id, user.id));

    ok(res, { message: "Password updated" });
  } catch (err) {
    req.log.error({ err }, "Change password error");
    serverError(res);
  }
});

export { hashPassword };
export default router;
