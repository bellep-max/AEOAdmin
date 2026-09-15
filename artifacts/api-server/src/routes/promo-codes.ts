/**
 * @file promo-codes.ts
 * @route /api/promo-codes
 *
 * Promo code catalog — created and listed on the admin Promo Codes page,
 * attached to a campaign via PATCH /clients/:clientId/aeo-plans/:planId
 * (promoCodeId). Admin/owner only: discount terms are billing data.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { promoCodesTable, clientAeoPlansTable } from "@workspace/db/schema";
import { eq, desc, isNotNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/role-auth";

const router = Router();

interface PromoInput {
  code?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  providedBy?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize + validate a create/update payload. `partial` skips required-field
 * checks for PATCH. Returns the row values or an error string.
 */
function parsePromoInput(
  body: PromoInput,
  partial: boolean,
):
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string } {
  const values: Record<string, unknown> = {};

  if (body.code !== undefined) {
    const code = String(body.code ?? "").trim();
    if (!code) return { ok: false, error: "code is required" };
    values.code = code;
  } else if (!partial) {
    return { ok: false, error: "code is required" };
  }

  if (body.discountType !== undefined) {
    const t = String(body.discountType ?? "");
    if (!["percent", "amount"].includes(t))
      return { ok: false, error: "discountType must be percent or amount" };
    values.discountType = t;
  }

  if (body.discountValue !== undefined) {
    if (body.discountValue === null) {
      values.discountValue = null;
    } else {
      const v = Number(body.discountValue);
      if (!Number.isFinite(v) || v <= 0)
        return { ok: false, error: "discountValue must be a positive number" };
      values.discountValue = String(v);
    }
  }

  for (const f of ["startDate", "endDate"] as const) {
    if (body[f] === undefined) continue;
    if (body[f] === null) {
      values[f] = null;
    } else {
      const d = String(body[f]);
      if (!DATE_RE.test(d))
        return { ok: false, error: `${f} must be YYYY-MM-DD` };
      values[f] = d;
    }
  }

  if (body.providedBy !== undefined) {
    values.providedBy =
      body.providedBy === null ? null : String(body.providedBy).trim() || null;
  }

  return { ok: true, values };
}

/** 409 payload when `code` collides (case-insensitive) with another promo. */
async function findCodeConflict(
  code: string,
  excludeId: number | null,
): Promise<{ id: number; code: string } | null> {
  const [conflict] = await db
    .select({ id: promoCodesTable.id, code: promoCodesTable.code })
    .from(promoCodesTable)
    .where(
      excludeId != null
        ? sql`lower(${promoCodesTable.code}) = lower(${code}) AND ${promoCodesTable.id} <> ${excludeId}`
        : sql`lower(${promoCodesTable.code}) = lower(${code})`,
    )
    .limit(1);
  return conflict ?? null;
}

/**
 * GET /api/promo-codes
 * All promo codes, newest first, each with how many campaigns use it.
 */
router.get("/", requireAdmin, async (req, res) => {
  try {
    const promos = await db
      .select()
      .from(promoCodesTable)
      .orderBy(desc(promoCodesTable.createdAt));
    const usage = await db
      .select({
        promoCodeId: clientAeoPlansTable.promoCodeId,
        c: sql<number>`count(*)::int`,
      })
      .from(clientAeoPlansTable)
      .where(isNotNull(clientAeoPlansTable.promoCodeId))
      .groupBy(clientAeoPlansTable.promoCodeId);
    const counts = new Map(usage.map((u) => [u.promoCodeId, u.c]));
    res.json(
      promos.map((p) => ({ ...p, campaignCount: counts.get(p.id) ?? 0 })),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing promo codes");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/promo-codes
 */
router.post("/", requireAdmin, async (req, res) => {
  try {
    const parsed = parsePromoInput((req.body ?? {}) as PromoInput, false);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const conflict = await findCodeConflict(parsed.values.code as string, null);
    if (conflict) {
      return res.status(409).json({
        error: `Promo code "${conflict.code}" already exists (id ${conflict.id}).`,
        conflictId: conflict.id,
      });
    }

    const [promo] = await db
      .insert(promoCodesTable)
      .values(parsed.values as typeof promoCodesTable.$inferInsert)
      .returning();
    res.status(201).json({ ...promo, campaignCount: 0 });
  } catch (err) {
    req.log.error({ err }, "Error creating promo code");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/promo-codes/:id
 */
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const parsed = parsePromoInput((req.body ?? {}) as PromoInput, true);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    if (Object.keys(parsed.values).length === 0)
      return res.status(400).json({ error: "No valid fields to update" });

    if (typeof parsed.values.code === "string") {
      const conflict = await findCodeConflict(parsed.values.code, id);
      if (conflict) {
        return res.status(409).json({
          error: `Promo code "${conflict.code}" already exists (id ${conflict.id}).`,
          conflictId: conflict.id,
        });
      }
    }

    const [promo] = await db
      .update(promoCodesTable)
      .set({ ...parsed.values, updatedAt: new Date() })
      .where(eq(promoCodesTable.id, id))
      .returning();
    if (!promo) return res.status(404).json({ error: "Not found" });
    res.json(promo);
  } catch (err) {
    req.log.error({ err }, "Error updating promo code");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/promo-codes/:id
 * Campaigns referencing the promo keep running — their promo_code_id clears
 * via the FK's ON DELETE SET NULL.
 */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const deleted = await db
      .delete(promoCodesTable)
      .where(eq(promoCodesTable.id, id))
      .returning({ id: promoCodesTable.id });
    if (deleted.length === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting promo code");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
