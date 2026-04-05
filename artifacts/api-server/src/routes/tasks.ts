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
import { tasksTable, subtasksTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

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
    if (status)   conditions.push(eq(tasksTable.status,   status));
    if (priority) conditions.push(eq(tasksTable.priority, priority));

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

    // Embed subtask arrays into each task row before sending
    res.json(tasks.map((t) => ({ ...t, subtasks: subtaskMap[t.id] ?? [] })));
  } catch (err) {
    req.log.error({ err }, "Error fetching tasks");
    res.status(500).json({ error: "Internal server error" });
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
    const [task] = await db
      .insert(tasksTable)
      .values({
        title:    req.body.title,
        category: req.body.category  ?? null,
        status:   req.body.status    ?? "todo",
        priority: req.body.priority  ?? "medium",
        notes:    req.body.notes     ?? null,
      })
      .returning();

    // Return subtasks: [] so callers can treat the response uniformly
    res.status(201).json({ ...task, subtasks: [] });
  } catch (err) {
    req.log.error({ err }, "Error creating task");
    res.status(500).json({ error: "Internal server error" });
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

    const [task] = await db
      .update(tasksTable)
      .set(req.body)
      .where(eq(tasksTable.id, id))
      .returning();

    if (!task) return res.status(404).json({ error: "Not found" });

    // Re-fetch current subtasks to return a complete task object
    const subtasks = await db
      .select()
      .from(subtasksTable)
      .where(eq(subtasksTable.taskId, id));

    res.json({ ...task, subtasks });
  } catch (err) {
    req.log.error({ err }, "Error updating task");
    res.status(500).json({ error: "Internal server error" });
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
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting task");
    res.status(500).json({ error: "Internal server error" });
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

    const [subtask] = await db
      .insert(subtasksTable)
      .values({
        taskId,
        title: req.body.title,
        done:  req.body.done ?? false, // New subtasks default to unchecked
      })
      .returning();

    res.status(201).json(subtask);
  } catch (err) {
    req.log.error({ err }, "Error creating subtask");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/tasks/:taskId/subtasks/:subtaskId
 * Updates a single checklist item — typically toggling `done` or renaming it.
 * Body: { title?, done? }
 */
router.patch("/:taskId/subtasks/:subtaskId", async (req, res) => {
  try {
    const subtaskId = parseInt(req.params.subtaskId);

    const [subtask] = await db
      .update(subtasksTable)
      .set(req.body)
      .where(eq(subtasksTable.id, subtaskId))
      .returning();

    if (!subtask) return res.status(404).json({ error: "Not found" });
    res.json(subtask);
  } catch (err) {
    req.log.error({ err }, "Error updating subtask");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
