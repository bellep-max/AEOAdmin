import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  integer,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { keywordsTable } from "./keywords";
export const executionWorkersTable = pgTable("execution_workers", {
  id: text("id").primaryKey(),
  devices: jsonb("devices").notNull().default([]),
  modes: jsonb("modes").notNull().default([]),
  lastSeen: timestamp("last_seen", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const rankingExecutionsTable = pgTable(
  "ranking_executions",
  {
    id: uuid("id").primaryKey(),
    keywordId: integer("keyword_id")
      .notNull()
      .references(() => keywordsTable.id),
    mode: text("mode").notNull(),
    platform: text("platform").notNull(),
    workerId: text("worker_id")
      .notNull()
      .references(() => executionWorkersTable.id),
    deviceSerial: text("device_serial").notNull(),
    hardwareId: text("hardware_id").notNull(),
    request: jsonb("request").notNull(),
    status: text("status").notNull().default("queued"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    result: jsonb("result"),
    resultSha256: text("result_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("ranking_executions_mode_check", sql`${t.mode} IN ('type','voice')`),
    check(
      "ranking_executions_platform_check",
      sql`${t.platform} IN ('chatgpt','gemini','copilot','bing')`,
    ),
    check(
      "ranking_executions_status_check",
      sql`${t.status} IN ('queued','running','success','error','cancelled')`,
    ),
    uniqueIndex("ranking_execution_phone_lease")
      .on(t.hardwareId)
      .where(sql`${t.status}='running'`),
    index("ranking_execution_queue").on(t.workerId, t.status, t.createdAt),
  ],
);
export const executionArtifactsTable = pgTable(
  "execution_artifacts",
  {
    executionId: uuid("execution_id")
      .notNull()
      .references(() => rankingExecutionsTable.id),
    artifactId: integer("artifact_id").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    uploaded: boolean("uploaded").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.executionId, t.artifactId] }),
    check(
      "execution_artifacts_content_type_check",
      sql`${t.contentType} IN ('audio/wav','image/png')`,
    ),
    check(
      "execution_artifacts_size_check",
      sql`${t.size} BETWEEN 1 AND 20971520`,
    ),
  ],
);
