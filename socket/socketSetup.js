import { Server } from "socket.io";
import { setupSocketEvents } from "../socket/socketController.js";
import { verifyAccessToken } from "../utils/jwt.js";

export function setupWebSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      console.warn("❌ Rejected socket connection: No token");
      return next(new Error("unauthorized"));
    }

    try {
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.user.id;

      console.log("🛂 Incoming socket connection", {
        userId: socket.userId,
        headers: socket.handshake.headers,
      });

      next();
    } catch (err) {
      console.warn("❌ Invalid token on socket connection");
      return next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    console.log("✅ Socket connected", socket.userId);

    socket.on("disconnect", () => {
      console.log("🔌 Socket disconnected", socket.userId);
    });
  });

  setupSocketEvents(io);
}
