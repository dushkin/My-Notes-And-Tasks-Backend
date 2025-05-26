// routes/authRoutes.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { register, login } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
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

// Rate limiter for authentication routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'test' ? 1000 : 10,
    message: { error: 'Too many attempts from this IP, please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
});

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register a new user
 *     description: Creates a new user account with the provided email and password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: The user's email address.
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 description: The user's password (minimum 6 characters).
 *                 example: Password123
 *               name:
 *                 type: string
 *                 description: The user's name (optional).
 *                 example: John Doe
 *     responses:
 *       '201':
 *         description: User registered successfully. Returns the user details and authentication token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: The user's unique ID.
 *                       example: 507f1f77bcf86cd799439011
 *                     email:
 *                       type: string
 *                       example: user@example.com
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                 token:
 *                   type: string
 *                   description: JWT token for authentication.
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       '400':
 *         description: Bad request (e.g., invalid email, weak password, or user already exists).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '429':
 *         description: Too many requests (rate limit exceeded).
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
 *       - Authentication
 *     summary: Log in a user
 *     description: Authenticates a user with email and password, returning a JWT token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: The user's email address.
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 description: The user's password.
 *                 example: Password123
 *     responses:
 *       '200':
 *         description: User logged in successfully. Returns the user details and authentication token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: The user's unique ID.
 *                       example: 507f1f77bcf86cd799439011
 *                     email:
 *                       type: string
 *                       example: user@example.com
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                 token:
 *                   type: string
 *                   description: JWT token for authentication.
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       '400':
 *         description: Bad request (e.g., missing email or password).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Unauthorized - Invalid email or password.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Description of the error.
 *                   example: Invalid email or password
 *       '429':
 *         description: Too many requests (rate limit exceeded).
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

router.get('/verify-token', authMiddleware, (req, res) => {
    res.status(200).json({ valid: true, user: req.user });
});

module.exports = router;