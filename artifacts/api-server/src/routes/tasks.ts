/**
 * @file tasks.ts
 * @route /api/tasks
 *
 * Manages the operational task board used by the Signal AEO team.
 * Tasks have a status (todo | in_progress | done) and priority
 * (low | medium | high | urgent), and can have any number of checklist
 * subtasks attached.
 *
 * Subtasks are always fetched alongside their parent so the UI never needs
 * a separate round-trip to load checklist items.
 *
 * Schema: tasksTable (id, title, category, status, priority, notes, createdAt)
 *         subtasksTable (id, taskId, title, done)
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, insertTaskSchema, subtasksTable, insertSubtaskSchema } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { ok, created, noContent, badRequest, notFound, serverError } from "../lib/response";
import { validateBody } from "../lib/validate";
import "../middleware/auth";

const router = Router();

/**
 * GET /api/tasks
 * Returns all tasks with their subtask arrays embedded.
 * Supports optional query-string filters:
 *   ?status=todo|in_progress|done
 *   ?priority=low|medium|high|urgent
 * Multiple filters are ANDed together.
 * Results are ordered newest-first (descending createdAt).
 */
router.get("/", async (req, res) => {
  try {
    const { status, priority } = req.query as Record<string, string>;

    // Build dynamic WHERE conditions from provided query params
    const conditions: ReturnType<typeof eq>[] = [];
    if (status)   conditions.push(eq(tasksTable.status,   status as typeof tasksTable.status.enumValues[number]));
    if (priority) conditions.push(eq(tasksTable.priority, priority as typeof tasksTable.priority.enumValues[number]));

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tasksTable.createdAt));

    // Fetch all subtasks in one query, then group by taskId client-side
    // This avoids N+1 queries for large task lists
    const subtasks = await db.select().from(subtasksTable);
    const subtaskMap: Record<number, typeof subtasks> = {};
    for (const s of subtasks) {
      if (!subtaskMap[s.taskId]) subtaskMap[s.taskId] = [];
      subtaskMap[s.taskId].push(s);
    }

    ok(res, tasks.map((t) => ({ ...t, subtasks: subtaskMap[t.id] ?? [] })));
  } catch (err) {
    req.log.error({ err }, "Error fetching tasks");
    serverError(res);
  }
});

/**
 * POST /api/tasks
 * Creates a new task. Returns the new task with an empty subtasks array
 * so the frontend can add it to state without refetching.
 *
 * Body: { title, category?, status?, priority?, notes? }
 */
router.post("/", async (req, res) => {
  try {
    const data = validateBody(req, res, insertTaskSchema);
    if (!data) return;

    const [task] = await db
      .insert(tasksTable)
      .values(data)
      .returning();

    created(res, { ...task, subtasks: [] });
  } catch (err) {
    req.log.error({ err }, "Error creating task");
    serverError(res);
  }
});

/**
 * PATCH /api/tasks/:id
 * Partial update for a task. Any field in req.body is applied as-is to
 * the DB row (Drizzle merges only provided fields).
 * Returns the updated task with its current subtask list so the UI can
 * replace the stale task in state without a full refetch.
 */
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const body = req.body as Record<string, unknown>;
    const TASK_FIELDS = ["title", "category", "status", "priority", "notes"] as const;
    const updates: Record<string, unknown> = {};
    for (const f of TASK_FIELDS) {
      if (f in body) updates[f] = body[f];
    }
    if (Object.keys(updates).length === 0) return badRequest(res, "No valid fields to update");

    const [task] = await db
      .update(tasksTable)
      .set(updates)
      .where(eq(tasksTable.id, id))
      .returning();

    if (!task) return notFound(res);

    const subtasks = await db
      .select()
      .from(subtasksTable)
      .where(eq(subtasksTable.taskId, id));

    ok(res, { ...task, subtasks });
  } catch (err) {
    req.log.error({ err }, "Error updating task");
    serverError(res);
  }
});

/**
 * DELETE /api/tasks/:id
 * Hard-deletes a task. Subtasks that reference this taskId will also be
 * removed if the schema has a CASCADE foreign key; otherwise they become
 * orphaned (frontend filters them out via the missing parent).
 */
router.delete("/:id", async (req, res) => {
  try {
    await db.delete(tasksTable).where(eq(tasksTable.id, parseInt(req.params.id)));
    noContent(res);
  } catch (err) {
    req.log.error({ err }, "Error deleting task");
    serverError(res);
  }
});

/**
 * POST /api/tasks/:id/subtasks
 * Appends a new checklist item to an existing task.
 * Body: { title, done? }
 */
router.post("/:id/subtasks", async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const data = validateBody(req, res, insertSubtaskSchema);
    if (!data) return;

    const [subtask] = await db
      .insert(subtasksTable)
      .values({ ...data, taskId })
      .returning();

    created(res, subtask);
  } catch (err) {
    req.log.error({ err }, "Error creating subtask");
    serverError(res);
  }
});

router.patch("/:taskId/subtasks/:subtaskId", async (req, res) => {
  try {
    const subtaskId = parseInt(req.params.subtaskId);
    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if ("title" in body) updates.title = body.title;
    if ("done" in body) updates.done = body.done;
    if (Object.keys(updates).length === 0) return badRequest(res, "No valid fields");

    const [subtask] = await db
      .update(subtasksTable)
      .set(updates)
      .where(eq(subtasksTable.id, subtaskId))
      .returning();

    if (!subtask) return notFound(res);
    ok(res, subtask);
  } catch (err) {
    req.log.error({ err }, "Error updating subtask");
    serverError(res);
  }
});

export default router;
