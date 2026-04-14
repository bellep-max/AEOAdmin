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
import { clientAeoPlansTable, clientsTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { ok, serverError } from "../lib/response";
import "../middleware/auth";

const router = Router();

/**
 * GET /api/aeo-plans
 * Returns all AEO plans across all clients, joined with client businessName.
 */
router.get("/", async (req, res) => {
  try {
    const plans = await db
      .select({
        id:                     clientAeoPlansTable.id,
        clientId:               clientAeoPlansTable.clientId,
        clientBusinessName:     clientsTable.businessName,
        businessName:           clientAeoPlansTable.businessName,
        planType:               clientAeoPlansTable.planType,
        serviceCategory:        clientAeoPlansTable.serviceCategory,
        targetCityRadius:       clientAeoPlansTable.targetCityRadius,
        sampleQuestion1:        clientAeoPlansTable.sampleQuestion1,
        sampleQuestion2:        clientAeoPlansTable.sampleQuestion2,
        sampleQuestion3:        clientAeoPlansTable.sampleQuestion3,
        sampleQuestion4:        clientAeoPlansTable.sampleQuestion4,
        sampleQuestion5:        clientAeoPlansTable.sampleQuestion5,
        sampleQuestion6:        clientAeoPlansTable.sampleQuestion6,
        sampleQuestion7:        clientAeoPlansTable.sampleQuestion7,
        sampleQuestion8:        clientAeoPlansTable.sampleQuestion8,
        sampleQuestion9:        clientAeoPlansTable.sampleQuestion9,
        sampleQuestion10:       clientAeoPlansTable.sampleQuestion10,
        currentAnswerPresence:  clientAeoPlansTable.currentAnswerPresence,
        searchBoostTarget:      clientAeoPlansTable.searchBoostTarget,
        monthlyAeoBudget:       clientAeoPlansTable.monthlyAeoBudget,
        schemaImplementor:      clientAeoPlansTable.schemaImplementor,
        createdAt:              clientAeoPlansTable.createdAt,
        updatedAt:              clientAeoPlansTable.updatedAt,
      })
      .from(clientAeoPlansTable)
      .leftJoin(clientsTable, eq(clientAeoPlansTable.clientId, clientsTable.id))
      .orderBy(asc(clientAeoPlansTable.createdAt));

    ok(
      res,
      plans.map((p) => ({
        ...p,
        monthlyAeoBudget: p.monthlyAeoBudget != null ? Number(p.monthlyAeoBudget) : null,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching all AEO plans");
    serverError(res);
  }
});

export default router;
