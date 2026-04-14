import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import healthRouter from "./health";
import authRouter from "./auth";
import metricsRouter from "./metrics";
import clientsRouter from "./clients";
import keywordsRouter from "./keywords";
import clientAeoPlansRouter from "./client-aeo-plans";
import aeoPlansRouter from "./aeo-plans";
import sessionsRouter from "./sessions";
import devicesRouter from "./devices";
import proxiesRouter from "./proxies";
import plansRouter from "./plans";
import rankingReportsRouter from "./ranking-reports";
import tasksRouter from "./tasks";
import dashboardRouter from "./dashboard";
import scalingRouter from "./scaling";
import farmMetricsRouter from "./farm-metrics";
import auditLogsRouter from "./audit-logs";
import packagesRouter from "./packages";
import deviceRotationsRouter from "./device-rotations";
import sessionPlatformsRouter from "./session-platforms";

const router: IRouter = Router();

// Public routes (no auth required)
router.use(healthRouter);
router.use("/auth", authRouter);

// Protected routes (auth required)
router.use(requireAuth);
router.use("/metrics", metricsRouter);
router.use("/clients", clientsRouter);
router.use("/clients/:clientId/aeo-plans", clientAeoPlansRouter);
router.use("/aeo-plans", aeoPlansRouter);
router.use("/keywords", keywordsRouter);
router.use("/sessions", sessionsRouter);
router.use("/devices", devicesRouter);
router.use("/proxies", proxiesRouter);
router.use("/plans", plansRouter);
router.use("/ranking-reports", rankingReportsRouter);
router.use("/tasks", tasksRouter);
router.use("/dashboard", dashboardRouter);
router.use("/scaling", scalingRouter);
router.use("/farm-metrics", farmMetricsRouter);
router.use("/audit-logs", auditLogsRouter);
router.use("/packages", packagesRouter);
router.use("/device-rotations", deviceRotationsRouter);
router.use("/session-platforms", sessionPlatformsRouter);

export default router;
