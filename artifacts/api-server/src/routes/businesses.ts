import { Router } from "express";
import { db } from "@workspace/db";
import { businessesTable, keywordsTable } from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { clientId } = req.query as Record<string, string>;
    const query = db
      .select({
        id: businessesTable.id,
        clientId: businessesTable.clientId,
        name: businessesTable.name,
        gmbUrl: businessesTable.gmbUrl,
        websiteUrl: businessesTable.websiteUrl,
        category: businessesTable.category,
        publishedAddress: businessesTable.publishedAddress,
        searchAddress: businessesTable.searchAddress,
        city: businessesTable.city,
        state: businessesTable.state,
        country: businessesTable.country,
        placeId: businessesTable.placeId,
        latitude: businessesTable.latitude,
        longitude: businessesTable.longitude,
        timezone: businessesTable.timezone,
        websitePublishedOnGmb: businessesTable.websitePublishedOnGmb,
        websiteLinkedOnGmb: businessesTable.websiteLinkedOnGmb,
        status: businessesTable.status,
        notes: businessesTable.notes,
        createdAt: businessesTable.createdAt,
        updatedAt: businessesTable.updatedAt,
        keywordCount: sql<number>`(select count(*) from keywords where keywords.business_id = ${businessesTable.id})::int`,
      })
      .from(businessesTable)
      .orderBy(desc(businessesTable.createdAt));

    const rows = clientId
      ? await query.where(eq(businessesTable.clientId, parseInt(clientId)))
      : await query;

    res.json(rows);
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
        searchAddress: body.searchAddress ?? null,
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
    const body = { ...req.body, updatedAt: new Date() };
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
