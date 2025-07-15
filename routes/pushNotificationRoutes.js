import express from 'express';
import {
    getVapidPublicKey,
    subscribe,
    unsubscribe,
    sendTestNotification,
    getSubscriptionStatus
} from '../controllers/pushNotificationController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Public route to get VAPID public key
router.get('/vapid-public-key', getVapidPublicKey);

// Protected routes (require authentication)
router.use(authMiddleware);

// Get user's subscription status
router.get('/status', getSubscriptionStatus);

// Subscribe to push notifications
router.post('/subscribe', subscribe);

// Unsubscribe from push notifications
router.post('/unsubscribe', unsubscribe);

// Send test notification
router.post('/test', sendTestNotification);

export default router;
