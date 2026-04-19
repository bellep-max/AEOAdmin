import { Router } from "express";
import { db } from "@workspace/db";
import { businessesTable, keywordsTable, clientAeoPlansTable } from "@workspace/db/schema";
import { eq, desc, inArray, sql } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { clientId } = req.query as Record<string, string>;
    const query = db.select().from(businessesTable).orderBy(desc(businessesTable.createdAt));
    const rows = clientId
      ? await query.where(eq(businessesTable.clientId, parseInt(clientId)))
      : await query;

    const ids = rows.map((b) => b.id);
    const counts = new Map<number, { keywordCount: number; campaignCount: number }>();
    for (const id of ids) counts.set(id, { keywordCount: 0, campaignCount: 0 });

    if (ids.length > 0) {
      const kwRows = await db
        .select({ businessId: keywordsTable.businessId, c: sql<number>`count(*)::int` })
        .from(keywordsTable)
        .where(inArray(keywordsTable.businessId, ids))
        .groupBy(keywordsTable.businessId);
      for (const r of kwRows) {
        if (r.businessId != null) counts.get(r.businessId)!.keywordCount = Number(r.c);
      }

      const cpRows = await db
        .select({ businessId: clientAeoPlansTable.businessId, c: sql<number>`count(*)::int` })
        .from(clientAeoPlansTable)
        .where(inArray(clientAeoPlansTable.businessId, ids))
        .groupBy(clientAeoPlansTable.businessId);
      for (const r of cpRows) {
        if (r.businessId != null) counts.get(r.businessId)!.campaignCount = Number(r.c);
      }
    }

    res.json(rows.map((b) => ({ ...b, ...counts.get(b.id)! })));
  } catch (err) {
    req.log.error({ err }, "Error fetching businesses");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, id));
    if (!business) return res.status(404).json({ error: "Not found" });
    res.json(business);
  } catch (err) {
    req.log.error({ err }, "Error fetching business");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body;
    if (!body.clientId || !body.name) {
      return res.status(400).json({ error: "clientId and name are required" });
    }
    const [business] = await db
      .insert(businessesTable)
      .values({
        clientId: body.clientId,
        name: body.name,
        gmbUrl: body.gmbUrl ?? null,
        websiteUrl: body.websiteUrl ?? null,
        category: body.category ?? null,
        publishedAddress: body.publishedAddress ?? null,
        zipCode: body.zipCode ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        country: body.country ?? null,
        placeId: body.placeId ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        timezone: body.timezone ?? null,
        websitePublishedOnGmb: body.websitePublishedOnGmb ?? null,
        websiteLinkedOnGmb: body.websiteLinkedOnGmb ?? null,
        status: body.status ?? "active",
        notes: body.notes ?? null,
      })
      .returning();
    res.status(201).json(business);
  } catch (err) {
    req.log.error({ err }, "Error creating business");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { searchAddress: _ignored, ...rest } = req.body ?? {};
    const body = { ...rest, updatedAt: new Date() };
    const [business] = await db
      .update(businessesTable)
      .set(body)
      .where(eq(businessesTable.id, id))
      .returning();
    if (!business) return res.status(404).json({ error: "Not found" });
    res.json(business);
  } catch (err) {
    req.log.error({ err }, "Error updating business");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(businessesTable).where(eq(businessesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting business");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
