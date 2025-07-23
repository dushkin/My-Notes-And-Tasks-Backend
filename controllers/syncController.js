import logger from '../config/logger.js';

/**
 * Get sync status (placeholder)
 */
export const getSyncStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        
        res.status(200).json({
            success: true,
            syncStatus: {
                totalDevices: 1,
                activeDevices: 1,
                lastSync: new Date(),
                syncInProgress: false,
                message: 'Sync controller is working (minimal version)'
            }
        });
        
        logger.info('Sync status requested', { userId });
    } catch (error) {
        logger.error('Error getting sync status:', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to get sync status'
        });
    }
};