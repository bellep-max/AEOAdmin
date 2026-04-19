import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  businessesTable,
  clientAeoPlansTable,
  keywordsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireOnboardingToken } from "../middlewares/onboarding-auth";

const router = Router();

interface OnboardingBody {
  customerName: string;
  customerEmail: string;
  businessName: string;
  gmbUrl?: string | null;
  businessAddress?: string | null;
  keywords: string[];
  subscriptionId: string;
}

function validate(raw: unknown): { ok: true; body: OnboardingBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Body must be a JSON object" };
  const r = raw as Record<string, unknown>;
  const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  if (!isStr(r.customerName))           return { ok: false, error: "customerName is required" };
  if (!isStr(r.customerEmail))          return { ok: false, error: "customerEmail is required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.customerEmail as string)) {
    return { ok: false, error: "customerEmail is not a valid email" };
  }
  if (!isStr(r.businessName))           return { ok: false, error: "businessName is required" };
  if (!isStr(r.subscriptionId))  return { ok: false, error: "subscriptionId is required" };
  if (!Array.isArray(r.keywords) || r.keywords.length === 0 || !r.keywords.every(isStr)) {
    return { ok: false, error: "keywords must be a non-empty array of strings" };
  }
  if (r.gmbUrl != null && typeof r.gmbUrl !== "string") {
    return { ok: false, error: "gmbUrl must be a string if provided" };
  }
  if (r.businessAddress != null && typeof r.businessAddress !== "string") {
    return { ok: false, error: "businessAddress must be a string if provided" };
  }
  return {
    ok: true,
    body: {
      customerName:          (r.customerName as string).trim(),
      customerEmail:         (r.customerEmail as string).trim(),
      businessName:          (r.businessName as string).trim(),
      gmbUrl:                typeof r.gmbUrl === "string" && r.gmbUrl.trim() ? r.gmbUrl.trim() : null,
      businessAddress:       typeof r.businessAddress === "string" && r.businessAddress.trim() ? r.businessAddress.trim() : null,
      keywords:              (r.keywords as string[]).map((k) => k.trim()).filter((k) => k.length > 0),
      subscriptionId: (r.subscriptionId as string).trim(),
    },
  };
}

router.post("/", requireOnboardingToken, async (req, res) => {
  const parsed = validate(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const body = parsed.body;

  try {
    // Idempotency: if a campaign with this Recurly subscription_id exists, return it.
    const existingPlan = await db
      .select({
        id: clientAeoPlansTable.id,
        clientId: clientAeoPlansTable.clientId,
        businessId: clientAeoPlansTable.businessId,
      })
      .from(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.subscriptionId, body.subscriptionId))
      .limit(1);

    if (existingPlan.length > 0) {
      const plan = existingPlan[0];
      const existingKws = await db
        .select({ id: keywordsTable.id })
        .from(keywordsTable)
        .where(eq(keywordsTable.aeoPlanId, plan.id));
      return res.status(200).json({
        ok: true,
        idempotent: true,
        clientId: plan.clientId,
        businessId: plan.businessId,
        campaignId: plan.id,
        keywordIds: existingKws.map((k) => k.id),
      });
    }

    const result = await db.transaction(async (tx) => {
      const [client] = await tx
        .insert(clientsTable)
        .values({
          businessName: body.businessName,
          gmbUrl: body.gmbUrl || null,
          accountUserName: body.customerName,
          accountEmail: body.customerEmail,
          contactEmail: body.customerEmail,
          status: "active",
          accountType: "Retail",
        })
        .returning({ id: clientsTable.id });

      const [business] = await tx
        .insert(businessesTable)
        .values({
          clientId: client.id,
          name: body.businessName,
          gmbUrl: body.gmbUrl || null,
          publishedAddress: body.businessAddress || null,
          status: "active",
        })
        .returning({ id: businessesTable.id });

      const [plan] = await tx
        .insert(clientAeoPlansTable)
        .values({
          clientId: client.id,
          businessId: business.id,
          name: "Onboarding",
          planType: "Onboarding",
          subscriptionId: body.subscriptionId,
          searchAddress: body.businessAddress || null,
        })
        .returning({ id: clientAeoPlansTable.id });

      const insertedKws = await tx
        .insert(keywordsTable)
        .values(
          body.keywords.map((text, idx) => ({
            clientId: client.id,
            businessId: business.id,
            aeoPlanId: plan.id,
            keywordText: text,
            keywordType: 3,
            isActive: true,
            isPrimary: idx === 0 ? 1 : 0,
          })),
        )
        .returning({ id: keywordsTable.id });

      return {
        clientId: client.id,
        businessId: business.id,
        campaignId: plan.id,
        keywordIds: insertedKws.map((k) => k.id),
      };
    });

    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "Error creating onboarding record");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
