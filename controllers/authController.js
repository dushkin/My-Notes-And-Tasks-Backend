const User = require('../models/User');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateAccessToken, generateRefreshToken, verifyToken } = require('../utils/jwt');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken

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
        // Note: refreshTokens array is initialized by the schema if not provided

        const accessToken = generateAccessToken(user.id);
        const refreshTokenString = generateRefreshToken(user.id); // This is the token string
        const decodedRefreshPayload = jwt.decode(refreshTokenString); // Decode to get payload

        if (!decodedRefreshPayload || !decodedRefreshPayload.jti || typeof decodedRefreshPayload.exp === 'undefined') {
            console.error('Failed to decode refresh token or extract jti/exp during registration for user:', user.id);
            throw new Error('Error generating refresh token details.');
        }

        const jti = decodedRefreshPayload.jti;
        const refreshTokenExpiresAt = new Date(decodedRefreshPayload.exp * 1000);

        user.refreshTokens.push({
            jti: jti,
            token: refreshTokenString,
            expiresAt: refreshTokenExpiresAt
        });
        await user.save();

        const userResponse = user.toJSON();

        res.status(201).json({ accessToken, refreshToken: refreshTokenString, user: userResponse });

    } catch (err) {
        console.error('Registration Error:', err.message, err.stack);
        if (err.name === 'ValidationError') {
            const messages = Object.values(err.errors).map(val => val.message);
            return res.status(400).json({ error: messages.join(', ') });
        }
        res.status(500).json({ error: 'Server error during registration' });
    }
};

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

        const accessToken = generateAccessToken(user.id);
        const refreshTokenString = generateRefreshToken(user.id);
        const decodedRefreshPayload = jwt.decode(refreshTokenString);

        if (!decodedRefreshPayload || !decodedRefreshPayload.jti || typeof decodedRefreshPayload.exp === 'undefined') {
            console.error('Failed to decode refresh token or extract jti/exp during login for user:', user.id);
            throw new Error('Error generating refresh token details.');
        }
        const jti = decodedRefreshPayload.jti;
        const refreshTokenExpiresAt = new Date(decodedRefreshPayload.exp * 1000);

        user.refreshTokens = user.refreshTokens.filter(rt => rt.expiresAt > new Date()); // Clean up expired
        user.refreshTokens.push({
            jti: jti,
            token: refreshTokenString,
            expiresAt: refreshTokenExpiresAt
        });
        await user.save();

        const userResponse = user.toJSON();

        res.status(200).json({ accessToken, refreshToken: refreshTokenString, user: userResponse });

    } catch (err) {
        console.error('Login Error:', err.message, err.stack);
        res.status(500).json({ error: 'Server error during login' });
    }
};

exports.refreshToken = async (req, res) => {
    const { token: providedRefreshTokenString } = req.body;

    if (!providedRefreshTokenString) {
        return res.status(401).json({ error: 'Refresh token is required.' });
    }

    try {
        const decodedPayload = verifyToken(providedRefreshTokenString);

        if (!decodedPayload || decodedPayload.type !== 'REFRESH_TOKEN' || !decodedPayload.jti) {
            return res.status(403).json({ error: 'Invalid refresh token structure or type.' });
        }

        const user = await User.findOne({
            _id: decodedPayload.user.id,
            'refreshTokens.jti': decodedPayload.jti,
        });

        if (!user) {
            return res.status(403).json({ error: 'Refresh token not found or revoked.' });
        }

        const tokenEntry = user.refreshTokens.find(rt => rt.jti === decodedPayload.jti);
        if (!tokenEntry || tokenEntry.expiresAt <= new Date()) {
            if (user && tokenEntry) { // Clean up if found but expired
                user.refreshTokens = user.refreshTokens.filter(rt => rt.jti !== decodedPayload.jti);
                await user.save();
            }
            return res.status(403).json({ error: 'Refresh token expired or invalid.' });
        }

        user.refreshTokens = user.refreshTokens.filter(rt => rt.jti !== decodedPayload.jti);

        const newAccessToken = generateAccessToken(user.id);
        const newRefreshTokenString = generateRefreshToken(user.id);
        const newDecodedRefreshPayload = jwt.decode(newRefreshTokenString);

        if (!newDecodedRefreshPayload || !newDecodedRefreshPayload.jti || typeof newDecodedRefreshPayload.exp === 'undefined') {
            console.error('Failed to decode new refresh token or extract jti/exp during refresh for user:', user.id);
            throw new Error('Error generating new refresh token details.');
        }

        const newJti = newDecodedRefreshPayload.jti;
        const newRefreshTokenExpiresAt = new Date(newDecodedRefreshPayload.exp * 1000);

        user.refreshTokens.push({
            jti: newJti,
            token: newRefreshTokenString,
            expiresAt: newRefreshTokenExpiresAt
        });
        await user.save();

        res.json({
            accessToken: newAccessToken,
            refreshToken: newRefreshTokenString
        });

    } catch (err) {
        console.error('Refresh Token Error:', err.message, err.stack);
        return res.status(500).json({ error: 'Server error during token refresh.' });
    }
};

exports.logout = async (req, res) => {
    const { refreshToken: providedRefreshTokenString } = req.body;

    if (!providedRefreshTokenString) {
        return res.status(400).json({ error: 'Refresh token is required for logout.' });
    }

    try {
        const decodedPayload = verifyToken(providedRefreshTokenString);

        if (decodedPayload && decodedPayload.user && decodedPayload.user.id && decodedPayload.jti) {
            const user = await User.findById(decodedPayload.user.id);
            if (user) {
                const initialTokenCount = user.refreshTokens.length;
                user.refreshTokens = user.refreshTokens.filter(rt => rt.jti !== decodedPayload.jti);
                if (user.refreshTokens.length < initialTokenCount) {
                    await user.save();
                }
            }
        }
        res.status(200).json({ message: 'Logged out successfully.' });
    } catch (error) {
        console.error('Logout error:', error.message, error.stack);
        res.status(500).json({ error: 'Server error during logout.' });
    }
};

exports.logoutAll = async (req, res) => {
    try {
        const userIdFromAccessToken = req.user.user.id;
        const user = await User.findById(userIdFromAccessToken);
        if (user) {
            user.refreshTokens = [];
            await user.save();
        }
        res.status(200).json({ message: 'Logged out from all devices successfully.' });
    } catch (error) {
        console.error('Logout All error:', error.message, error.stack);
        res.status(500).json({ error: 'Server error during logout from all devices.' });
    }
};