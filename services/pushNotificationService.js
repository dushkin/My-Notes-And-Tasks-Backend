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
            const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@notask.co';

            if (!vapidPublicKey || !vapidPrivateKey) {
                logger.warn('VAPID keys not configured. Push notifications will not work.');
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

    getVapidPublicKey() {
        return process.env.VAPID_PUBLIC_KEY;
    }

    async sendNotification(subscription, payload) {
        if (!this.initialized) {
            logger.warn('Push notification service not initialized. Skipping notification.');
            return { success: false, error: 'Service not initialized' };
        }

        try {
            // Handle both object and string payloads
            const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

            const result = await webpush.sendNotification(subscription, payloadString, {
                TTL: 86400,  // 24 hours
                urgency: 'normal',
                headers: {}
            });

            logger.info('Push notification sent successfully', {
                endpoint: subscription.endpoint?.substring(0, 50) + '...' || 'unknown'
            });
            return { success: true, result };
        } catch (error) {
            const endpoint = subscription.endpoint?.substring(0, 50) + '...' || 'unknown';

            logger.error('Failed to send push notification', {
                statusCode: error.statusCode,
                endpoint,
                error: error.message
            });

            // Handle specific error cases
            if (error.statusCode === 410 || error.statusCode === 404) {
                return {
                    success: false,
                    error: 'invalid_subscription',
                    shouldRemove: true,
                    statusCode: error.statusCode
                };
            }

            if (error.statusCode === 429) {
                return {
                    success: false,
                    error: 'rate_limited',
                    shouldRetry: true,
                    statusCode: error.statusCode
                };
            }

            return {
                success: false,
                error: error.message,
                statusCode: error.statusCode
            };
        }
    }

    async sendNotificationToMultiple(subscriptions, payload) {
        const results = [];
        const invalidSubscriptions = [];

        if (!subscriptions || subscriptions.length === 0) {
            logger.warn('No subscriptions provided for bulk notification');
            return { results: [], invalidSubscriptions: [] };
        }

        logger.info('Sending notification to multiple devices', {
            subscriptionCount: subscriptions.length,
            payloadType: typeof payload
        });

        for (const subscription of subscriptions) {
            try {
                const result = await this.sendNotification(subscription, payload);

                results.push({
                    endpoint: subscription.endpoint?.substring(0, 50) + '...' || 'unknown',
                    success: result.success,
                    error: result.error,
                    statusCode: result.statusCode
                });

                if (result.shouldRemove) {
                    invalidSubscriptions.push(subscription);
                }
            } catch (error) {
                logger.error('Unexpected error in bulk notification', {
                    error: error.message,
                    endpoint: subscription.endpoint?.substring(0, 50) + '...' || 'unknown'
                });

                results.push({
                    endpoint: subscription.endpoint?.substring(0, 50) + '...' || 'unknown',
                    success: false,
                    error: 'unexpected_error'
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        logger.info('Bulk notification completed', {
            totalSent: subscriptions.length,
            successful: successCount,
            failed: subscriptions.length - successCount,
            invalidSubscriptions: invalidSubscriptions.length
        });

        return { results, invalidSubscriptions };
    }

    // Update the createReminderPayload method in pushNotificationService.js
    // Replace the existing method with this updated version:

    createReminderPayload(itemTitle, itemId, reminderTime, options = {}) {
        // Check if Done button should be displayed
        const shouldDisplayDoneButton = options.reminderDisplayDoneButton ?? true; // Default to true

        // Configure actions based on setting
        const actions = shouldDisplayDoneButton ? [
            { action: "done", title: "✅ Done", icon: "/favicon-32x32.png" },
            { action: "snooze", title: "⏰ Snooze", icon: "/favicon-32x32.png" },
            { action: "open", title: "📱 Open App", icon: "/favicon-32x32.png" }
        ] : [
            { action: "snooze", title: "⏰ Snooze", icon: "/favicon-32x32.png" },
            { action: "open", title: "📱 Open App", icon: "/favicon-32x32.png" }
        ];

        return {
            title: '⏰ Reminder',
            body: itemTitle || 'You have a reminder',
            icon: '/favicon-192x192.png',
            badge: '/favicon-48x48.png',
            tag: `reminder-${itemId || Date.now()}`,
            requireInteraction: shouldDisplayDoneButton, // Only require interaction if Done button is enabled
            silent: false,
            vibrate: [200, 100, 200],
            data: {
                type: 'reminder',
                itemId: itemId || null,
                reminderTime: reminderTime || Date.now(),
                url: itemId ? `/app?focus=${itemId}` : '/app',
                shouldDisplayDoneButton: shouldDisplayDoneButton, // Pass setting to client
                autoTimeoutMs: shouldDisplayDoneButton ? null : 8000 // Auto-dismiss after 5s if no Done button
            },
            actions: actions,
            timestamp: Date.now()
        };
    }

    createNotificationPayload(title, body, options = {}) {
        const defaultOptions = {
            icon: '/favicon-192x192.png',
            badge: '/favicon-48x48.png',
            tag: `notification-${Date.now()}`,
            requireInteraction: false,
            silent: false,
            timestamp: Date.now(),
            data: {
                type: 'general',
                url: '/app'
            }
        };

        // Merge options with defaults
        const payload = {
            title: title || 'Notification',
            body: body || 'You have a new notification',
            ...defaultOptions,
            ...options
        };

        // Merge data objects
        if (options.data) {
            payload.data = { ...defaultOptions.data, ...options.data };
        }

        return payload;
    }

    createSyncNotificationPayload(syncType, deviceName) {
        return {
            title: '🔄 Device Sync',
            body: `Syncing data${deviceName ? ` from ${deviceName}` : ''}...`,
            icon: '/favicon-128x128.png',
            badge: '/favicon-48x48.png',
            tag: 'device-sync',
