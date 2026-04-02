import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, subtasksTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { status, priority } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (status) conditions.push(eq(tasksTable.status, status));
    if (priority) conditions.push(eq(tasksTable.priority, priority));

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tasksTable.createdAt));

    const subtasks = await db.select().from(subtasksTable);
    const subtaskMap: Record<number, typeof subtasks> = {};
    for (const s of subtasks) {
      if (!subtaskMap[s.taskId]) subtaskMap[s.taskId] = [];
      subtaskMap[s.taskId].push(s);
    }

    res.json(tasks.map((t) => ({ ...t, subtasks: subtaskMap[t.id] ?? [] })));
  } catch (err) {
    req.log.error({ err }, "Error fetching tasks");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: req.body.title,
        category: req.body.category ?? null,
        status: req.body.status ?? "todo",
        priority: req.body.priority ?? "medium",
        notes: req.body.notes ?? null,
      })
      .returning();
    res.status(201).json({ ...task, subtasks: [] });
  } catch (err) {
    req.log.error({ err }, "Error creating task");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [task] = await db
      .update(tasksTable)
      .set(req.body)
      .where(eq(tasksTable.id, id))
      .returning();
    if (!task) return res.status(404).json({ error: "Not found" });
    const subtasks = await db.select().from(subtasksTable).where(eq(subtasksTable.taskId, id));
    res.json({ ...task, subtasks });
  } catch (err) {
    req.log.error({ err }, "Error updating task");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await db.delete(tasksTable).where(eq(tasksTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting task");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/subtasks", async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const [subtask] = await db
      .insert(subtasksTable)
      .values({ taskId, title: req.body.title, done: req.body.done ?? false })
      .returning();
    res.status(201).json(subtask);
  } catch (err) {
    req.log.error({ err }, "Error creating subtask");
    res.status(500).json({ error: "Internal server error" });
  }
});

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
