// routes/authRoutes.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { register, login } = require('../controllers/authController');
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
 * post:
 * tags:
 * - Auth
 * summary: Register a new user
 * description: Creates a new user account with the provided email and password.
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/UserInput'
 * responses:
 * '201':
 * description: User registered successfully. Returns JWT token and user object.
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/AuthResponse'
 * '400':
 * description: Invalid input (e.g., missing fields, invalid email, weak password, email already exists).
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/ErrorResponse'
 * '500':
 * description: Server error during registration.
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/register',
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
 * post:
 * tags:
 * - Auth
 * summary: Login a user
 * description: Authenticates a user with email and password, returning a JWT token upon success.
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/UserInput'
 * responses:
 * '200':
 * description: Login successful. Returns JWT token and user object.
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/AuthResponse'
 * '400':
 * description: Bad Request - Invalid email format or missing password.
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/ErrorResponse'
 * '401':
 * description: Unauthorized - Invalid credentials.
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/ErrorResponse'
 * '500':
 * description: Server error during login.
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login',
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

module.exports = router;