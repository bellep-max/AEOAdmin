import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import metricsRouter from "./metrics";
import clientsRouter from "./clients";
import keywordsRouter from "./keywords";
import sessionsRouter from "./sessions";
import devicesRouter from "./devices";
import proxiesRouter from "./proxies";
import plansRouter from "./plans";
import rankingReportsRouter from "./ranking-reports";
import tasksRouter from "./tasks";
import dashboardRouter from "./dashboard";
import scalingRouter from "./scaling";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/metrics", metricsRouter);
router.use("/clients", clientsRouter);
router.use("/keywords", keywordsRouter);
router.use("/sessions", sessionsRouter);
router.use("/devices", devicesRouter);
router.use("/proxies", proxiesRouter);
router.use("/plans", plansRouter);
router.use("/ranking-reports", rankingReportsRouter);
router.use("/tasks", tasksRouter);
router.use("/dashboard", dashboardRouter);
router.use("/scaling", scalingRouter);

export default router;
