// routes/subscriptionRoutes.js
import express from 'express';
import { body, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import PushSubscription from '../models/PushSubscription.js';
import logger from '../config/logger.js';

const router = express.Router();

router.use(authMiddleware);

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return next(new AppError(errors.array()[0].msg, 400));
    }
    next();
};

/**
 * @openapi
 * /subscriptions/subscribe:
 * post:
 * tags: [Push]
 * summary: Subscribe to push notifications
 * security:
 * - bearerAuth: []
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required: [endpoint, keys]
 * responses:
 * 201:
 * description: Subscription created
 * 400:
 * description: Invalid subscription object
 */
router.post(
    '/subscribe',
    [
        body('endpoint').isURL().withMessage('Invalid endpoint URL'),
        body('keys.p256dh').isString().notEmpty().withMessage('p256dh key is required'),
        body('keys.auth').isString().notEmpty().withMessage('auth key is required'),
        validate
    ],
    catchAsync(async (req, res) => {
        const { endpoint, keys } = req.body;
        const userId = req.user.id;

        const existingSubscription = await PushSubscription.findOne({ endpoint });

        if (existingSubscription) {
            logger.info('Updating existing push subscription', { userId, endpoint });
            existingSubscription.userId = userId;
            existingSubscription.keys = keys;
            await existingSubscription.save();
            res.status(200).json({ message: 'Subscription updated' });
        } else {
            logger.info('Creating new push subscription', { userId, endpoint });
            const newSubscription = new PushSubscription({
                userId,
                endpoint,
                keys: {
                    p256dh: keys.p256dh,
                    auth: keys.auth
                }
            });
            await newSubscription.save();
            res.status(201).json({ message: 'Subscription created' });
        }
    })
);

export default router;