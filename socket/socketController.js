import { Server } from "socket.io";
import jwt from 'jsonwebtoken';

const connectedUsers = new Map();
const socketHealthStatus = new Map(); // Track socket health with timestamps

// Configuration constants
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds (2x interval)
const MAX_MISSED_PINGS = 2;

export function setupSocketEvents(io) {
  // Start heartbeat monitoring
  startHeartbeatMonitoring(io);
  
  io.on("connection", (socket) => {
    console.log("🔌 Incoming socket connection", {
      socketId: socket.id,
      auth: socket.handshake.auth
    });

    // Extract userId from token
    let userId = null;
    try {
      const token = socket.handshake.auth?.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.user?.id || decoded.userId;
        socket.userId = userId;
      }
    } catch (error) {
      console.warn("❌ Invalid token in socket handshake:", error.message);
      return socket.disconnect();
    }

    if (!userId) {
      console.warn("❌ Rejected socket connection: missing userId");
      return socket.disconnect();
    }

    console.log("✅ Accepted socket connection", { userId, socketId: socket.id });

    // Initialize user's socket array if it doesn't exist
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, []);
    }
    
    // Add the socket to the user's connections
    connectedUsers.get(userId).push(socket);
    console.log(`User ${userId} connected. Total connections: ${connectedUsers.get(userId).length}`);
    
    // Initialize socket health tracking
    socketHealthStatus.set(socket.id, {
      userId,
      lastPing: Date.now(),
      isAlive: true,
      missedPings: 0
    });

    // Relay item update events between client devices
    socket.on('itemUpdated', (itemData) => {
      console.log(`Relaying itemUpdated for user ${userId}:`, itemData);
      emitToUser(userId, 'itemUpdated', itemData);
    });

    socket.on('itemCreated', (itemData) => {
      console.log(`Relaying itemCreated for user ${userId}:`, itemData);
      emitToUser(userId, 'itemCreated', itemData);
    });

    socket.on('itemDeleted', (itemData) => {
      console.log(`Relaying itemDeleted for user ${userId}:`, itemData);
      emitToUser(userId, 'itemDeleted', itemData);
    });

    socket.on('itemMoved', (itemData) => {
      console.log(`Relaying itemMoved for user ${userId}:`, itemData);
      emitToUser(userId, 'itemMoved', itemData);
    });

    socket.on('treeReplaced', (treeData) => {
      console.log(`Relaying treeReplaced for user ${userId}:`, treeData);
      emitToUser(userId, 'treeReplaced', treeData);
    });

    // Reminder relay events - just forward to all user's devices
    socket.on('reminder:set', (reminderData) => {
      console.log(`Relaying reminder:set for user ${userId}:`, reminderData);
      emitToUser(userId, 'reminder:set', reminderData);
    });

    socket.on('reminder:clear', (data) => {
      console.log(`Relaying reminder:clear for user ${userId}:`, data);
      emitToUser(userId, 'reminder:clear', data);
    });

    socket.on('reminder:update', (reminderData) => {
      console.log(`Relaying reminder:update for user ${userId}:`, reminderData);
      emitToUser(userId, 'reminder:update', reminderData);
    });

    // Heartbeat mechanism handlers
    socket.on('ping', () => {
      const healthData = socketHealthStatus.get(socket.id);
      if (healthData) {
        healthData.lastPing = Date.now();
        healthData.isAlive = true;
        healthData.missedPings = 0;
        console.log(`💓 Ping received from user ${userId}, socket ${socket.id}`);
      }
      socket.emit('pong'); // Respond to client ping
    });

    socket.on('pong', () => {
      const healthData = socketHealthStatus.get(socket.id);
      if (healthData) {
        healthData.lastPing = Date.now();
        healthData.isAlive = true;
        healthData.missedPings = 0;
        console.log(`💓 Pong received from user ${userId}, socket ${socket.id}`);
      }
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      console.log(`Socket ${socket.id} disconnecting, reason: ${reason}`);
      
      // Clean up health tracking
      socketHealthStatus.delete(socket.id);
      
      // Safety check for userId
      if (!userId) {
        console.warn("⚠️ Disconnect handler called but userId is undefined");
        return;
      }
      
      const userSockets = connectedUsers.get(userId) || [];
      const updatedSockets = userSockets.filter(s => s && s.id && s.id !== socket.id);
      
      if (updatedSockets.length === 0) {
        connectedUsers.delete(userId);
        console.log(`User ${userId} fully disconnected`);
      } else {
        connectedUsers.set(userId, updatedSockets);
        console.log(`User ${userId} disconnected. Remaining connections: ${updatedSockets.length}`);
      }
    });

    // Handle socket errors
    socket.on("error", (error) => {
      console.error(`Socket error for user ${userId}:`, error);
    });
  });
}

export function emitToUser(userId, event, data) {
  console.log(`🔍 emitToUser called: userId=${userId}, event=${event}, totalUsers=${connectedUsers.size}`);
  const sockets = connectedUsers.get(userId);
  
  if (!sockets || !Array.isArray(sockets) || sockets.length === 0) {
    console.log(`❌ No active sockets for user ${userId}, skipping emit for event: ${event}`);
    console.log(`🔍 ConnectedUsers map keys:`, Array.from(connectedUsers.keys()));
    return;
  }
  
  console.log(`📡 Found ${sockets.length} socket(s) for user ${userId}`);
  sockets.forEach((socket, index) => {
    console.log(`📡 Socket ${index}: id=${socket.id}, connected=${socket.connected}`);
  });

  // Filter out disconnected sockets and emit to valid ones
  const validSockets = [];
  
  sockets.forEach(socket => {
    try {
      // Check if socket is still connected
      if (socket.connected) {
        socket.emit(event, data);
        validSockets.push(socket);
      } else {
        console.log(`Removing disconnected socket ${socket.id} for user ${userId}`);
      }
    } catch (error) {
      console.error(`Failed to emit ${event} to socket ${socket.id} for user ${userId}:`, error);
      // Don't add this socket to validSockets as it's problematic
    }
  });

  // Update the connectedUsers map with only valid sockets
  if (validSockets.length === 0) {
    connectedUsers.delete(userId);
    console.log(`All sockets invalid for user ${userId}, removed from connectedUsers`);
  } else if (validSockets.length !== sockets.length) {
    connectedUsers.set(userId, validSockets);
    console.log(`Updated socket list for user ${userId}: ${validSockets.length} valid sockets`);
  }
}

// Heartbeat monitoring system
function startHeartbeatMonitoring(io) {
  console.log(`💓 Starting heartbeat monitoring (interval: ${HEARTBEAT_INTERVAL}ms, timeout: ${HEARTBEAT_TIMEOUT}ms)`);
  
  setInterval(() => {
    const now = Date.now();
    const socketsToRemove = [];
    
    // Check all tracked sockets for health
    socketHealthStatus.forEach((healthData, socketId) => {
      const timeSinceLastPing = now - healthData.lastPing;
      const socket = io.sockets.sockets.get(socketId);
      
      if (!socket || !socket.connected) {
        // Socket is disconnected, mark for removal
        socketsToRemove.push(socketId);
        console.log(`💀 Socket ${socketId} is disconnected, cleaning up`);
        return;
      }
      
      if (timeSinceLastPing > HEARTBEAT_TIMEOUT) {
        healthData.missedPings++;
        console.warn(`⚠️ Socket ${socketId} missed ping (${healthData.missedPings}/${MAX_MISSED_PINGS}). Last ping: ${timeSinceLastPing}ms ago`);
        
        if (healthData.missedPings >= MAX_MISSED_PINGS) {
          // Force disconnect dead socket
          console.error(`💀 Socket ${socketId} exceeded max missed pings, forcing disconnect`);
          socket.disconnect(true);
          socketsToRemove.push(socketId);
          
          // Also clean up from connectedUsers
          cleanupDeadSocket(socketId, healthData.userId);
        } else {
          // Send a ping to check if socket is still alive
          healthData.isAlive = false;
          socket.emit('ping');
        }
      } else if (timeSinceLastPing > HEARTBEAT_INTERVAL) {
        // Time to send a heartbeat ping
        socket.emit('ping');
        console.log(`💓 Sent ping to socket ${socketId} (user: ${healthData.userId})`);
      }
    });
    
    // Clean up removed sockets
    socketsToRemove.forEach(socketId => {
      socketHealthStatus.delete(socketId);
    });
    
  }, HEARTBEAT_INTERVAL);
}

// Helper function to clean up dead sockets from connectedUsers
function cleanupDeadSocket(socketId, userId) {
  const userSockets = connectedUsers.get(userId);
  if (userSockets) {
    const updatedSockets = userSockets.filter(s => s.id !== socketId);
    if (updatedSockets.length === 0) {
      connectedUsers.delete(userId);
      console.log(`🧹 User ${userId} fully cleaned up after dead socket removal`);
    } else {
      connectedUsers.set(userId, updatedSockets);
      console.log(`🧹 Updated socket list for user ${userId} after cleanup: ${updatedSockets.length} remaining`);
    }
  }
}

// Get connection health statistics (for debugging/monitoring)
export function getConnectionHealthStats() {
  const stats = {
    totalTrackedSockets: socketHealthStatus.size,
    totalConnectedUsers: connectedUsers.size,
    socketsPerUser: {},
    healthStatus: {}
  };
  
  // Count sockets per user
  connectedUsers.forEach((sockets, userId) => {
    stats.socketsPerUser[userId] = sockets.length;
  });
  
  // Health status summary
  socketHealthStatus.forEach((healthData, socketId) => {
    const now = Date.now();
    const timeSinceLastPing = now - healthData.lastPing;
    stats.healthStatus[socketId] = {
      userId: healthData.userId,
      lastPingAgo: timeSinceLastPing,
      isHealthy: timeSinceLastPing < HEARTBEAT_TIMEOUT,
      missedPings: healthData.missedPings
    };
  });
  
  return stats;
}