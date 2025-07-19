import express from "express";
import Task from "../models/Task.js";

const router = express.Router();

// Set or update reminder for a task
router.patch("/:taskId/reminder", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { dateTime, repeat, snoozedUntil, enabled } = req.body;

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        reminder: { dateTime, repeat, snoozedUntil, enabled },
      },
      { new: true }
    );

    if (!updatedTask) return res.status(404).send("Task not found");
    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear reminder
router.delete("/:taskId/reminder", async (req, res) => {
  try {
    const { taskId } = req.params;

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      { $unset: { reminder: "" } },
      { new: true }
    );

    if (!updatedTask) return res.status(404).send("Task not found");
    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
