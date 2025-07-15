import User from '../models/User.js';
import pushNotificationService from '../services/pushNotificationService.js';
import logger from '../config/logger.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';

/**
 * Get VAPID public key for client-side subscription
 */
export const getVapidPublicKey = catchAsync(async (req, res) => {
    const publicKey = pushNotificationService.getVapidPublicKey();
    
    if (!publicKey) {
        return res.status(503).json({
            success: false,
            message: 'Push notifications not configured on server'
        });
    }

    res.status(200).json({
        success: true,
        publicKey
    });
});

/**
 * Subscribe user to push notifications
 */
export const subscribe = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return next(new AppError('Invalid subscription data', 400));
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return next(new AppError('User not found', 404));
        }

        // Check if subscription already exists
        const existingSubscription = user.pushSubscriptions.find(
            sub => sub.endpoint === subscription.endpoint
        );

        if (existingSubscription) {
            logger.info('Push subscription already exists', { userId, endpoint: subscription.endpoint.substring(0, 50) + '...' });
            return res.status(200).json({
                success: true,
                message: 'Subscription already exists'
            });
        }

        // Add new subscription
        user.pushSubscriptions.push({
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth
            },
            userAgent: req.get('user-agent') || 'unknown',
            createdAt: new Date()
        });

        await user.save();

        logger.info('Push subscription added successfully', { 
            userId, 
            endpoint: subscription.endpoint.substring(0, 50) + '...',
            totalSubscriptions: user.pushSubscriptions.length
        });

        res.status(201).json({
            success: true,
            message: 'Subscription added successfully'
        });

    } catch (error) {
        logger.error('Failed to add push subscription:', {
            userId,
            error: error.message,
            stack: error.stack
        });
        return next(new AppError('Failed to add subscription', 500));
    }
});

/**
 * Unsubscribe user from push notifications
 */
export const unsubscribe = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { endpoint } = req.body;

    if (!endpoint) {
        return next(new AppError('Endpoint is required', 400));
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return next(new AppError('User not found', 404));
        }

        // Remove subscription
        const initialLength = user.pushSubscriptions.length;
        user.pushSubscriptions = user.pushSubscriptions.filter(
            sub => sub.endpoint !== endpoint
        );

        if (user.pushSubscriptions.length === initialLength) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found'
            });
        }

        await user.save();

        logger.info('Push subscription removed successfully', { 
            userId, 
            endpoint: endpoint.substring(0, 50) + '...',
            remainingSubscriptions: user.pushSubscriptions.length
        });

        res.status(200).json({
            success: true,
            message: 'Subscription removed successfully'
        });

    } catch (error) {
        logger.error('Failed to remove push subscription:', {
            userId,
            error: error.message,
            stack: error.stack
        });
        return next(new AppError('Failed to remove subscription', 500));
    }
});

/**
 * Send test push notification
 */
export const sendTestNotification = catchAsync(async (req, res, next) => {
    const userId = req.user.id;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return next(new AppError('User not found', 404));
        }

        if (!user.pushSubscriptions || user.pushSubscriptions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No push subscriptions found for user'
            });
        }

        const payload = pushNotificationService.createNotificationPayload(
            '🧪 Test Notification',
            'This is a test push notification from Notes & Tasks!',
            {
                type: 'test',
                tag: 'test-notification',
                requireInteraction: false
            }
        );

        const result = await pushNotificationService.sendNotificationToMultiple(
            user.pushSubscriptions,
            payload
        );

        // Remove invalid subscriptions
        if (result.invalidSubscriptions && result.invalidSubscriptions.length > 0) {
            user.pushSubscriptions = user.pushSubscriptions.filter(
                sub => !result.invalidSubscriptions.some(invalid => invalid.endpoint === sub.endpoint)
            );
            await user.save();
            
            logger.info('Removed invalid push subscriptions', {
                userId,
                removedCount: result.invalidSubscriptions.length
            });
        }

        res.status(200).json({
            success: true,
            message: 'Test notification sent',
            results: result.results
        });

    } catch (error) {
        logger.error('Failed to send test notification:', {
            userId,
            error: error.message,
            stack: error.stack
        });
        return next(new AppError('Failed to send test notification', 500));
    }
});

/**
 * Send reminder notification to user
 */
export const sendReminderNotification = catchAsync(async (userId, itemTitle, itemId, reminderTime) => {
    try {
        const user = await User.findById(userId);
        if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) {
            logger.warn('No push subscriptions found for reminder notification', { userId, itemId });
            return { success: false, message: 'No subscriptions found' };
        }

        const payload = pushNotificationService.createReminderPayload(itemTitle, itemId, reminderTime);

        const result = await pushNotificationService.sendNotificationToMultiple(
            user.pushSubscriptions,
            payload
        );

        // Remove invalid subscriptions
        if (result.invalidSubscriptions && result.invalidSubscriptions.length > 0) {
            user.pushSubscriptions = user.pushSubscriptions.filter(
                sub => !result.invalidSubscriptions.some(invalid => invalid.endpoint === sub.endpoint)
            );
            await user.save();
            
            logger.info('Removed invalid push subscriptions during reminder', {
                userId,
                itemId,
                removedCount: result.invalidSubscriptions.length
            });
        }

        logger.info('Reminder notification sent successfully', {
            userId,
            itemId,
            itemTitle,
            subscriptionsCount: user.pushSubscriptions.length,
            successfulSends: result.results.filter(r => r.success).length
        });

        return { success: true, result };

    } catch (error) {
        logger.error('Failed to send reminder notification:', {
            userId,
            itemId,
            itemTitle,
            error: error.message,
            stack: error.stack
        });
        return { success: false, error: error.message };
    }
});

/**
 * Get user's push subscription status
 */
export const getSubscriptionStatus = catchAsync(async (req, res) => {
    const userId = req.user.id;

    try {
        const user = await User.findById(userId).select('pushSubscriptions');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const subscriptions = user.pushSubscriptions || [];
        
        res.status(200).json({
            success: true,
            subscribed: subscriptions.length > 0,
            subscriptionsCount: subscriptions.length,
            subscriptions: subscriptions.map(sub => ({
                endpoint: sub.endpoint.substring(0, 50) + '...',
                userAgent: sub.userAgent,
                createdAt: sub.createdAt
            }))
        });

    } catch (error) {
        logger.error('Failed to get subscription status:', {
            userId,
            error: error.message,
            stack: error.stack
        });
        return res.status(500).json({
            success: false,
            message: 'Failed to get subscription status'
        });
    }
});
