// utils/jwt.js
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import RefreshToken from '../models/refreshToken.js';
import logger from '../config/logger.js';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
    const jwtSecretErrorMsg = 'FATAL ERROR: JWT_SECRET is not defined in environment variables.';
    logger.error(jwtSecretErrorMsg); // Log before throwing
    throw new Error(jwtSecretErrorMsg);
}

export const generateAccessToken = (userId) => {
    if (!userId) {
        logger.error('Attempted to generate access token without userId');
        throw new Error('User ID is required to generate an access token.');
    }
    const payload = {
        user: {
            id: userId,
        },
        type: 'access' // Differentiate token types
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const generateRefreshToken = async (userId, deviceInfo = {}) => {
    if (!userId) {
        logger.error('Attempted to generate refresh token without userId');
        throw new Error('User ID is required to generate a refresh token.');
    }

    const token = crypto.randomBytes(64).toString('hex');

    const expiresAt = new Date();
    const daysToAdd = parseInt(REFRESH_TOKEN_EXPIRES_IN.replace('d', '')) || 7;
    expiresAt.setDate(expiresAt.getDate() + daysToAdd);

    const refreshTokenDoc = new RefreshToken({ // Renamed variable to avoid conflict
        token,
        userId,
        expiresAt,
        deviceInfo: {
            userAgent: deviceInfo.userAgent || 'N/A', // Provide default if undefined
            ip: deviceInfo.ip || 'N/A' // Provide default if undefined
        }
    });
    await refreshTokenDoc.save();
    logger.debug('Refresh token generated and saved', { userId, tokenId: refreshTokenDoc._id });
    return token;
};

export const verifyAccessToken = (token) => {
    if (!token) {
        return null;
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Verify it's an access token if you add type to payload
        if (decoded.type !== 'access') {
            logger.warn('Invalid token type during access token verification', { decodedType: decoded.type });
            return null;
        }
        return decoded;
    } catch (err) {
        // Log specific JWT errors, but re-throw them for authMiddleware to handle
        logger.warn('Access JWT Verification Error', { message: err.message, name: err.name, tokenFirstChars: token.substring(0,10) + "..."});
        if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
            throw err;
        }
        return null; // For other unexpected errors (though less likely with jwt.verify)
    }
};

export const verifyRefreshToken = async (token) => {
    if (!token) {
        return null;
    }
    try {
        const refreshTokenDoc = await RefreshToken.findOne({ // Renamed variable
            token,
            isRevoked: false,
            expiresAt: { $gt: new Date() }
        }).populate('userId', 'email'); // Populate user email for logging if needed

        if (!refreshTokenDoc) {
            logger.warn('Refresh token not found, revoked, or expired in DB', { providedTokenFirstChars: token.substring(0,10) + "..."});
            return null;
        }

        refreshTokenDoc.lastUsed = new Date();
        await refreshTokenDoc.save();
        logger.debug('Refresh token verified and lastUsed updated', { userId: refreshTokenDoc.userId?._id, email: refreshTokenDoc.userId?.email });
        return refreshTokenDoc; // Return the document
    } catch (err) {
        logger.error('Refresh Token Database Verification Error', { message: err.message, stack: err.stack });
        return null;
    }
};

export const revokeRefreshToken = async (token) => {
    try {
        const result = await RefreshToken.updateOne(
            { token },
            { $set: { isRevoked: true } } // Use $set for clarity
        );
        logger.debug('Refresh token revocation attempt', { tokenFirstChars: token.substring(0,10) + "...", modifiedCount: result.modifiedCount });
        return result.modifiedCount > 0;
    } catch (err) {
        logger.error('Refresh Token Revocation Database Error', { message: err.message, stack: err.stack });
        return false;
    }
};

export const revokeAllUserRefreshTokens = async (userId) => {
    try {
        const result = await RefreshToken.updateMany(
            { userId, isRevoked: false },
            { $set: { isRevoked: true } } // Use $set
        );
        logger.info('Bulk refresh token revocation for user', { userId, revokedCount: result.modifiedCount });
        return result.modifiedCount;
    } catch (err) {
        logger.error('Bulk Refresh Token Revocation Database Error', { userId, message: err.message, stack: err.stack });
        return 0;
    }
};

export const cleanupExpiredTokens = async () => {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const result = await RefreshToken.deleteMany({
            $or: [
                { expiresAt: { $lt: new Date() } },
                { isRevoked: true, lastUsed: { $lt: thirtyDaysAgo } }
            ]
        });
        if (result.deletedCount > 0) {
         logger.info('Expired/old-revoked refresh tokens cleaned up', { count: result.deletedCount });
        }
        return result.deletedCount;
    } catch (err) {
        logger.error('Token Cleanup Database Error:', { message: err.message, stack: err.stack });
        return 0;
    }
};

// Aliases for potential backward compatibility or simpler naming if preferred elsewhere
export const generateToken = generateAccessToken;
export const verifyToken = verifyAccessToken;