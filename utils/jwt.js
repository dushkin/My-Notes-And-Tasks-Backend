const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid'); // For JTI in refresh token

const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '1h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d'; // Example: 7 days for refresh token

const generateAccessToken = (userId) => {
    if (!userId) {
        throw new Error('User ID is required to generate an access token.');
    }
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not defined in environment variables.');
    }
    const payload = {
        user: {
            id: userId,
        },
        type: 'ACCESS_TOKEN'
    };
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRES_IN });
};

const generateRefreshToken = (userId) => {
    if (!userId) {
        throw new Error('User ID is required to generate a refresh token.');
    }
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not defined in environment variables.');
    }
    const payload = {
        user: {
            id: userId,
        },
        jti: uuidv4(), // Unique ID for this refresh token instance
        type: 'REFRESH_TOKEN'
    };
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
};

const verifyToken = (token) => {
    if (!token) {
        return null;
    }
    if (!process.env.JWT_SECRET) {
        console.error('JWT_SECRET is not defined in environment variables for verification.');
        return null;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded;
    } catch (err) {
        // console.error('JWT Verification Error:', err.message); // Keep console clean for tests
        return null;
    }
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyToken,
    JWT_REFRESH_EXPIRES_IN // Exporting for cookie maxAge calculation
};