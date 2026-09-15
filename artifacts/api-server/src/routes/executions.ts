import { Router, raw } from "express";
import { randomUUID, createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { requireOwner } from "../middlewares/role-auth";
import { requireExecutorToken } from "../middlewares/executor-auth";
import {
  getExecutionArtifact,
  putExecutionArtifact,
} from "../services/execution-storage";

const router = Router();
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const uuid = (id: unknown) =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const hardware = (serial: string) =>
  /^adb-([^-]+)-/.exec(serial)?.[1] ?? serial;
const safeSerial = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Za-z0-9_.:() -]{1,200}$/.test(s);
const safeWorker = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(s);
const wrap = (fn: any) => async (req: any, res: any) => {
  try {
    await fn(req, res);
  } catch (e) {
    req.log.error({ err: e }, "execution request failed");
    res.status(500).json({ error: "Execution request failed" });
  }
};

router.post(
  "/worker/heartbeat",
  requireExecutorToken,
  wrap(async (req: any, res: any) => {
    const { workerId, devices, modes } = req.body ?? {};
    if (
      !safeWorker(workerId) ||
      !Array.isArray(devices) ||
      devices.length > 50 ||
      !devices.every(safeSerial) ||
      !Array.isArray(modes) ||
      !modes.length ||
      !modes.every((m: string) => ["type", "voice"].includes(m))
    )
      return res.status(400).json({ error: "Invalid worker capabilities" });
    await pool.query(
      `INSERT INTO execution_workers(id,devices,modes) VALUES($1,$2,$3)
    ON CONFLICT(id) DO UPDATE SET devices=$2,modes=$3,last_seen=now()`,
      [workerId, JSON.stringify(devices), JSON.stringify(modes)],
    );
    res.json({ ok: true });
  }),
);

router.post(
  "/worker/claim",
  requireExecutorToken,
  wrap(async (req: any, res: any) => {
    const { workerId } = req.body ?? {};
    if (!safeWorker(workerId))
      return res.status(400).json({ error: "Invalid worker" });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      // Serializes claims from the same worker and retains in-flight work on restart.
      const worker = (
        await db.query(
          "SELECT * FROM execution_workers WHERE id=$1 AND last_seen>now()-interval '90 seconds' FOR UPDATE",
          [workerId],
        )
      ).rows[0];
      if (!worker) {
        await db.query("ROLLBACK");
        return res.status(409).json({ error: "Heartbeat required" });
      }
      const running = (
        await db.query(
          "SELECT * FROM ranking_executions WHERE worker_id=$1 AND status='running' ORDER BY created_at LIMIT 1",
          [workerId],
        )
      ).rows[0];
      if (running) {
        await db.query("COMMIT");
        return res.json(running);
      }
      const job = (
        await db.query(
          `SELECT e.* FROM ranking_executions e WHERE e.worker_id=$1 AND e.status='queued'
      AND $2::jsonb ? e.mode AND $3::jsonb ? e.device_serial
      AND NOT EXISTS(SELECT 1 FROM ranking_executions busy WHERE busy.hardware_id=e.hardware_id AND busy.status='running')
      ORDER BY e.created_at FOR UPDATE OF e SKIP LOCKED LIMIT 1`,
          [
            workerId,
            JSON.stringify(worker.modes),
            JSON.stringify(worker.devices),
          ],
        )
      ).rows[0];
      if (!job) {
        await db.query("COMMIT");
        return res.status(204).end();
      }
      // A hardware advisory lock serializes claims by different workers using mDNS aliases.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        job.hardware_id,
      ]);
      if (
        (
          await db.query(
            "SELECT 1 FROM ranking_executions WHERE hardware_id=$1 AND status='running'",
            [job.hardware_id],
          )
        ).rowCount
      ) {
        await db.query("COMMIT");
        return res.status(204).end();
      }
      const row = (
        await db.query(
          "UPDATE ranking_executions SET status='running',started_at=now() WHERE id=$1 RETURNING *",
          [job.id],
        )
      ).rows[0];
      await db.query("COMMIT");
      res.json(row);
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }),
);

router.post(
  "/:id/finish",
  requireExecutorToken,
  wrap(async (req: any, res: any) => {
    if (!uuid(req.params.id))
      return res.status(400).json({ error: "Invalid execution" });
    const { workerId, bundle } = req.body ?? {};
    if (
      !safeWorker(workerId) ||
      !bundle ||
      bundle.version !== 1 ||
      bundle.request_id !== req.params.id ||
      !["success", "error", "rejected"].includes(bundle.status) ||
      !Array.isArray(bundle.artifacts) ||
      bundle.artifacts.length > 30
    )
      return res.status(400).json({ error: "Invalid result bundle" });
    const metadata = bundle.artifacts;
    if (
      !metadata.every(
        (a: any) =>
          a &&
          ["audio/wav", "image/png"].includes(a.content_type) &&
          /^[a-f0-9]{64}$/.test(a.sha256) &&
          Number.isInteger(a.size) &&
          a.size > 0 &&
          a.size <= 20971520 &&
          typeof a.path === "string" &&
          a.path.length < 300,
      )
    )
      return res.status(400).json({ error: "Invalid artifact manifest" });
    const bytes = JSON.stringify(bundle),
      digest = hash(bytes);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const row = (
        await db.query(
          "SELECT * FROM ranking_executions WHERE id=$1 FOR UPDATE",
          [req.params.id],
        )
      ).rows[0];
      if (!row || row.worker_id !== workerId) {
        await db.query("ROLLBACK");
        return res.status(404).json({ error: "No assigned execution" });
      }
      if (row.mode !== bundle.mode || row.platform !== bundle.platform) {
        await db.query("ROLLBACK");
        return res.status(409).json({ error: "Result mode/platform mismatch" });
      }
      if (row.result_sha256) {
        await db.query("COMMIT");
        return res
          .status(row.result_sha256 === digest ? 200 : 409)
          .json({
            id: row.id,
            error:
              row.result_sha256 === digest ? undefined : "Conflicting result",
          });
      }
      if (row.status !== "running") {
        await db.query("ROLLBACK");
        return res.status(409).json({ error: "Execution is not running" });
      }
      // Voice success requires exact recognition; engine success alone is insufficient.
      const success =
        bundle.status === "success" &&
        (row.mode !== "voice" || bundle.exact === true) &&
        (row.platform === "bing" || bundle.result?.answer_state === "complete");
      await db.query(
        "UPDATE ranking_executions SET status=$2,result=$3,result_sha256=$4,finished_at=now() WHERE id=$1",
        [row.id, success ? "success" : "error", bytes, digest],
      );
      for (const [i, a] of metadata.entries())
        await db.query(
          `INSERT INTO execution_artifacts(execution_id,artifact_id,name,content_type,sha256,size,storage_key)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            row.id,
            i + 1,
            a.path.split("/").pop(),
            a.content_type,
            a.sha256,
            a.size,
            `executions/${row.id}/${i + 1}`,
          ],
        );
      await db.query("COMMIT");
      res.json({ id: row.id });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }),
);

router.put(
  "/:id/artifacts/:artifactId",
  requireExecutorToken,
  raw({ type: ["audio/wav", "image/png"], limit: "20mb" }),
  wrap(async (req: any, res: any) => {
    if (!uuid(req.params.id) || !/^[1-9][0-9]*$/.test(req.params.artifactId))
      return res.status(400).json({ error: "Invalid artifact" });
    const row = (
      await pool.query(
        `SELECT a.* FROM execution_artifacts a JOIN ranking_executions e ON e.id=a.execution_id
    WHERE e.id=$1 AND a.artifact_id=$2 AND e.worker_id=$3`,
        [
          req.params.id,
          Number(req.params.artifactId),
          req.header("x-worker-id"),
        ],
      )
    ).rows[0];
    if (!row) return res.status(404).json({ error: "No assigned artifact" });
    if (
      !Buffer.isBuffer(req.body) ||
      req.body.length !== row.size ||
      hash(req.body) !== row.sha256
    )
      return res.status(409).json({ error: "Artifact checksum/size mismatch" });
    await putExecutionArtifact(row.storage_key, req.body, row.content_type);
    await pool.query(
      "UPDATE execution_artifacts SET uploaded=true WHERE execution_id=$1 AND artifact_id=$2",
      [req.params.id, row.artifact_id],
    );
    res.json({ ok: true });
  }),
);

router.use(requireOwner);
router.get(
  "/workers",
  wrap(async (_req: any, res: any) =>
    res.json(
      (
        await pool.query(
          "SELECT *,last_seen>now()-interval '90 seconds' AS online FROM execution_workers ORDER BY id",
        )
      ).rows,
    ),
  ),
);
router.get(
  "/",
  wrap(async (req: any, res: any) => {
    const mode = ["type", "voice"].includes(req.query.mode)
      ? req.query.mode
      : null;
    res.json(
      (
        await pool.query(
          `SELECT e.id,e.keyword_id,e.mode,e.platform,e.worker_id,e.device_serial,e.status,e.cancel_requested,e.created_at,e.started_at,e.finished_at,
    e.request->>'phrase' AS phrase, e.result->'ranking' AS ranking FROM ranking_executions e WHERE ($1::text IS NULL OR e.mode=$1) ORDER BY created_at DESC LIMIT 200`,
          [mode],
        )
      ).rows,
    );
  }),
);
router.post(
  "/",
  wrap(async (req: any, res: any) => {
    const b = req.body ?? {};
    if (
      !Number.isSafeInteger(b.keywordId) ||
      !["type", "voice"].includes(b.mode) ||
      !["chatgpt", "gemini", "copilot", "bing"].includes(b.platform) ||
      !safeWorker(b.workerId) ||
      !safeSerial(b.deviceSerial)
    )
      return res
        .status(400)
        .json({ error: "Keyword, mode, platform and worker/device required" });
    const worker = (
      await pool.query(
        "SELECT * FROM execution_workers WHERE id=$1 AND last_seen>now()-interval '90 seconds'",
        [b.workerId],
      )
    ).rows[0];
    if (
      !worker ||
      !worker.modes.includes(b.mode) ||
      !worker.devices.includes(b.deviceSerial)
    )
      return res
        .status(409)
        .json({ error: "No online worker with this mode/device" });
    const keyword = (
      await pool.query(
        `SELECT k.*,COALESCE(b.name,c.business_name) AS expected_business FROM keywords k JOIN clients c ON c.id=k.client_id LEFT JOIN businesses b ON b.id=k.business_id WHERE k.id=$1 AND k.is_active=true AND k.archived_at IS NULL`,
        [b.keywordId],
      )
    ).rows[0];
    if (!keyword) return res.status(404).json({ error: "No active keyword" });
    const phrase = b.phrase ?? keyword.keyword_text;
    if (typeof phrase !== "string" || !phrase.trim() || phrase.length > 2000)
      return res.status(400).json({ error: "Invalid phrase" });
    const voice = b.voice ?? { engine: "say", realistic: false },
      proxy = b.proxy ?? { enabled: false, target: "country-PH", rounds: 1 };
    if (
      !["say", "kokoro"].includes(voice.engine) ||
      typeof voice.realistic !== "boolean" ||
      typeof proxy.enabled !== "boolean" ||
      !/^[A-Za-z0-9_.=-]{1,100}$/.test(proxy.target) ||
      !Number.isInteger(proxy.rounds) ||
      proxy.rounds < 1 ||
      proxy.rounds > 3
    )
      return res.status(400).json({ error: "Invalid voice/proxy settings" });
    const id = randomUUID();
    const request = {
      version: 1,
      request_id: id,
      mode: b.mode,
      platform: b.platform,
      phrase,
      device_serial: b.deviceSerial,
      gost_port: 12001,
      proxy,
      voice,
      expected_business: keyword.expected_business ?? "",
    };
    const row = (
      await pool.query(
        `INSERT INTO ranking_executions(id,keyword_id,mode,platform,worker_id,device_serial,hardware_id,request)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          id,
          b.keywordId,
          b.mode,
          b.platform,
          b.workerId,
          b.deviceSerial,
          hardware(b.deviceSerial),
          JSON.stringify(request),
        ],
      )
    ).rows[0];
    res.status(201).json(row);
  }),
);
router.get(
  "/:id",
  wrap(async (req: any, res: any) => {
    if (!uuid(req.params.id))
      return res.status(404).json({ error: "No execution" });
    const row = (
      await pool.query("SELECT * FROM ranking_executions WHERE id=$1", [
        req.params.id,
      ])
    ).rows[0];
    if (!row) return res.status(404).json({ error: "No execution" });
    const artifacts = (
      await pool.query(
        "SELECT artifact_id,name,content_type,sha256,size,uploaded FROM execution_artifacts WHERE execution_id=$1 ORDER BY artifact_id",
        [row.id],
      )
    ).rows;
    res.json({ ...row, artifacts });
  }),
);
router.post(
  "/:id/cancel",
  wrap(async (req: any, res: any) => {
    if (!uuid(req.params.id))
      return res.status(400).json({ error: "Invalid execution" });
    const row = (
      await pool.query(
        `UPDATE ranking_executions SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
    finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE id=$1 AND status IN ('queued','running') RETURNING *`,
        [req.params.id],
      )
    ).rows[0];
    if (!row)
      return res
        .status(409)
        .json({ error: "Execution already finished or missing" });
    res.json(row);
  }),
);
router.get(
  "/:id/artifacts/:artifactId",
  wrap(async (req: any, res: any) => {
    if (!uuid(req.params.id) || !/^[1-9][0-9]*$/.test(req.params.artifactId))
      return res.status(400).json({ error: "Invalid artifact" });
    const a = (
      await pool.query(
        "SELECT * FROM execution_artifacts WHERE execution_id=$1 AND artifact_id=$2 AND uploaded=true",
        [req.params.id, Number(req.params.artifactId)],
      )
    ).rows[0];
    if (!a) return res.status(404).json({ error: "Artifact not uploaded" });
    const bytes = await getExecutionArtifact(a.storage_key);
    res
      .type(a.content_type)
      .set("Cache-Control", "private, no-store")
      .set("Accept-Ranges", "bytes")
      .set(
        "Content-Disposition",
        `${req.query.download === "1" ? "attachment" : "inline"}; filename="artifact-${a.artifact_id}.${a.content_type === "audio/wav" ? "wav" : "png"}"`,
      );
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (req.headers.range) {
      const start = m ? Number(m[1]) : NaN,
        end = m?.[2]
          ? Math.min(Number(m[2]), bytes.length - 1)
          : bytes.length - 1;
      if (!Number.isSafeInteger(start) || start >= bytes.length || end < start)
        return res
          .status(416)
          .set("Content-Range", `bytes */${bytes.length}`)
          .end();
      return res
        .status(206)
        .set("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
        .send(bytes.subarray(start, end + 1));
    }
    res.send(bytes);
  }),
);
export default router;
