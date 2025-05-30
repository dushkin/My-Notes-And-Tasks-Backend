const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
    throw new Error('FATAL ERROR: JWT_SECRET is not defined in environment variables.');
}

const generateAccessToken = (userId) => {
    if (!userId) {
        throw new Error('User ID is required to generate a token.');
    }
    const payload = {
        user: {
            id: userId,
        },
        type: 'access'
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const generateRefreshToken = async (userId, deviceInfo = {}) => {
    if (!userId) {
        throw new Error('User ID is required to generate a refresh token.');
    }

    const token = crypto.randomBytes(64).toString('hex');

    const expiresAt = new Date();
    const daysToAdd = parseInt(REFRESH_TOKEN_EXPIRES_IN.replace('d', '')) || 7;
    expiresAt.setDate(expiresAt.getDate() + daysToAdd);

    const refreshToken = new RefreshToken({
        token,
        userId,
        expiresAt,
        deviceInfo: {
            userAgent: deviceInfo.userAgent || '',
            ip: deviceInfo.ip || ''
        }
    });

    await refreshToken.save();
    return token;
};

const verifyAccessToken = (token) => {
    if (!token) {
        return null;
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'access') {
            return null;
        }
        return decoded;
    } catch (err) {
        console.error('JWT Verification Error:', err.message);
        return null;
    }
};

const verifyRefreshToken = async (token) => {
    if (!token) {
        return null;
    }

    try {
        const refreshToken = await RefreshToken.findOne({
            token,
            isRevoked: false,
            expiresAt: { $gt: new Date() }
        }).populate('userId');

        if (!refreshToken) {
            return null;
        }

        refreshToken.lastUsed = new Date();
        await refreshToken.save();

        return refreshToken;
    } catch (err) {
        console.error('Refresh Token Verification Error:', err.message);
        return null;
    }
};

const revokeRefreshToken = async (token) => {
    try {
        const result = await RefreshToken.updateOne(
            { token },
            { isRevoked: true }
        );
        return result.modifiedCount > 0;
    } catch (err) {
        console.error('Refresh Token Revocation Error:', err.message);
        return false;
    }
};

const revokeAllUserRefreshTokens = async (userId) => {
    try {
        const result = await RefreshToken.updateMany(
            { userId, isRevoked: false },
            { isRevoked: true }
        );
        return result.modifiedCount;
    } catch (err) {
        console.error('Bulk Refresh Token Revocation Error:', err.message);
        return 0;
    }
};

const cleanupExpiredTokens = async () => {
    try {
        const result = await RefreshToken.deleteMany({
            $or: [
                { expiresAt: { $lt: new Date() } },
                { isRevoked: true, lastUsed: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
            ]
        });
        return result.deletedCount;
    } catch (err) {
        console.error('Token Cleanup Error:', err.message);
        return 0;
    }
};

const generateToken = generateAccessToken;
const verifyToken = verifyAccessToken;

module.exports = {
    generateToken,
    verifyToken,
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    revokeRefreshToken,
    revokeAllUserRefreshTokens,
    cleanupExpiredTokens
};