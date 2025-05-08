// middleware/authMiddleware.js
const { verifyToken } = require('../utils/jwt');
const User = require('../models/User'); // Assuming your user model is here

const authMiddleware = async (req, res, next) => {
    let token;

    // Check for token in Authorization header (Bearer <token>)
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            // Extract token from header
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            const decoded = verifyToken(token); // verifyToken should return payload or null

            if (!decoded || !decoded.user || !decoded.user.id) {
                return res.status(401).json({ error: 'Not authorized, token failed' });
            }

            // Find user by ID from token payload and attach to request (excluding password)
            // Note: Selecting '-password' explicitly excludes the password field
            req.user = await User.findById(decoded.user.id).select('-password');

            if (!req.user) {
                // Handle case where user might have been deleted after token was issued
                return res.status(401).json({ error: 'Not authorized, user not found' });
            }

            next(); // Proceed to the next middleware or route handler
        } catch (error) {
            console.error('Authentication Error:', error.message);
            return res.status(401).json({ error: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        return res.status(401).json({ error: 'Not authorized, no token' });
    }
};

module.exports = authMiddleware;