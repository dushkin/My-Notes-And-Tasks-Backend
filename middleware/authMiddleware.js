import { verifyAccessToken } from '../utils/jwt.js';
import { AppError } from './errorHandlerMiddleware.js';
import User from '../models/User.js';
import logger from '../config/logger.js';

const authMiddleware = async (req, res, next) => {
    
    console.log('🔍 AUTH MIDDLEWARE CALLED FOR:', req.method, req.path, req.originalUrl);
    
    // Allow unauthenticated access to specific endpoints
    const publicPaths = [
        '/api/auth/beta-status',
        '/auth/beta-status',  // Also check without /api prefix
        '/api/push/vapid-public-key',
        '/push/vapid-public-key'
    ];
    
    const isPublicPath = publicPaths.some(path => req.path === path || req.originalUrl === path);
    
    if (isPublicPath) {
        logger.debug('authMiddleware: Allowing public access to:', { path: req.path, originalUrl: req.originalUrl });
        return next();
    }

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

        // Enhanced user object attachment for PWA sync
        req.user = user;
        
        // Extract device ID from headers for sync tracking
        const deviceId = req.header('X-Device-ID') || req.header('Device-ID');
        if (deviceId) {
            req.deviceId = deviceId;
            logger.debug('authMiddleware: Device ID extracted', { 
                userId: user.id, 
                deviceId: deviceId.substring(0, 10) + "...",
                path: req.path 
            });
        }

        // Update user activity for PWA sync (non-blocking)
        setImmediate(async () => {
            try {
                const shouldUpdateActivity = 
                    req.path.startsWith('/api/sync/') ||
                    req.path.startsWith('/api/push/') ||
                    deviceId ||
                    Math.random() < 0.1; // 10% of requests

                if (shouldUpdateActivity) {
                    await user.recordLogin(deviceId);
                    logger.debug('authMiddleware: User activity updated', { 
                        userId: user.id, 
                        deviceId,
                        path: req.path 
                    });
                }
            } catch (error) {
                logger.debug('authMiddleware: Failed to update user activity', { 
                    userId: user.id, 
                    error: error.message 
                });
            }
        });

        logger.debug('authMiddleware: User authenticated successfully', { 
            userId: user.id, 
            email: user.email, 
            deviceId,
            path: req.path 
        });
        next();
    } catch (err) {
        logger.error('authMiddleware: Error during token verification', { 
            message: err.message, 
            name: err.name, 
            path: req.path, 
            ip: req.ip 
        });
        if (err.name === 'JsonWebTokenError') {
            return next(new AppError('Invalid token', 401));
        }
        if (err.name === 'TokenExpiredError') {
            return next(new AppError('Token expired', 401));
        }
        return next(new AppError('Not authorized, token processing failed', 401));
    }
};

export default authMiddleware;