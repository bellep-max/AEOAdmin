import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import crypto from "crypto";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Seed admin user endpoint - only for development
router.post("/seed-admin", async (req, res) => {
  try {
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

    res.json({
      success: true,
      message: "Admin user seeded successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        credentials: "admin@signalaeo.com / Admin123!",
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
