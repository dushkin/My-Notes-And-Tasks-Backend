// utils/jwt.js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h'; // Default expiration

if (!JWT_SECRET) {
    throw new Error('FATAL ERROR: JWT_SECRET is not defined in environment variables.');
}

/**
 * Generates a JWT for a given user ID.
 * @param {string} userId - The MongoDB user ID (_id).
 * @returns {string} - The generated JSON Web Token.
 */
const generateToken = (userId) => {
    if (!userId) {
        throw new Error('User ID is required to generate a token.');
    }
    const payload = {
        user: {
            id: userId,
        },
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Verifies a JWT.
 * @param {string} token - The JWT to verify.
 * @returns {object | null} - The decoded payload if valid, otherwise null.
 */
const verifyToken = (token) => {
    if (!token) {
        return null;
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded;
    } catch (err) {
        console.error('JWT Verification Error:', err.message);
        return null;
    }
};

module.exports = {
    generateToken,
    verifyToken,
};