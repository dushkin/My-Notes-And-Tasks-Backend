// controllers/authController.js
const User = require('../models/User');
const { hashPassword, comparePassword } = require('../utils/hash');
const { 
    generateAccessToken, 
    generateRefreshToken, 
    verifyRefreshToken, 
    revokeRefreshToken,
    revokeAllUserRefreshTokens 
} = require('../utils/jwt');

const getDeviceInfo = (req) => ({
    userAgent: req.get('User-Agent') || '',
    ip: req.ip || req.connection.remoteAddress || req.socket.remoteAddress || ''
});

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate tokens
        const accessToken = generateAccessToken(user.id);
        const refreshToken = await generateRefreshToken(user.id, getDeviceInfo(req));
        
        // Send Response with both accessToken and refreshToken
        const userResponse = await User.findById(user.id);
        res.status(200).json({ 
            accessToken,
            refreshToken,
            user: userResponse 
        });

    } catch (err) {
        console.error('Login Error:', err.message);
        res.status(500).json({ error: 'Server error during login' });
    }
};

exports.register = async (req, res) => {
    const { email, password } = req.body;

    try {
        let user = await User.findOne({ email: email.toLowerCase() });
        if (user) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        const hashedPassword = await hashPassword(password);
        user = new User({
            email: email.toLowerCase(),
            password: hashedPassword,
        });
        await user.save();

        // Generate tokens
        const accessToken = generateAccessToken(user.id);
        const refreshToken = await generateRefreshToken(user.id, getDeviceInfo(req));

        // Send Response with both accessToken and refreshToken
        res.status(201).json({ 
            accessToken,
            refreshToken,
            user 
        });
    } catch (err) {
        console.error('Registration Error:', err.message);
        if (err.name === 'ValidationError') {
            const messages = Object.values(err.errors).map(val => val.message);
            return res.status(400).json({ error: messages.join(', ') });
        }
        res.status(500).json({ error: 'Server error during registration' });
    }
};

exports.refreshToken = async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(401).json({ error: 'Refresh token required' });
    }

    try {
        const refreshTokenDoc = await verifyRefreshToken(token);
        
        if (!refreshTokenDoc) {
            return res.status(403).json({ error: 'Invalid or expired refresh token' });
        }

        // Generate new tokens
        const newAccessToken = generateAccessToken(refreshTokenDoc.userId._id);
        const newRefreshToken = await generateRefreshToken(refreshTokenDoc.userId._id, getDeviceInfo(req));

        // Revoke the old refresh token
        await revokeRefreshToken(token);

        res.status(200).json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken
        });

    } catch (err) {
        console.error('Refresh Token Error:', err.message);
        res.status(500).json({ error: 'Server error during token refresh' });
    }
};

exports.logout = async (req, res) => {
    const { refreshToken } = req.body;

    try {
        if (refreshToken) {
            await revokeRefreshToken(refreshToken);
        }

        res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
        console.error('Logout Error:', err.message);
        res.status(500).json({ error: 'Server error during logout' });
    }
};

exports.logoutAll = async (req, res) => {
    try {
        const revokedCount = await revokeAllUserRefreshTokens(req.user.id);
        
        res.status(200).json({ 
            message: 'Logged out from all devices successfully',
            revokedTokens: revokedCount
        });
    } catch (err) {
        console.error('Logout All Error:', err.message);
        res.status(500).json({ error: 'Server error during logout from all devices' });
    }
};

exports.verifyToken = async (req, res) => {
    try {
        // If we reach here, the auth middleware has already verified the token
        res.status(200).json({ 
            valid: true, 
            user: req.user 
        });
    } catch (err) {
        console.error('Verify Token Error:', err.message);
        res.status(500).json({ error: 'Server error during token verification' });
    }
};