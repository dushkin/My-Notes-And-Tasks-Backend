// routes/userRoutes.js
import express from 'express';
import { body, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import { updateUserSettings } from '../controllers/userController.js';

const router = express.Router();
router.use(authMiddleware);

/**
 * @openapi
 * /user/settings:
 * patch:
 * tags: [User]
 * summary: Update user settings
 * security:
 * - bearerAuth: []
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * theme: { type: string }
 * reminderSoundEnabled: { type: boolean }
 * reminderVibrationEnabled: { type: boolean }
 * responses:
 * '200':
 * description: Settings updated successfully.
 * '400':
 * description: Bad request.
 */
router.patch('/settings', updateUserSettings);

export default router;