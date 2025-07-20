import webpush from 'web-push';
import logger from '../config/logger.js';

class PushNotificationService {
    constructor() {
        this.initialized = false;
        this.init();
    }

    init() {
        try {
            const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
            const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
            const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@notesandtasks.com';

            if (!vapidPublicKey || !vapidPrivateKey) {
                logger.warn('VAPID keys not configured. Push notifications will not work.');
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

    getVapidPublicKey() {
        return process.env.VAPID_PUBLIC_KEY;
    }

    async sendNotification(subscription, payload) {
        if (!this.initialized) {
            logger.warn('Push notification service not initialized. Skipping notification.');
            return { success: false, error: 'Service not initialized' };
        }

        try {
            const result = await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 86400 });
            logger.info('Push notification sent successfully', { endpoint: subscription.endpoint.substring(0, 50) + '...' });
            return { success: true, result };
        } catch (error) {
            logger.error('Failed to send push notification', { statusCode: error.statusCode, endpoint: subscription.endpoint.substring(0, 50) + '...' });
            if (error.statusCode === 410 || error.statusCode === 404) {
                return { success: false, error: 'invalid_subscription', shouldRemove: true };
            }
            return { success: false, error: error.message };
        }
    }

    async sendNotificationToMultiple(subscriptions, payload) {
        const results = [];
        const invalidSubscriptions = [];

        for (const subscription of subscriptions) {
            const result = await this.sendNotification(subscription, payload);
            results.push({ subscription: subscription.endpoint.substring(0, 50) + '...', ...result });
            if (result.shouldRemove) {
                invalidSubscriptions.push(subscription);
            }
        }
        return { results, invalidSubscriptions };
    }

    createReminderPayload(itemTitle, itemId, reminderTime) {
        return {
            title: '⏰ Reminder',
            body: itemTitle,
            data: {
                type: 'reminder',
                itemId,
                reminderTime,
            }
        };
    }
    
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

export default new PushNotificationService();