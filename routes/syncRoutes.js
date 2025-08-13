import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import Device from '../models/Device.js';
import logger from '../config/logger.js';
import { syncValidationChains } from '../utils/syncValidation.js';
import { 
  validateSyncRequestSize, 
  validateSyncPermissions, 
  syncRateLimit, 
  setSyncSecurityHeaders 
} from '../middleware/syncSecurityMiddleware.js';

const router = express.Router();

// Apply comprehensive security middleware to all sync endpoints
router.use(authMiddleware);
router.use(setSyncSecurityHeaders);
router.use(validateSyncPermissions);
router.use(syncRateLimit(100, 15)); // 100 requests per 15 minutes
router.use(validateSyncRequestSize(5 * 1024 * 1024)); // 5MB max request size

// Register device
router.post('/devices/register', syncValidationChains.deviceRegister, async (req, res) => {
    try {
        const userId = req.user.id;
        const deviceInfo = req.body;

        // Check if device already exists
        let device = await Device.findOne({ 
            userId, 
            deviceId: deviceInfo.id 
        });

        if (device) {
            // Update existing device
            device.lastActive = new Date();
            device.userAgent = deviceInfo.userAgent;
            device.capabilities = { ...device.capabilities, ...deviceInfo.capabilities };
            await device.save();
            
            logger.info('Device updated successfully', { 
                userId, 
                deviceId: deviceInfo.id,
                deviceType: deviceInfo.type 
            });
        } else {
            // Create new device
            device = await Device.create({
                userId,
                deviceId: deviceInfo.id,
                name: deviceInfo.name,
                type: deviceInfo.type,
                platform: deviceInfo.platform,
                userAgent: deviceInfo.userAgent,
                capabilities: deviceInfo.capabilities,
                lastActive: new Date(),
                isActive: true
            });
            
            logger.info('New device registered successfully', { 
                userId, 
                deviceId: deviceInfo.id,
                deviceType: deviceInfo.type,
                deviceName: deviceInfo.name
            });
        }

        res.status(201).json({
            success: true,
            message: 'Device registered successfully',
            device: {
                id: device.deviceId,
                name: device.name,
                type: device.type,
                lastActive: device.lastActive
            }
        });

    } catch (error) {
        logger.error('Failed to register device:', {
            userId: req.user?.id,
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({
            success: false,
            message: 'Failed to register device'
        });
    }
});

// Get user's devices
router.get('/devices', async (req, res) => {
    try {
        const userId = req.user.id;
        const devices = await Device.findActiveForUser(userId);

        const formattedDevices = devices.map(device => ({
            id: device.deviceId,
            name: device.name,
            type: device.type,
            platform: device.platform,
            lastActive: device.lastActive,
            isRecentlyActive: device.isRecentlyActive,
            capabilities: device.capabilities,
            icon: device.icon
        }));

        res.status(200).json({
            success: true,
            devices: formattedDevices,
            totalDevices: devices.length,
            activeDevices: devices.filter(d => d.isRecentlyActive).length
        });

    } catch (error) {
        logger.error('Failed to get user devices:', {
            userId: req.user?.id,
            error: error.message
        });
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve devices'
        });
    }
});

// Get sync status
router.get('/status', async (req, res) => {
    try {
        const userId = req.user.id;
        const user = req.user;
        
        // Get device count
        const deviceCount = await Device.countDocuments({ 
            userId, 
            isActive: true,
            removedAt: null 
        });

        // Get user sync status
        const syncStatus = user.getSyncStatus ? user.getSyncStatus() : {
            totalDevices: deviceCount,
            activeSubscriptions: user.activePushSubscriptions?.length || 0,
            lastSync: user.deviceMetadata?.lastSyncTime || null,
            syncVersion: user.deviceMetadata?.syncVersion || '1.0.0'
        };

        res.status(200).json({
            success: true,
            syncStatus: {
                ...syncStatus,
                totalDevices: deviceCount,
                syncInProgress: false,
                message: 'Sync service operational'
            }
        });

    } catch (error) {
        logger.error('Failed to get sync status:', {
            userId: req.user?.id,
            error: error.message
        });
        res.status(500).json({
            success: false,
            message: 'Failed to get sync status'
        });
    }
});

// Trigger sync
router.post('/trigger', syncValidationChains.syncTrigger, async (req, res) => {
    try {
        const userId = req.user.id;
        const { deviceId, dataType = 'all' } = req.body;

        // Record sync activity
        if (req.user.recordSync) {
            await req.user.recordSync();
        }

        logger.info('Sync triggered', {
            userId,
            deviceId,
            dataType
        });

        res.status(200).json({
            success: true,
            message: 'Sync triggered successfully',
            timestamp: new Date()
        });

    } catch (error) {
        logger.error('Failed to trigger sync:', {
            userId: req.user?.id,
            error: error.message
        });
        res.status(500).json({
            success: false,
            message: 'Failed to trigger sync'
        });
    }
});

// Update device activity
router.post('/devices/activity', syncValidationChains.deviceActivity, async (req, res) => {
    try {
        const userId = req.user.id;
        const { deviceId } = req.body;

        await Device.updateOne(
            { userId, deviceId },
            { 
                lastActive: new Date(),
                isActive: true
            }
        );

        res.status(200).json({
            success: true,
            message: 'Device activity updated'
        });

    } catch (error) {
        logger.error('Failed to update device activity:', {
            userId: req.user?.id,
            error: error.message
        });
        res.status(500).json({
            success: false,
            message: 'Failed to update device activity'
        });
    }
});

export default router;