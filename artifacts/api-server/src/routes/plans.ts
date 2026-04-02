import { Router } from "express";
import { db } from "@workspace/db";
import { plansTable } from "@workspace/db/schema";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const plans = await db.select().from(plansTable);
    res.json(
      plans.map((p) => ({
        ...p,
        cost: Number(p.cost),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching plans");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
