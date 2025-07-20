import { Server } from "socket.io";

const connectedUsers = new Map();

export function setupSocketEvents(io) {
  io.on("connection", (socket) => {
    const userId = socket.handshake.auth?.userId;

    console.log("🔌 New socket connection attempt", { userId, socketId: socket.id });

    if (!userId) return socket.disconnect();

    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, []);
    }
    connectedUsers.get(userId).push(socket);
    console.log(`User ${userId} connected. Total connections: ${connectedUsers.get(userId).length}`);

    socket.on("disconnect", () => {
      const userSockets = connectedUsers.get(userId) || [];
      connectedUsers.set(userId, userSockets.filter(s => s.id !== socket.id));
      if (connectedUsers.get(userId).length === 0) {
        connectedUsers.delete(userId);
      }
      console.log(`User ${userId} disconnected. Remaining: ${connectedUsers.get(userId).length}`);
    });
  });
}

export function emitToUser(userId, event, data) {
  const sockets = connectedUsers.get(userId);
  if (!sockets) return;
  sockets.forEach(socket => socket.emit(event, data));
}