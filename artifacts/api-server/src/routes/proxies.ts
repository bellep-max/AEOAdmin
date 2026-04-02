import { Router } from "express";
import { db } from "@workspace/db";
import { proxiesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { proxyType } = req.query as Record<string, string>;
    const proxies = await db
      .select()
      .from(proxiesTable)
      .where(proxyType ? eq(proxiesTable.proxyType, proxyType) : undefined);
    res.json(proxies);
  } catch (err) {
    req.log.error({ err }, "Error fetching proxies");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const [proxy] = await db
      .insert(proxiesTable)
      .values({
        proxyUrl: req.body.proxyUrl,
        proxyType: req.body.proxyType ?? "residential",
      })
      .returning();
    res.status(201).json(proxy);
  } catch (err) {
    req.log.error({ err }, "Error creating proxy");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
