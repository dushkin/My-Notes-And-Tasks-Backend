// middleware/rateLimiterMiddleware.js
import rateLimit from 'express-rate-limit'; // Changed from require

// General API rate limiter
export const generalLimiter = rateLimit({ // Added export
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: (req) => {
        return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    }
});

// Strict limiter for authentication endpoints
export const authLimiter = rateLimit({ // Added export
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 auth requests per windowMs (adjust as needed)
    message: {
        error: 'Too many authentication attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful auth attempts towards the limit
    keyGenerator: (req) => {
        return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    }
});

// Image upload limiter
export const uploadLimiter = rateLimit({ // Added export
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 uploads per windowMs (adjust as needed)
    message: {
        error: 'Too many upload attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    }
});

// Create item limiter
export const createItemLimiter = rateLimit({ // Added export
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // Limit each IP to 60 item creations per minute (adjust as needed)
    message: {
        error: 'Too many item creation attempts, please slow down.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    }
});
