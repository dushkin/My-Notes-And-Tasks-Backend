import express from 'express';
import User from '../models/User.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import logger from '../config/logger.js';

const router = express.Router();

/**
 * @openapi
 * /meta/user-count:
 *   get:
 *     tags:
 *       - Meta
 *     summary: Get current user count and beta limit information
 *     description: Returns the current number of registered users and beta configuration for frontend registration limiting.
 *     responses:
 *       '200':
 *         description: User count and beta information retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCount:
 *                   type: integer
 *                   description: Current number of registered users
 *                   example: 45
 *                 betaEnabled:
 *                   type: boolean
 *                   description: Whether beta limiting is enabled
 *                   example: true
 *                 betaLimit:
 *                   type: integer
 *                   description: Maximum number of beta users allowed
 *                   example: 50
 *                 limitReached:
 *                   type: boolean
 *                   description: Whether the beta user limit has been reached
 *                   example: false
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal server error"
 */
router.get('/user-count', catchAsync(async (req, res, next) => {
  logger.info('User count check requested', { 
    ip: req.ip, 
    userAgent: req.get('User-Agent')
  });

  try {
    // Get current user count
    const userCount = await User.countDocuments();
    
    // Get beta configuration from environment variables
    const betaEnabled = process.env.BETA_ENABLED === 'true';
    const betaLimit = parseInt(process.env.BETA_USER_LIMIT || '50', 10);
    const limitReached = betaEnabled && userCount >= betaLimit;

    logger.info('User count check completed', {
      userCount,
      betaEnabled,
      betaLimit,
      limitReached,
      ip: req.ip
    });

    res.status(200).json({
      userCount,
      betaEnabled,
      betaLimit,
      limitReached
    });

  } catch (error) {
    logger.error('Error checking user count:', {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    
    return next(new AppError('Unable to retrieve user count information', 500));
  }
}));

/**
 * @openapi
 * /meta/beta-status:
 *   get:
 *     tags:
 *       - Meta
 *     summary: Get beta status information
 *     description: Returns detailed beta configuration and status for administrative purposes.
 *     responses:
 *       '200':
 *         description: Beta status information retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 beta:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                       example: true
 *                     userLimit:
 *                       type: integer
 *                       example: 50
 *                     currentUsers:
 *                       type: integer
 *                       example: 45
 *                     remainingSlots:
 *                       type: integer
 *                       example: 5
 *                     limitReached:
 *                       type: boolean
 *                       example: false
 *                     registrationBlocked:
 *                       type: boolean
 *                       example: false
 */
router.get('/beta-status', catchAsync(async (req, res, next) => {
  logger.info('Beta status check requested', { 
    ip: req.ip, 
    userAgent: req.get('User-Agent')
  });

  try {
    // Get current user count
    const currentUsers = await User.countDocuments();
    
    // Get beta configuration
    const betaEnabled = process.env.BETA_ENABLED === 'true';
    const userLimit = parseInt(process.env.BETA_USER_LIMIT || '50', 10);
    const limitReached = betaEnabled && currentUsers >= userLimit;
    const remainingSlots = betaEnabled ? Math.max(0, userLimit - currentUsers) : Infinity;
    const registrationBlocked = betaEnabled && limitReached;

    const betaStatus = {
      enabled: betaEnabled,
      userLimit: betaEnabled ? userLimit : null,
      currentUsers,
      remainingSlots: betaEnabled ? remainingSlots : null,
      limitReached,
      registrationBlocked
    };

    logger.info('Beta status check completed', {
      ...betaStatus,
      ip: req.ip
    });

    res.status(200).json({
      beta: betaStatus
    });

  } catch (error) {
    logger.error('Error checking beta status:', {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    
    return next(new AppError('Unable to retrieve beta status information', 500));
  }
}));

export default router;