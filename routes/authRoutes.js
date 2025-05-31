// routes/authRoutes.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { register, login, refreshToken, logout, logoutAll, verifyToken } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiterMiddleware');
const router = express.Router();

// Middleware to handle validation errors
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
    return res.status(400).json({ error: flatErrorMessages.join(', ') || 'Validation error' });
  }
  next();
};

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Register a new user
 *     description: Creates a new user account with the provided email and password.
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
 *       '500':
 *         description: Server error during registration.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

router.post('/register',
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

router.post('/login',
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
 *                 refreshToken:
 *                   type: string
 *       '401':
 *         description: Refresh token required.
 *       '403':
 *         description: Invalid or expired refresh token.
 *       '500':
 *         description: Server error during token refresh.
 */

router.post('/refresh-token',
  authLimiter,
  [
    body('token')
      .notEmpty().withMessage('Refresh token is required.')
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
 *     description: Revokes the provided refresh token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: The refresh token to revoke
 *     responses:
 *       '200':
 *         description: Logged out successfully.
 *       '500':
 *         description: Server error during logout.
 */

router.post('/logout', logout);

/**
 * @openapi
 * /auth/logout-all:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Logout from all devices
 *     description: Revokes all refresh tokens for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Logged out from all devices successfully.
 *       '401':
 *         description: Unauthorized.
 *       '500':
 *         description: Server error during logout.
 */

router.post('/logout-all', authMiddleware, logoutAll);

/**
 * @openapi
 * /auth/verify-token:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Verify access token
 *     description: Verifies if the provided access token is valid.
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
 *                 user:
 *                   $ref: '#/components/schemas/UserResponse'
 *       '401':
 *         description: Unauthorized.
 *       '500':
 *         description: Server error during verification.
 */

router.get('/verify-token', authMiddleware, verifyToken);

router.delete('/account', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify token
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      try {
        // Find and delete the user
        // Adjust this based on your database setup

        // For in-memory storage (if using the example auth routes):
        const userEmail = decoded.email;
        if (users.has(userEmail)) {
          users.delete(userEmail);
          console.log(`User deleted: ${userEmail}`);

          // Also clean up any refresh tokens for this user
          const userRefreshTokens = Array.from(refreshTokens).filter(token => {
            try {
              const tokenData = jwt.verify(token, REFRESH_SECRET);
              return tokenData.email === userEmail;
            } catch {
              return false;
            }
          });

          userRefreshTokens.forEach(token => refreshTokens.delete(token));

          res.json({ message: 'Account deleted successfully' });
        } else {
          res.status(404).json({ error: 'User not found' });
        }

        // For MongoDB with Mongoose:
        /*
        const user = await User.findOne({ email: decoded.email });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        await User.findByIdAndDelete(user._id);
        console.log(`User deleted: ${decoded.email}`);
        res.json({ message: 'Account deleted successfully' });
        */

      } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a test-only cleanup endpoint (only in development/test)
if (process.env.NODE_ENV !== 'production') {
  router.delete('/test-cleanup', async (req, res) => {
    try {
      const User = require('../models/User');

      // Delete all users with test email patterns
      const result = await User.deleteMany({
        email: {
          $regex: /^(test|admin|user).*@example\.com$|^.*-test-.*@example\.com$/,
          $options: 'i'
        }
      });

      console.log(`Test cleanup: deleted ${result.deletedCount} test users`);
      res.json({
        message: 'Test cleanup completed',
        deletedUsers: result.deletedCount
      });

    } catch (error) {
      console.error('Test cleanup error:', error);
      res.status(500).json({ error: 'Cleanup failed', details: error.message });
    }
  });
}

router.delete('/account', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      try {
        const User = require('../models/User'); // Adjust path

        const result = await User.findByIdAndDelete(decoded.userId);

        if (!result) {
          return res.status(404).json({ error: 'User not found' });
        }

        console.log(`User deleted: ${decoded.email}`);
        res.json({ message: 'Account deleted successfully' });

      } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
      }
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;