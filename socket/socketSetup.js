import { Server } from "socket.io";
import { setupSocketEvents } from "./socketController.js";
import { verifyAccessToken } from "../utils/jwt.js";

export function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token"));
    try {
      const decoded = verifyAccessToken(token);
      socket.handshake.auth.userId = decoded.user.id;
      next();
    } catch {
      return next(new Error("Invalid token"));
    }
  });

  setupSocketEvents(io);
}