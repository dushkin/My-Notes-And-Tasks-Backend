import mongoose from "mongoose";
const ReminderSchema = new mongoose.Schema({
  dateTime: { type: Date, required: true },
  repeat: { type: String, default: null },
  snoozedUntil: { type: Date, default: null },
  enabled: { type: Boolean, default: true },
});
const TaskSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    content: { type: String, default: "" },
    completed: { type: Boolean, default: false },
    type: { type: String, enum: ["task", "note"], default: "task" },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    reminder: { type: ReminderSchema, default: null }
  },
  { timestamps: true }
);
const Task = mongoose.model("Task", TaskSchema);
export default Task;