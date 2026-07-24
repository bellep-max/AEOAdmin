import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  businessesTable,
  clientAeoPlansTable,
  keywordsTable,
} from "@workspace/db/schema";
import { eq, or, and, ne, sql } from "drizzle-orm";
import { requireOnboardingToken } from "../middlewares/onboarding-auth";
import { requireFreeTrialToken } from "../middlewares/free-trial-auth";
import { sendFreeTrialEmails } from "../services/free-trial-email";
import { fetchStripeBillingDetails } from "../services/stripe-billing";
import { regenerateForKeyword } from "../services/variant-rotation";
import { generateKeywords } from "../services/keyword-generator";

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

function validate(
  raw: unknown,
): { ok: true; body: OnboardingBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object")
    return { ok: false, error: "Body must be a JSON object" };
  const r = raw as Record<string, unknown>;
  const isStr = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  if (!isStr(r.customerName))
    return { ok: false, error: "customerName is required" };
  if (!isStr(r.customerEmail))
    return { ok: false, error: "customerEmail is required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.customerEmail as string)) {
    return { ok: false, error: "customerEmail is not a valid email" };
  }
  if (!isStr(r.businessName))
    return { ok: false, error: "businessName is required" };
  if (!isStr(r.subscriptionId))
    return { ok: false, error: "subscriptionId is required" };
  if (
    !Array.isArray(r.keywords) ||
    r.keywords.length === 0 ||
    !r.keywords.every(isStr)
  ) {
    return {
      ok: false,
      error: "keywords must be a non-empty array of strings",
    };
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
      customerName: (r.customerName as string).trim(),
      customerEmail: (r.customerEmail as string).trim(),
      businessName: (r.businessName as string).trim(),
      gmbUrl:
        typeof r.gmbUrl === "string" && r.gmbUrl.trim()
          ? r.gmbUrl.trim()
          : null,
      businessAddress:
        typeof r.businessAddress === "string" && r.businessAddress.trim()
          ? r.businessAddress.trim()
          : null,
      keywords: (r.keywords as string[])
        .map((k) => k.trim())
        .filter((k) => k.length > 0),
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

// ── Free-trial signup intake (external marketing site) ──
interface FreeTrialBody {
  businessName: string;
  /** May be empty — when so, the admin generates the keyword set server-side. */
  keywords: string[];
  email: string;
  address: string | null;
  /** City, used to localize the welcome email copy; may be null. */
  city: string | null;
  state: string | null;
  /** Google Business Profile link; when absent we derive one from placeId. */
  gmbUrl: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  /** Business service/category, used to generate keywords when none are sent. */
  service: string | null;
  brand: string | null;
  leadRef: string | null;
  source: string | null;
  /** Full contact name as captured (persisted on the client); may be null. */
  contactName: string | null;
  /** First token of the contact name, for the welcome greeting; may be null. */
  firstName: string | null;
  /**
   * "trial" (default) → Free Trial Plans; "direct" → a paid "Signal AEO Plan"
   * client (customer chose to start the service, not the trial). Billing start
   * stays manual either way.
   */
  signupType: "trial" | "direct";
  /** Stripe customer id (cus_) captured at trial signup — preferred. */
  stripeCustomerId: string | null;
  /** Stripe subscription id (sub_) — only once converted to paid. */
  stripeSubscriptionId: string | null;
}

/**
 * The contact's full name and first name from whatever the signup form sent.
 * Accepts `contactName`/`customerName` (full) and/or an explicit `firstName`.
 */
function resolveNames(r: Record<string, unknown>): {
  contactName: string | null;
  firstName: string | null;
} {
  const isStr = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  const full = isStr(r.contactName)
    ? r.contactName.trim()
    : isStr(r.customerName)
      ? r.customerName.trim()
      : isStr(r.firstName)
        ? r.firstName.trim()
        : null;
  const firstName = isStr(r.firstName)
    ? r.firstName.trim()
    : full
      ? full.split(/\s+/)[0] || null
      : null;
  return { contactName: full, firstName };
}

function validateFreeTrial(
  raw: unknown,
): { ok: true; body: FreeTrialBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object")
    return { ok: false, error: "Body must be a JSON object" };
  const r = raw as Record<string, unknown>;
  const isStr = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  if (!isStr(r.businessName))
    return { ok: false, error: "businessName is required" };
  if (!isStr(r.email)) return { ok: false, error: "email is required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
    return { ok: false, error: "email is not a valid email" };
  }
  if (
    r.keywords != null &&
    (!Array.isArray(r.keywords) || !r.keywords.every(isStr))
  ) {
    return {
      ok: false,
      error: "keywords must be an array of strings if provided",
    };
  }
  for (const opt of [
    "address",
    "city",
    "state",
    "gmbUrl",
    "placeId",
    "website",
    "service",
    "brand",
    "leadRef",
    "source",
  ]) {
    if (r[opt] != null && typeof r[opt] !== "string") {
      return { ok: false, error: `${opt} must be a string if provided` };
    }
  }
  for (const opt of ["lat", "lng"]) {
    if (r[opt] != null && typeof r[opt] !== "number") {
      return { ok: false, error: `${opt} must be a number if provided` };
    }
  }
  if (r.stripeCustomerId != null) {
    if (typeof r.stripeCustomerId !== "string") {
      return { ok: false, error: "stripeCustomerId must be a string" };
    }
    if (r.stripeCustomerId.trim() && !r.stripeCustomerId.startsWith("cus_")) {
      return {
        ok: false,
        error: "stripeCustomerId must be a Stripe customer id (cus_…)",
      };
    }
  }
  if (r.stripeSubscriptionId != null) {
    if (typeof r.stripeSubscriptionId !== "string") {
      return { ok: false, error: "stripeSubscriptionId must be a string" };
    }
    if (
      r.stripeSubscriptionId.trim() &&
      !r.stripeSubscriptionId.startsWith("sub_")
    ) {
      return {
        ok: false,
        error: "stripeSubscriptionId must be a Stripe subscription id (sub_…)",
      };
    }
  }
  if (
    r.signupType != null &&
    r.signupType !== "trial" &&
    r.signupType !== "direct"
  ) {
    return { ok: false, error: 'signupType must be "trial" or "direct"' };
  }
  return {
    ok: true,
    body: {
      businessName: r.businessName.trim(),
      email: r.email.trim().toLowerCase(),
      keywords: Array.isArray(r.keywords)
        ? (r.keywords as string[])
            .map((k) => k.trim())
            .filter((k) => k.length > 0)
        : [],
      address: isStr(r.address) ? r.address.trim() : null,
      city: isStr(r.city) ? r.city.trim() : null,
      state: isStr(r.state) ? r.state.trim() : null,
      gmbUrl: isStr(r.gmbUrl) ? r.gmbUrl.trim() : null,
      placeId: isStr(r.placeId) ? r.placeId.trim() : null,
      lat: typeof r.lat === "number" && Number.isFinite(r.lat) ? r.lat : null,
      lng: typeof r.lng === "number" && Number.isFinite(r.lng) ? r.lng : null,
      website: isStr(r.website) ? r.website.trim() : null,
      service: isStr(r.service) ? r.service.trim() : null,
      brand: isStr(r.brand) ? r.brand.trim() : null,
      leadRef: isStr(r.leadRef) ? r.leadRef.trim() : null,
      source: isStr(r.source) ? r.source.trim() : null,
      ...resolveNames(r),
      signupType: r.signupType === "direct" ? "direct" : "trial",
      stripeCustomerId: isStr(r.stripeCustomerId)
        ? r.stripeCustomerId.trim()
        : null,
      stripeSubscriptionId: isStr(r.stripeSubscriptionId)
        ? r.stripeSubscriptionId.trim()
        : null,
    },
  };
}

/** URL-safe slug from a business name; empty input falls back to "client". */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/['’]/g, "") // drop apostrophes so "joe's" -> "joes", not "joe-s"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "client"
  );
}

/** The CRM match payload for an existing free-trial client (ids + slug). */
async function buildProofResponse(clientId: number) {
  const [client] = await db
    .select({ slug: clientsTable.slug })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId))
    .limit(1);
  const [business] = await db
    .select({ id: businessesTable.id })
    .from(businessesTable)
    .where(eq(businessesTable.clientId, clientId))
    .orderBy(businessesTable.id)
    .limit(1);
  const [plan] = await db
    .select({ id: clientAeoPlansTable.id })
    .from(clientAeoPlansTable)
    .where(eq(clientAeoPlansTable.clientId, clientId))
    .orderBy(clientAeoPlansTable.id)
    .limit(1);
  const kws = await db
    .select({ id: keywordsTable.id })
    .from(keywordsTable)
    .where(eq(keywordsTable.clientId, clientId))
    .orderBy(keywordsTable.id);
  return {
    clientId,
    businessId: business?.id ?? null,
    campaignId: plan?.id ?? null,
    keywordIds: kws.map((k) => k.id),
    proofClientSlug: client?.slug ?? null,
  };
}

router.post("/free-trial", requireFreeTrialToken, async (req, res) => {
  const parsed = validateFreeTrial(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const body = parsed.body;

  // Idempotency key: explicit X-Idempotency-Key header wins, else "brand:leadRef".
  const headerKey = req.header("x-idempotency-key")?.trim() || null;
  const idempotencyKey =
    headerKey ||
    (body.brand && body.leadRef ? `${body.brand}:${body.leadRef}` : null);

  try {
    // 1. Idempotency by explicit lead key (preferred). Only active clients
    //    dedup — a soft-deleted (status='inactive') client must not block a
    //    re-signup, else the customer is "already deleted but not restarting".
    if (idempotencyKey) {
      const [byKey] = await db
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(
          and(
            eq(clientsTable.idempotencyKey, idempotencyKey),
            ne(clientsTable.status, "inactive"),
          ),
        )
        .limit(1);
      if (byKey) {
        const proof = await buildProofResponse(byKey.id);
        return res.status(200).json({ ok: true, idempotent: true, ...proof });
      }
    }

    // 2. Idempotency by email (the floor — never duplicate a client per email).
    //    Same active-only rule: a deleted client with this email must not
    //    swallow the new signup.
    const [byEmail] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(
        and(
          ne(clientsTable.status, "inactive"),
          or(
            sql`lower(${clientsTable.contactEmail}) = ${body.email}`,
            sql`lower(${clientsTable.accountEmail}) = ${body.email}`,
            sql`lower(${clientsTable.billingEmail}) = ${body.email}`,
          ),
        ),
      )
      .limit(1);
    if (byEmail) {
      const proof = await buildProofResponse(byEmail.id);
      return res.status(200).json({ ok: true, idempotent: true, ...proof });
    }

    // Stripe billing details (card last-4, billing email, dates). Keyed on the
    // customer id captured at signup (cus_); a subscription id (sub_) also works
    // once converted. Fail-soft: never blocks the signup — on any error the
    // fields stay null. Kept out of the transaction (no network I/O in a DB tx),
    // and only for genuinely new signups (dups returned above).
    const stripeRef = body.stripeCustomerId ?? body.stripeSubscriptionId;
    const billing = stripeRef
      ? await fetchStripeBillingDetails(stripeRef, { log: req.log })
      : null;

    // The admin owns the keyword set: when the signup arrives without keywords
    // (the marketing site no longer generates them), we generate them here from
    // the business, service, and location. Kept out of the transaction (network
    // I/O). Fail-soft — the client is still created if generation fails; keywords
    // can be added later on the admin Keywords page.
    let keywords = body.keywords;
    if (keywords.length === 0) {
      try {
        const gen = await generateKeywords({
          businessName: body.businessName,
          service: body.service,
          location: body.address,
          website: body.website,
        });
        keywords = gen.keywords;
      } catch (err) {
        req.log.error({ err }, "free-trial keyword generation failed");
      }
    }

    // Direct signups become a paid "Signal AEO Plan" client; trials stay on
    // "Free Trial Plans". The Stripe subscription start is manual in both cases —
    // this only sets how the client is labelled and routed in the admin.
    const isDirect = body.signupType === "direct";
    const accountType = isDirect ? "Retail" : "Free Trial";
    const planName = isDirect ? "Signal AEO Plan" : "Free Trial";
    const planType = isDirect ? "Signal AEO Plan" : "Free Trial Plans";
    const createdBy = isDirect ? "direct-signup" : "free-trial-signup";
    // Campaign name follows the admin convention "{Business} — {Full address}"
    // so trial campaigns are identifiable instead of all reading "Free Trial".
    // Falls back to the business name alone when no address was captured.
    const campaignName = body.address
      ? `${body.businessName} — ${body.address}`
      : body.businessName;

    // 3. Create.
    // GMB link: explicit when the funnel sends one, else derived from the
    // Google place id (the canonical maps link for that listing).
    const gmbUrl =
      body.gmbUrl ??
      (body.placeId
        ? `https://www.google.com/maps/place/?q=place_id:${body.placeId}`
        : null);

    const result = await db.transaction(async (tx) => {
      const [client] = await tx
        .insert(clientsTable)
        .values({
          businessName: body.businessName,
          websiteUrl: body.website,
          publishedAddress: body.address,
          gmbUrl,
          placeId: body.placeId,
          city: body.city,
          state: body.state,
          latitude: body.lat,
          longitude: body.lng,
          accountUserName: body.contactName,
          contactEmail: body.email,
          accountEmail: body.email,
          status: "active",
          accountType,
          planName,
          brand: body.brand,
          leadRef: body.leadRef,
          source: body.source,
          subscriptionId: stripeRef,
          lastFourCard: billing?.cardLast4 ?? null,
          billingEmail: billing?.billingEmail ?? null,
          idempotencyKey,
          createdBy,
        })
        .returning({ id: clientsTable.id });

      // Permanent proof slug from the business name; append the id only on a
      // collision so the common case stays clean ("joes-plumbing").
      const base = slugify(body.businessName);
      const [clash] = await tx
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.slug, base), ne(clientsTable.id, client.id)))
        .limit(1);
      const slug = clash ? `${base}-${client.id}` : base;
      await tx
        .update(clientsTable)
        .set({ slug })
        .where(eq(clientsTable.id, client.id));

      const [business] = await tx
        .insert(businessesTable)
        .values({
          clientId: client.id,
          name: body.businessName,
          websiteUrl: body.website,
          publishedAddress: body.address,
          gmbUrl,
          status: "active",
          createdBy,
        })
        .returning({ id: businessesTable.id });

      const [plan] = await tx
        .insert(clientAeoPlansTable)
        .values({
          clientId: client.id,
          businessId: business.id,
          name: campaignName,
          businessName: body.businessName,
          planType,
          searchAddress: body.address,
          subscriptionId: stripeRef,
          cardLast4: billing?.cardLast4 ?? null,
          subscriptionStartDate: billing?.subscriptionStartDate ?? null,
          nextBillingDate: billing?.nextBillingDate ?? null,
          trialStartDate: isDirect
            ? null
            : new Date().toISOString().slice(0, 10),
          paidConversionDate: isDirect
            ? new Date().toISOString().slice(0, 10)
            : null,
          createdBy,
        })
        .returning({ id: clientAeoPlansTable.id });

      const insertedKws =
        keywords.length > 0
          ? await tx
              .insert(keywordsTable)
              .values(
                keywords.map((text, idx) => ({
                  clientId: client.id,
                  businessId: business.id,
                  aeoPlanId: plan.id,
                  keywordText: text,
                  keywordType: 3,
                  isActive: true,
                  isPrimary: idx === 0 ? 1 : 0,
                })),
              )
              .returning({ id: keywordsTable.id })
          : [];

      return {
        clientId: client.id,
        businessId: business.id,
        campaignId: plan.id,
        keywordIds: insertedKws.map((k) => k.id),
        proofClientSlug: slug,
      };
    });

    // New signup only. Auto-generate keyword variants so the device-farm has an
    // active pool to run against — onboarding creates keywords but the runner
    // only picks up active variants. Fail-soft per keyword (never blocks the
    // signup) and parallel so total latency ≈ one DeepSeek call, not N.
    const variantRuns = await Promise.allSettled(
      result.keywordIds.map((id) => regenerateForKeyword(id)),
    );
    const variantFailures = variantRuns.filter((r) => r.status === "rejected");
    if (variantFailures.length > 0) {
      req.log.warn(
        {
          clientId: result.clientId,
          failed: variantFailures.length,
          total: result.keywordIds.length,
          errors: variantFailures.map((r) =>
            r.status === "rejected" ? String(r.reason) : "",
          ),
        },
        "free-trial variant generation had failures",
      );
    }

    // Send the welcome + owner alert. Fail-soft: never let an email issue break
    // the signup.
    const emailResult = await sendFreeTrialEmails(
      {
        businessName: body.businessName,
        recipientEmail: body.email,
        clientId: result.clientId,
        proofClientSlug: result.proofClientSlug,
        brand: body.brand,
        leadRef: body.leadRef,
        source: body.source,
        firstName: body.firstName,
        city: body.city,
        isDirect,
      },
      { log: req.log },
    );
    if (emailResult.errors.length > 0) {
      req.log.warn({ emailResult }, "free-trial emails had issues");
    }

    res
      .status(201)
      .json({ ok: true, ...result, brand: body.brand, leadRef: body.leadRef });
  } catch (err) {
    req.log.error({ err }, "Error creating free-trial signup");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
