// middleware/authMiddleware.js
const { verifyAccessToken } = require('../utils/jwt');
const { AppError } = require('./errorHandlerMiddleware');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
    console.log('authMiddleware: Processing request for', req.path);
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            console.log('authMiddleware: No Authorization header');
            return next(new AppError('No token provided', 401));
        }

        const token = authHeader.replace('Bearer ', '');
        console.log('authMiddleware: Token extracted:', token);

        const decoded = verifyAccessToken(token);
        console.log('authMiddleware: Decoded JWT:', decoded);

        if (!decoded || !decoded.user || !decoded.user.id) {
            console.log('authMiddleware: Invalid decoded payload');
            return next(new AppError('Not authorized, token failed', 401));
        }

        const user = await User.findById(decoded.user.id);
        if (!user) {
            console.log('authMiddleware: User not found');
            return next(new AppError('Not authorized, user not found', 401));
        }

        req.user = user;
        console.log('authMiddleware: User attached:', user.email);
        next();
    } catch (err) {
        console.error('authMiddleware: Error:', err.message);

        // Handle specific JWT errors
        if (err.name === 'JsonWebTokenError') {
            return next(new AppError('Invalid token', 401));
        }
        if (err.name === 'TokenExpiredError') {
            return next(new AppError('Token expired', 401));
        }

        // Generic auth error
        return next(new AppError('Not authorized, token failed', 401));
    }
};

module.exports = authMiddleware;