import { Router } from "express";
import { db } from "@workspace/db";
import { clientsTable } from "@workspace/db/schema";
import { count, eq } from "drizzle-orm";

const router = Router();

router.get("/plan", async (req, res) => {
  try {
    const [activeClients] = await db
      .select({ count: count() })
      .from(clientsTable)
      .where(eq(clientsTable.status, "active"));

    const currentCount = Number(activeClients.count);

    const milestones = [
      {
        id: 1,
        phase: "Current Network Testing",
        targetDate: new Date("2026-04-02T00:00:00Z"),
        targetCompanies: 20,
        currentCompanies: currentCount,
        devicesNeeded: 100,
        devicesAvailable: 0,
        status: "active" as const,
        notes: "Fully testing current network with 20 companies. 1 search per device per day. Confirming setup and scaling from 1 search per day.",
      },
      {
        id: 2,
        phase: "Network Expansion — 50 Companies",
        targetDate: new Date("2026-04-07T00:00:00Z"),
        targetCompanies: 50,
        currentCompanies: currentCount,
        devicesNeeded: 250,
        devicesAvailable: 0,
        status: "upcoming" as const,
        notes: "Add 50 companies in first week of April. Hardware procurement begins. 5 AEO keywords per company.",
      },
      {
        id: 3,
        phase: "Hardware Procurement — 80 Companies",
        targetDate: new Date("2026-04-14T00:00:00Z"),
        targetCompanies: 80,
        currentCompanies: currentCount,
        devicesNeeded: 400,
        devicesAvailable: 0,
        status: "upcoming" as const,
        notes: "Second week of April: scale to 80 companies. Find and purchase hardware for 80-company operation. Budget for Android device farm expansion.",
      },
      {
        id: 4,
        phase: "May Scale — 150 Companies",
        targetDate: new Date("2026-05-01T00:00:00Z"),
        targetCompanies: 150,
        currentCompanies: currentCount,
        devicesNeeded: 750,
        devicesAvailable: 0,
        status: "upcoming" as const,
        notes: "May 2026 target: 150 local SEO companies. Full hardware procurement complete. All local SEO companies onboarded.",
      },
    ];

    res.json(milestones);
  } catch (err) {
    req.log.error({ err }, "Error fetching scaling plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
