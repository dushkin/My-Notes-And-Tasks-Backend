import express from "express";
import webpush from "web-push";
import PushSubscription from "../models/PushSubscription.js";
import User from "../models/User.js";
import authMiddleware from "../middleware/authMiddleware.js";
import logger from '../config/logger.js';

const router = express.Router();

// Initialize web-push with VAPID keys
try {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@notask.co';

    if (vapidPublicKey && vapidPrivateKey) {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        logger.info('Web-push VAPID details configured successfully');
    } else {
        logger.warn('VAPID keys not configured. Push notifications will not work.');
    }
} catch (error) {
    logger.error('Failed to configure web-push VAPID details:', {
        error: error.message
    });
}

// PUBLIC ENDPOINT: Get VAPID public key (no auth required)
router.get("/vapid-public-key", (req, res) => {
    logger.debug('VAPID public key requested', { 
        ip: req.ip, 
        userAgent: req.get('User-Agent')
    });
    
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
        logger.warn('VAPID public key requested but not configured');
        return res.status(503).json({
            success: false,
            message: 'Push notifications not configured on server'
        });
    }
    
    logger.debug('VAPID public key served successfully');
    res.status(200).json({ success: true, publicKey });
});

// PROTECTED ENDPOINTS: Apply auth middleware to all routes below this point
router.use(authMiddleware);

// Save subscription (enhanced with device tracking)
router.post("/subscribe", async (req, res) => {
    try {
        const subscription = req.body;
        const deviceId = req.header('X-Device-ID') || req.deviceId;
        
        logger.debug('Push subscription request received:', {
            userId: req.user?.id,
            hasSubscription: !!subscription,
            subscriptionKeys: subscription ? Object.keys(subscription) : [],
            endpoint: subscription?.endpoint,
            endpointType: typeof subscription?.endpoint,
            rawBody: subscription
        });
        
        if (!subscription || !subscription.endpoint) {
            logger.error('Invalid subscription data:', {
                subscription,
                hasSubscription: !!subscription,
                hasEndpoint: !!subscription?.endpoint
            });
            return res.status(400).json({
                success: false,
                message: "Invalid subscription"
            });
        }

        // FIRST: Clean up any existing corrupted records (caused by previous bug)
        const nullCleanup = await PushSubscription.deleteMany({
            userId: req.user.id,
            $or: [
                { 'subscription.endpoint': null },
                { 'subscription.endpoint': undefined },
                { 'subscription': null },
                { 'subscription': undefined }
            ]
        });
        logger.info('Cleaned up corrupted subscription records', {
            userId: req.user.id,
            deletedCount: nullCleanup.deletedCount
        });

        // Check if subscription already exists in old PushSubscription model
        const existingSubscription = await PushSubscription.findOne({
            userId: req.user.id,
            'subscription.endpoint': subscription.endpoint
        });

        if (existingSubscription) {
            logger.info('Push subscription already exists in PushSubscription model', { 
                userId: req.user.id, 
                endpoint: subscription.endpoint.substring(0, 50) + '...' 
            });
            return res.status(200).json({
                success: true,
                message: "Subscription already exists"
            });
        }

        // Add to new User model push subscriptions
        try {
            logger.debug('Attempting to add push subscription to User model', {
                userId: req.user.id,
                hasSubscriptions: !!req.user.pushSubscriptions,
                subscriptionData: {
                    endpoint: subscription.endpoint?.substring(0, 50) + '...',
                    hasKeys: !!subscription.keys,
                    hasP256dh: !!subscription.keys?.p256dh,
                    hasAuth: !!subscription.keys?.auth
                }
            });
            await req.user.addPushSubscription(subscription, deviceId);
            logger.debug('Successfully added subscription to User model');
        } catch (userModelError) {
            logger.error('Failed to add subscription to User model:', {
                userId: req.user.id,
                error: userModelError.message,
                stack: userModelError.stack
            });
            // Continue to try old model for backward compatibility
        }

        // Also create in old PushSubscription model for backward compatibility
        try {
            await PushSubscription.create({ 
                userId: req.user.id, 
                subscription 
            });
            logger.debug('Successfully created subscription in PushSubscription model');
        } catch (legacyModelError) {
            logger.error('Failed to create subscription in legacy PushSubscription model:', {
                userId: req.user.id,
                error: legacyModelError.message
            });
            // This is more critical since this was the working model
            throw legacyModelError;
        }

        logger.info('Push subscription created successfully', {
            userId: req.user.id,
            deviceId,
            endpoint: subscription.endpoint.substring(0, 50) + '...'
        });

        res.status(201).json({
            success: true,
            message: "Subscribed successfully"
        });

    } catch (error) {
        logger.error('Failed to save push subscription:', {
            userId: req.user?.id,
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({
            success: false,
            message: "Failed to save subscription"
        });
    }
});

// Send test notification (enhanced)
router.post("/test", async (req, res) => {
    try {
        // Get subscriptions from both models
        const oldSubscriptions = await PushSubscription.find({ userId: req.user.id });
        const user = await User.findById(req.user.id);
        const newSubscriptions = user.activePushSubscriptions || [];

        // Combine subscriptions (avoid duplicates)
        const allSubscriptions = [...oldSubscriptions];
        newSubscriptions.forEach(newSub => {
            const exists = oldSubscriptions.some(oldSub => 
                oldSub.subscription.endpoint === newSub.endpoint
            );
            if (!exists) {
                allSubscriptions.push({ subscription: newSub });
            }
        });

        if (allSubscriptions.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No subscriptions found"
            });
        }

        const { message } = req.body;
        const payload = JSON.stringify({ 
            title: "🧪 Test Notification", 
            body: message || "Hello from your PWA sync system!",
            icon: "/favicon-192x192.png",
            badge: "/favicon-48x48.png",
            data: {
                type: 'test',
                timestamp: Date.now(),
                url: '/app'
            }
        });

        let successCount = 0;
        let failCount = 0;
        const results = [];

        for (const sub of allSubscriptions) {
            const subscription = sub.subscription || sub;
            try {
                await webpush.sendNotification(subscription, payload);
                successCount++;
                results.push({
                    endpoint: subscription.endpoint.substring(0, 50) + '...',
                    success: true
                });
                logger.debug('Test notification sent successfully', {
                    userId: req.user.id,
                    endpoint: subscription.endpoint.substring(0, 50) + '...'
                });
            } catch (err) {
                failCount++;
                results.push({
                    endpoint: subscription.endpoint.substring(0, 50) + '...',
                    success: false,
                    error: err.message
                });
                logger.error('Failed to send test notification:', {
                    userId: req.user.id,
                    endpoint: subscription.endpoint.substring(0, 50) + '...',
                    error: err.message
                });

                // Remove invalid subscriptions
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await PushSubscription.deleteOne({ _id: sub._id });
                    logger.info('Removed invalid push subscription', {
                        userId: req.user.id,
                        subscriptionId: sub._id
                    });
                }
            }
        }

        logger.info('Test notification batch completed', {
            userId: req.user.id,
            totalSubscriptions: allSubscriptions.length,
            successCount,
            failCount
        });

        res.status(200).json({
            success: true,
            message: `Notification sent to ${successCount}/${allSubscriptions.length} devices`,
            results: {
                total: allSubscriptions.length,
                successful: successCount,
                failed: failCount,
                details: results
            }
        });

    } catch (error) {
        logger.error('Test notification failed:', {
            userId: req.user?.id,
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({
            success: false,
            message: "Failed to send test notification"
        });
    }
});

// TEMPORARY: Manual cleanup endpoint for corrupted subscriptions
router.delete("/cleanup", async (req, res) => {
    try {
        const result = await PushSubscription.deleteMany({
            userId: req.user.id,
            $or: [
                { 'subscription.endpoint': null },
                { 'subscription.endpoint': undefined },
                { 'subscription.endpoint': "" },
                { 'subscription': null },
                { 'subscription': undefined }
            ]
        });
        
        logger.info('Manual cleanup completed', {
            userId: req.user.id,
            deletedCount: result.deletedCount
        });
        
        res.status(200).json({
            success: true,
            message: `Cleaned up ${result.deletedCount} corrupted subscription records`
        });
    } catch (error) {
        logger.error('Manual cleanup failed:', error);
        res.status(500).json({
            success: false,
            message: "Cleanup failed"
        });
    }
});

// Get user's subscriptions
router.get("/subscriptions", async (req, res) => {
    try {
        const subscriptions = await PushSubscription.find({ userId: req.user.id })
            .select('subscription.endpoint createdAt')
            .lean();

        const formattedSubscriptions = subscriptions.map(sub => ({
            id: sub._id,
            endpoint: sub.subscription.endpoint.substring(0, 50) + '...',
            createdAt: sub.createdAt
        }));

        res.status(200).json({
            success: true,
            subscriptions: formattedSubscriptions,
            count: subscriptions.length
        });

    } catch (error) {
        logger.error('Failed to get user subscriptions:', {
            userId: req.user?.id,
            error: error.message
        });
        res.status(500).json({
            success: false,
            message: "Failed to retrieve subscriptions"
        });
    }
});

export default router;