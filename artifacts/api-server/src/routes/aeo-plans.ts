/**
 * @file aeo-plans.ts
 * @route /api/aeo-plans
 *
 * Global AEO plans endpoint — returns all client AEO plans joined with
 * client name. Used by the global Plans table in the admin panel.
 * CRUD operations still go through /api/clients/:clientId/aeo-plans.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { clientAeoPlansTable } from "@workspace/db/schema";
import { clientsTable } from "@workspace/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { requireSalesAllowed } from "../middlewares/role-auth";
import {
  getScopedClientIds,
  isScopedRole,
  LOCAL_ADMIN_PLAN_TYPES,
} from "../lib/scoped-access";

const router = Router();

/**
 * GET /api/aeo-plans/plan-types
 * The distinct plan types the current session may filter by. Owners get every
 * plan type present in client_aeo_plans; every scoped role gets ONLY the local
 * plans (they can never see free-trial / non-local plans). Powers the role-aware
 * "plan type" filter on the Rankings and Sent Emails pages.
 */
router.get("/plan-types", requireSalesAllowed, async (req, res) => {
  try {
    if (isScopedRole(req)) {
      return res.json({ planTypes: [...LOCAL_ADMIN_PLAN_TYPES] });
    }
    const rows = await db
      .selectDistinct({ planType: clientAeoPlansTable.planType })
      .from(clientAeoPlansTable);
    const planTypes = rows
      .map((r) => r.planType)
      .filter((p): p is string => !!p && p.trim().length > 0)
      .sort((a, b) => a.localeCompare(b));
    res.json({ planTypes });
  } catch (err) {
    req.log.error({ err }, "Error fetching plan types");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/aeo-plans
 * Returns all AEO plans across all clients, joined with client businessName.
 * Scoped roles (sales / account-manager / chuckslocal) only see plans for
 * clients within their slice — see getScopedClientIds.
 */
router.get("/", requireSalesAllowed, async (req, res) => {
  try {
    const eligibleIds = await getScopedClientIds(req);
    if (eligibleIds !== null && eligibleIds.length === 0) return res.json([]);

    const plans = await db
      .select({
        id: clientAeoPlansTable.id,
        clientId: clientAeoPlansTable.clientId,
        businessId: clientAeoPlansTable.businessId,
        name: clientAeoPlansTable.name,
        clientBusinessName: clientsTable.businessName,
        businessName: clientAeoPlansTable.businessName,
        planType: clientAeoPlansTable.planType,
        sampleQuestion1: clientAeoPlansTable.sampleQuestion1,
        sampleQuestion2: clientAeoPlansTable.sampleQuestion2,
        sampleQuestion3: clientAeoPlansTable.sampleQuestion3,
        sampleQuestion4: clientAeoPlansTable.sampleQuestion4,
        sampleQuestion5: clientAeoPlansTable.sampleQuestion5,
        sampleQuestion6: clientAeoPlansTable.sampleQuestion6,
        sampleQuestion7: clientAeoPlansTable.sampleQuestion7,
        sampleQuestion8: clientAeoPlansTable.sampleQuestion8,
        sampleQuestion9: clientAeoPlansTable.sampleQuestion9,
        sampleQuestion10: clientAeoPlansTable.sampleQuestion10,
        currentAnswerPresence: clientAeoPlansTable.currentAnswerPresence,
        searchBoostTarget: clientAeoPlansTable.searchBoostTarget,
        monthlyAeoBudget: clientAeoPlansTable.monthlyAeoBudget,
        schemaImplementor: clientAeoPlansTable.schemaImplementor,
        searchAddress: clientAeoPlansTable.searchAddress,
        createdAt: clientAeoPlansTable.createdAt,
        updatedAt: clientAeoPlansTable.updatedAt,
      })
      .from(clientAeoPlansTable)
      .leftJoin(clientsTable, eq(clientAeoPlansTable.clientId, clientsTable.id))
      .where(
        eligibleIds !== null
          ? inArray(clientAeoPlansTable.clientId, eligibleIds)
          : undefined,
      )
      .orderBy(asc(clientAeoPlansTable.createdAt));

    res.json(
      plans.map((p) => ({
        ...p,
        monthlyAeoBudget:
          p.monthlyAeoBudget != null ? Number(p.monthlyAeoBudget) : null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching all AEO plans");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
