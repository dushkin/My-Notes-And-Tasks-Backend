/**
 * Simple test script to verify heartbeat mechanism
 * Run this script to test the connection health monitoring
 */

import { getConnectionHealthStats } from './socket/socketController.js';
import express from 'express';
import { createServer } from 'http';
import { setupWebSocket } from './socket/socketSetup.js';

// Create minimal Express app for testing
const app = express();
const server = createServer(app);

// Setup WebSocket
setupWebSocket(server);

// Health check endpoint
app.get('/health/connections', (req, res) => {
    const stats = getConnectionHealthStats();
    res.json({
        timestamp: new Date().toISOString(),
        ...stats
    });
});

// Start server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
    console.log(`🔧 Heartbeat test server running on port ${PORT}`);
    console.log(`📊 Connection health stats available at: http://localhost:${PORT}/health/connections`);
    
    // Log connection stats every 30 seconds
    setInterval(() => {
        const stats = getConnectionHealthStats();
        console.log('📊 Connection Health Stats:', {
            totalSockets: stats.totalTrackedSockets,
            totalUsers: stats.totalConnectedUsers,
            timestamp: new Date().toISOString()
        });
        
        if (Object.keys(stats.healthStatus).length > 0) {
            console.log('💓 Health Details:');
            Object.entries(stats.healthStatus).forEach(([socketId, health]) => {
                const status = health.isHealthy ? '✅' : '⚠️';
                console.log(`  ${status} ${socketId}: ${health.lastPingAgo}ms ago (missed: ${health.missedPings})`);
            });
        }
    }, 30000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down heartbeat test server...');
    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Shutting down heartbeat test server...');
    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});