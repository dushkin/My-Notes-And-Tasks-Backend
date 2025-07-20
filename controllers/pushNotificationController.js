import User from '../models/User.js';
import logger from '../config/logger.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import pushNotificationService from '../services/pushNotificationService.js';

/**
 * Get VAPID public key for client-side subscription
 */
export const getVapidPublicKey = catchAsync(async (req, res) => {
    const publicKey = pushNotificationService.getVapidPublicKey();
    if (!publicKey) {
        return res.status(503).json({ success: false, message: 'Push notifications not configured on server' });
    }
    res.status(200).json({ success: true, publicKey });
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

    const user = await User.findById(userId);
    if (!user) {
        return next(new AppError('User not found', 404));
    }

    const existingSubscription = user.pushSubscriptions.find(sub => sub.endpoint === subscription.endpoint);
    if (existingSubscription) {
        logger.info('Push subscription already exists', { userId, endpoint: subscription.endpoint.substring(0, 50) + '...' });
        return res.status(200).json({ success: true, message: 'Subscription already exists' });
    }

    user.pushSubscriptions.push({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        userAgent: req.get('user-agent') || 'unknown',
        createdAt: new Date()
    });
    await user.save();

    logger.info('Push subscription added successfully', { 
        userId, 
        endpoint: subscription.endpoint.substring(0, 50) + '...',
        totalSubscriptions: user.pushSubscriptions.length
    });
    res.status(201).json({ success: true, message: 'Subscription added successfully' });
});

/**
 * Send reminder notification to user
 */
export const sendReminderNotification = async (userId, itemTitle, itemId, reminderTime) => {
    try {
        const user = await User.findById(userId).select('pushSubscriptions').lean();
        if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) {
            logger.warn('No push subscriptions found for reminder notification', { userId, itemId });
            return { success: false, message: 'No subscriptions found' };
        }

        const payload = pushNotificationService.createReminderPayload(itemTitle, itemId, reminderTime);
        const result = await pushNotificationService.sendNotificationToMultiple(user.pushSubscriptions, payload);

        if (result.invalidSubscriptions && result.invalidSubscriptions.length > 0) {
            await User.updateOne(
                { _id: userId },
                { $pull: { pushSubscriptions: { endpoint: { $in: result.invalidSubscriptions.map(s => s.endpoint) } } } }
            );
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
};