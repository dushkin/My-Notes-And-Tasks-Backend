import express from 'express';
import { body, validationResult } from 'express-validator';
import {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  verifyToken
} from '../controllers/authController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { authLimiter } from '../middleware/rateLimiterMiddleware.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import User from '../models/User.js';
import RefreshToken from '../models/refreshToken.js';
import logger from '../config/logger.js';

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg);
    let flatErrorMessages = [];
    errorMessages.forEach(msg => {
      if (Array.isArray(msg)) {
        flatErrorMessages = flatErrorMessages.concat(msg);
      } else {
        flatErrorMessages.push(msg);
      }
    });
    logger.warn('Validation error in authRoutes', {
      errors: flatErrorMessages,
      path: req.path,
      ip: req.ip
    });
    return next(new AppError(flatErrorMessages.join(', ') || 'Validation error', 400));
  }
  next();
};

// Beta limit check middleware
const checkBetaUserLimit = catchAsync(async (req, res, next) => {
  // Check if beta limiting is enabled
  const betaEnabled = process.env.BETA_ENABLED === 'true';
  
  if (!betaEnabled) {
    // Beta limiting is disabled, proceed normally
    return next();
  }

  const betaLimit = parseInt(process.env.BETA_USER_LIMIT || '50', 10);
  const currentUserCount = await User.countDocuments();

  logger.info('Beta limit check during registration', {
    betaEnabled,
    betaLimit,
    currentUserCount,
    email: req.body?.email,
    ip: req.ip
  });

  if (currentUserCount >= betaLimit) {
    logger.warn('Registration blocked: Beta user limit reached', {
      currentUserCount,
      betaLimit,
      attemptedEmail: req.body?.email,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    return next(new AppError(
      `Registration is temporarily disabled. Beta user limit of ${betaLimit} users has been reached. Please try again later.`,
      403
    ));
  }

  // Check if we're very close to the limit (within 1 user) to handle race conditions
  if (currentUserCount >= betaLimit - 1) {
    logger.warn('Registration attempted near beta limit', {
      currentUserCount,
      betaLimit,
      remainingSlots: betaLimit - currentUserCount,
      email: req.body?.email,
      ip: req.ip
    });
  }

  next();
});

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Register a new user
 *     description: Creates a new user account with the provided email and password. Registration may be limited during beta period.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserInput'
 *     responses:
 *       '201':
 *         description: User registered successfully. Returns JWT tokens and user object.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       '400':
 *         description: Invalid input (e.g., missing fields, invalid email, weak password, email already exists).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Registration blocked due to beta user limit.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Registration is temporarily disabled. Beta user limit of 50 users has been reached. Please try again later."
 *       '500':
 *         description: Server error during registration.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/register',
  authLimiter,
  [
    body('email')
      .trim()
      .isEmail().withMessage('Please provide a valid email address.')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
  ],
  validate,
  checkBetaUserLimit, // Add beta limit check before registration
  register
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Login a user
 *     description: Authenticates a user with email and password, returning JWT tokens upon success.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserInput'
 *     responses:
 *       '200':
 *         description: Login successful. Returns JWT tokens and user object.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       '400':
 *         description: Bad Request - Invalid email format or missing password.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Unauthorized - Invalid credentials.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Server error during login.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/login',
  authLimiter,
  [
    body('email')
      .trim()
      .isEmail().withMessage('Please provide a valid email address.')
      .normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Password is required.')
  ],
  validate,
  login
);

/**
 * @openapi
 * /auth/refresh-token:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Refresh access token
 *     description: Exchanges a valid refresh token for new access and refresh tokens.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: The refresh token
 *                 example: "your-refresh-token-string"
 *     responses:
 *       '200':
 *         description: Tokens refreshed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   example: "new-access-token-string"
 *                 refreshToken:
 *                   type: string
 *                   example: "new-refresh-token-string"
 *       '401':
 *         description: Refresh token required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Invalid or expired refresh token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Server error during token refresh.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/refresh-token',
  authLimiter,
  [
    body('token')
      .notEmpty().withMessage('Refresh token is required.')
      .isString().withMessage('Refresh token must be a string.')
  ],
  validate,
  refreshToken
);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Logout user
 *     description: Revokes the provided refresh token. Recommended for client-side initiated logout of current session.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: The refresh token to revoke (optional).
 *                 example: "your-refresh-token-string"
 *     responses:
 *       '200':
 *         description: Logged out successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *       '500':
 *         description: Server error during logout.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/logout',
  [
    body('refreshToken')
      .optional()
      .isString().withMessage('Refresh token must be a string if provided')
      .isLength({ min: 10 }).withMessage('Invalid refresh token format')
  ],
  validate,
  logout
);

/**
 * @openapi
 * /auth/logout-all:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Logout from all devices
 *     description: Revokes all refresh tokens for the authenticated user, effectively logging them out from all devices.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Logged out from all devices successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logged out from all devices successfully
 *                 revokedTokens:
 *                   type: integer
 *                   example: 3
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/logout-all', authMiddleware, logoutAll);

/**
 * @openapi
 * /auth/verify-token:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Verify access token
 *     description: Verifies if the provided access token (in Authorization header) is valid and returns user information.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Token is valid.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   $ref: '#/components/schemas/UserResponse'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/verify-token', authMiddleware, verifyToken);

/**
 * @openapi
 * /auth/account:
 *   delete:
 *     tags:
 *       - Auth
 *     summary: Delete user account
 *     description: Permanently deletes the authenticated user's account and all associated data.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Account deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Account deleted successfully
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '404':
 *         description: User not found (should not happen if authenticated).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/account', authMiddleware, catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  logger.info('Attempting to delete account', { userId, email: req.user.email });

  await RefreshToken.deleteMany({ userId });
  logger.info('All refresh tokens deleted for user during account deletion', { userId });

  const result = await User.findByIdAndDelete(userId);

  if (!result) {
    logger.warn('User not found during account deletion, though authenticated', { userId });
    return next(new AppError('User not found, deletion failed unexpectedly.', 404));
  }

  logger.info(`User account deleted successfully: ${req.user.email}`, { userId });
  res.status(200).json({ message: 'Account deleted successfully' });
}));

if (process.env.NODE_ENV !== 'production') {
  /**
   * @openapi
   * /auth/test-cleanup:
   *   delete:
   *     tags:
   *       - Auth
   *     summary: (Dev/Test Only) Cleanup test users
   *     description: Deletes all users with email addresses ending in '@e2e.com'. Intended for testing environments only.
   *     responses:
   *       '200':
   *         description: Test users cleaned up.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 deletedUsers:
   *                   type: integer
   *                 domain:
   *                   type: string
   *       '500':
   *         $ref: '#/components/responses/ServerError'
   */
  router.delete(
    '/test-cleanup',
    catchAsync(async (req, res, next) => {
      const result = await User.deleteMany({ email: /@e2e\.com$/ });
      res.status(200).json({
        success: true,
        message: 'Test cleanup completed',
        deletedUsers: result.deletedCount,
      });
    })
  );
}

/**
 * @openapi
 * /auth/beta-status:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Get beta registration status
 *     description: Returns beta configuration for frontend registration controls
 *     responses:
 *       '200':
 *         description: Beta status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 betaEnabled:
 *                   type: boolean
 *                   example: true
 *                 userCount:
 *                   type: integer
 *                   example: 45
 *                 limit:
 *                   type: integer
 *                   example: 50
 *       '500':
 *         description: Server error
 */
router.get('/beta-status', catchAsync(async (req, res, next) => {
  try {
    const betaEnabled = process.env.BETA_ENABLED === 'true';
    
    if (!betaEnabled) {
      return res.json({ betaEnabled: false });
    }

    const userCount = await User.countDocuments();
    const betaLimit = parseInt(process.env.BETA_USER_LIMIT || '50', 10);

    logger.info('Beta status requested', {
      betaEnabled,
      userCount,
      betaLimit,
      ip: req.ip
    });

    res.json({
      betaEnabled: true,
      userCount,
      limit: betaLimit
    });
  } catch (error) {
    logger.error('Beta status error:', { 
      error: error.message, 
      stack: error.stack,
      ip: req.ip 
    });
    return next(new AppError('Failed to get beta status', 500));
  }
}));

export default router;