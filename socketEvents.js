
let io;

export function initSocketIO(socketServer) {
  io = socketServer;
}

export function emitTaskUpdated(itemId, data) {
  if (io) io.emit("taskUpdated", { itemId, data });
}

export function emitReminderUpdated(itemId, reminder) {
  if (io) io.emit("reminderUpdated", { itemId, reminder });
}

export function emitItemContentUpdated(itemId, content) {
  if (io) io.emit("itemContentUpdated", { itemId, content });
}
