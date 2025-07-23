import logger from '../config/logger.js';

class DeviceSyncService {
    constructor() {
        this.syncInProgress = new Set();
        logger.info('Device sync service initialized (minimal version)');
    }

    /**
     * Start periodic cleanup (placeholder)
     */
    startPeriodicCleanup() {
        logger.info('Device sync service periodic cleanup started');
        
        // Placeholder for periodic cleanup
        // You can implement full cleanup logic later
    }

    /**
     * Shutdown (placeholder)
     */
    async shutdown() {
        logger.info('Device sync service shutting down');
    }
}

// Create and export singleton instance
const deviceSyncService = new DeviceSyncService();
export default deviceSyncService;