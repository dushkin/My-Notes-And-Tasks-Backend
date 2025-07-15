import webpush from 'web-push';
import logger from '../config/logger.js';

class PushNotificationService {
    constructor() {
        this.initialized = false;
        this.init();
    }

    init() {
        try {
            // VAPID keys should be set in environment variables
            const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
            const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
            const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@notesandtasks.com';

            if (!vapidPublicKey || !vapidPrivateKey) {
                logger.warn('VAPID keys not configured. Push notifications will not work.');
                logger.info('To enable push notifications, set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.');
                logger.info('Generate VAPID keys using: npx web-push generate-vapid-keys');
                return;
            }

            webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
            this.initialized = true;
            logger.info('Push notification service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize push notification service:', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Get VAPID public key for client-side subscription
     */
    getVapidPublicKey() {
        return process.env.VAPID_PUBLIC_KEY;
    }

    /**
     * Send push notification to a single subscription
     */
    async sendNotification(subscription, payload, options = {}) {
        if (!this.initialized) {
            logger.warn('Push notification service not initialized. Skipping notification.');
            return { success: false, error: 'Service not initialized' };
        }

        try {
            const defaultOptions = {
                TTL: 60 * 60 * 24, // 24 hours
                urgency: 'normal',
                ...options
            };

            const result = await webpush.sendNotification(subscription, JSON.stringify(payload), defaultOptions);
            
            logger.info('Push notification sent successfully', {
                endpoint: subscription.endpoint.substring(0, 50) + '...',
                statusCode: result.statusCode
            });

            return { success: true, result };
        } catch (error) {
            logger.error('Failed to send push notification:', {
                error: error.message,
                statusCode: error.statusCode,
                endpoint: subscription.endpoint?.substring(0, 50) + '...'
            });

            // Handle specific error cases
            if (error.statusCode === 410 || error.statusCode === 404) {
                // Subscription is no longer valid
                return { success: false, error: 'invalid_subscription', shouldRemove: true };
            }

            return { success: false, error: error.message };
        }
    }

    /**
     * Send push notification to multiple subscriptions
     */
    async sendNotificationToMultiple(subscriptions, payload, options = {}) {
        if (!this.initialized) {
            logger.warn('Push notification service not initialized. Skipping notifications.');
            return { success: false, error: 'Service not initialized' };
        }

        const results = [];
        const invalidSubscriptions = [];

        for (const subscription of subscriptions) {
            const result = await this.sendNotification(subscription, payload, options);
            results.push({
                subscription: subscription.endpoint.substring(0, 50) + '...',
                ...result
            });

            if (result.shouldRemove) {
                invalidSubscriptions.push(subscription);
            }
        }

        logger.info('Bulk push notifications completed', {
            total: subscriptions.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            invalidSubscriptions: invalidSubscriptions.length
        });

        return {
            success: true,
            results,
            invalidSubscriptions
        };
    }

    /**
     * Create a reminder notification payload
     */
    createReminderPayload(itemTitle, itemId, reminderTime) {
        return {
            title: '⏰ Reminder',
            body: `Don't forget: ${itemTitle}`,
            icon: '/favicon-128x128.png',
            badge: '/favicon-48x48.png',
            tag: `reminder-${itemId}`,
            data: {
                type: 'reminder',
                itemId,
                reminderTime,
                url: `/app?item=${itemId}`
            },
            actions: [
                {
                    action: 'view',
                    title: 'View Item'
                },
                {
                    action: 'dismiss',
                    title: 'Dismiss'
                }
            ],
            requireInteraction: true,
            silent: false
        };
    }

    /**
     * Create a general notification payload
     */
    createNotificationPayload(title, body, options = {}) {
        return {
            title,
            body,
            icon: options.icon || '/favicon-128x128.png',
            badge: options.badge || '/favicon-48x48.png',
            tag: options.tag || `notification-${Date.now()}`,
            data: {
                type: options.type || 'general',
                url: options.url || '/app',
                ...options.data
            },
            actions: options.actions || [],
            requireInteraction: options.requireInteraction || false,
            silent: options.silent || false
        };
    }
}

// Export singleton instance
export default new PushNotificationService();
