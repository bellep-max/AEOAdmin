import { Router } from "express";
import { db } from "@workspace/db";
import { farmMetrics } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* ─── Default seed rows ─────────────────────────────────── */
const DEFAULT_METRICS = [
  /* ── Device Farm Performance ── */
  { key: "device_rotation",       label: "Device Rotation",         description: "% of sessions using a different device from the previous one",                category: "performance",  unit: "%",       targetValue: "80", isComputed: false },
  { key: "ip_rotation",           label: "IP Address Rotation",     description: "% of sessions using a unique IP/proxy address",                               category: "performance",  unit: "%",       targetValue: "90", isComputed: false },
  { key: "cache_clearing",        label: "Cache Clearing Rate",     description: "% of sessions where device cache is fully cleared before execution",           category: "performance",  unit: "%",       targetValue: "100", isComputed: false },
  { key: "prompt_exec_accuracy",  label: "Prompt Execution Accuracy", description: "% of sessions that complete successfully without error or timeout",         category: "performance",  unit: "%",       targetValue: "95", isComputed: false },
  { key: "volume_search_accuracy",label: "Volume Searches Accuracy", description: "Actual searches delivered vs. target search volume per billing cycle",       category: "performance",  unit: "%",       targetValue: "98", isComputed: false },

  /* ── Device Health ── */
  { key: "device_uptime",         label: "Device Uptime",           description: "% of the device fleet that is online and available for sessions",             category: "device_health", unit: "%",      targetValue: "95", isComputed: false },
  { key: "avg_battery_level",     label: "Avg Battery Level",       description: "Average battery % across all active devices in the farm",                    category: "device_health", unit: "%",      targetValue: "60", isComputed: false },
  { key: "device_error_rate",     label: "Device Error Rate",       description: "% of sessions aborted due to device-level failures (crash, freeze, reboot)", category: "device_health", unit: "%",      targetValue: "2",  isComputed: false },
  { key: "reboot_frequency",      label: "Reboot Frequency",        description: "Average number of reboots per device per day",                                category: "device_health", unit: "/day",   targetValue: "1",  isComputed: false },

  /* ── Proxy / Network ── */
  { key: "proxy_success_rate",    label: "Proxy Success Rate",      description: "% of proxy connections that establish successfully without rotation failure",  category: "proxy_network", unit: "%",      targetValue: "97", isComputed: false },
  { key: "avg_session_latency",   label: "Avg Session Latency",     description: "Average time from session start to first AI platform response (seconds)",    category: "proxy_network", unit: "s",      targetValue: "4",  isComputed: false },
  { key: "proxy_rotation_interval", label: "Proxy Rotation Interval", description: "Minimum sessions before the same proxy IP is reused",                    category: "proxy_network", unit: "sessions", targetValue: "5", isComputed: false },

  /* ── AEO Campaign ── */
  { key: "daily_target_achievement", label: "Daily Target Achievement", description: "% of daily search target delivered across all active client accounts",   category: "campaign",     unit: "%",      targetValue: "100", isComputed: false },
  { key: "keyword_coverage",     label: "Keyword Coverage",        description: "% of active keywords that have been searched at least once in the last 24h",   category: "campaign",     unit: "%",      targetValue: "100", isComputed: false },
  { key: "platform_gemini",      label: "Platform — Gemini",       description: "% of AEO sessions targeted at Google Gemini",                                 category: "campaign",     unit: "%",      targetValue: "40",  isComputed: false },
  { key: "platform_chatgpt",     label: "Platform — ChatGPT",      description: "% of AEO sessions targeted at ChatGPT (OpenAI)",                             category: "campaign",     unit: "%",      targetValue: "40",  isComputed: false },
  { key: "platform_perplexity",  label: "Platform — Perplexity",   description: "% of AEO sessions targeted at Perplexity AI",                                category: "campaign",     unit: "%",      targetValue: "20",  isComputed: false },

  /* ── Capacity ── */
  { key: "active_devices_target",  label: "Active Devices Target",  description: "Target number of devices actively running AEO sessions",                    category: "capacity",     unit: "devices", targetValue: "30", isComputed: false },
  { key: "sessions_per_day",       label: "Sessions Per Day",       description: "Total AEO sessions executed across all devices per day",                    category: "capacity",     unit: "sessions", targetValue: "300", isComputed: false },
  { key: "searches_per_device_day",label: "Searches / Device / Day", description: "Target number of AEO prompt searches each device executes per day",       category: "capacity",     unit: "searches", targetValue: "10", isComputed: false },
  { key: "client_capacity",        label: "Client Capacity",        description: "Maximum number of business clients the farm can serve concurrently",        category: "capacity",     unit: "clients",  targetValue: "80", isComputed: false },
];

async function ensureSeed() {
  const existing = await db.select().from(farmMetrics);
  if (existing.length > 0) return;
  for (const row of DEFAULT_METRICS) {
    await db.insert(farmMetrics).values({ ...row, value: row.targetValue }).onConflictDoNothing();
  }
}

/* ── GET all metrics ─────────────────────────────────────── */
router.get("/", async (req, res) => {
  try {
    await ensureSeed();
    const rows = await db.select().from(farmMetrics).orderBy(farmMetrics.category, farmMetrics.id);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching farm metrics");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH a single metric ───────────────────────────────── */
router.patch("/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const { value, targetValue } = req.body as { value?: string; targetValue?: string };
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (value       !== undefined) update.value       = String(value);
    if (targetValue !== undefined) update.targetValue = String(targetValue);
    const [row] = await db.update(farmMetrics).set(update).where(eq(farmMetrics.key, key)).returning();
    if (!row) return res.status(404).json({ error: "Metric not found" });
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Error updating farm metric");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
