// middleware/authMiddleware.js
import { verifyAccessToken } from '../utils/jwt.js'; // Assuming ESM
import { AppError } from './errorHandlerMiddleware.js'; // Assuming ESM
import User from '../models/User.js'; // Assuming ESM
import logger from '../config/logger.js'; // Import logger

const authMiddleware = async (req, res, next) => {
    logger.debug('authMiddleware: Processing request', { path: req.path });
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            logger.warn('authMiddleware: No Authorization header', { path: req.path, ip: req.ip });
            return next(new AppError('No token provided', 401));
        }

        const token = authHeader.replace('Bearer ', '');
        logger.debug('authMiddleware: Token extracted', { tokenFirstChars: token.substring(0, 10) + "..." });

        const decoded = verifyAccessToken(token);
        logger.debug('authMiddleware: Decoded JWT', { decoded });

        if (!decoded || !decoded.user || !decoded.user.id) {
            logger.warn('authMiddleware: Invalid decoded payload', { decoded, path: req.path, ip: req.ip });
            return next(new AppError('Not authorized, token failed', 401));
        }

        const user = await User.findById(decoded.user.id);
        if (!user) {
            logger.warn('authMiddleware: User not found in DB', { userId: decoded.user.id, path: req.path, ip: req.ip });
            return next(new AppError('Not authorized, user not found', 401));
        }

        req.user = user; // User object (with toJSON applied by model) is attached
        logger.debug('authMiddleware: User attached to request', { userId: user.id, email: user.email, path: req.path });
        next();
    } catch (err) {
        logger.error('authMiddleware: Error during token verification', { message: err.message, name: err.name, path: req.path, ip: req.ip });
        if (err.name === 'JsonWebTokenError') {
            return next(new AppError('Invalid token', 401));
        }
        if (err.name === 'TokenExpiredError') {
            return next(new AppError('Token expired', 401));
        }
        return next(new AppError('Not authorized, token processing failed', 401));
    }
};

export default authMiddleware; // Assuming ESM