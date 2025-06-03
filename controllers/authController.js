// controllers/authController.js - Example of how to update controllers
const User = require('../models/User');
const { hashPassword, comparePassword } = require('../utils/hash');
const { 
    generateAccessToken, 
    generateRefreshToken, 
    verifyRefreshToken, 
    revokeRefreshToken,
    revokeAllUserRefreshTokens 
} = require('../utils/jwt');
const { catchAsync, AppError } = require('../middleware/errorHandlerMiddleware');

const getDeviceInfo = (req) => ({
    userAgent: req.get('User-Agent') || '',
    ip: req.ip || req.connection.remoteAddress || req.socket.remoteAddress || ''
});

// Wrap all async functions with catchAsync
exports.login = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    // Validation errors will be caught by express-validator
    
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
        // Use AppError for consistent error handling
        return next(new AppError('Invalid credentials', 401));
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
        return next(new AppError('Invalid credentials', 401));
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id, getDeviceInfo(req));
    
    // Send Response
    const userResponse = await User.findById(user.id);
    res.status(200).json({ 
        accessToken,
        refreshToken,
        user: userResponse 
    });
});

exports.register = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
        return next(new AppError('User already exists with this email', 400));
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

    res.status(201).json({ 
        accessToken,
        refreshToken,
        user 
    });
});

exports.refreshToken = catchAsync(async (req, res, next) => {
    const { token } = req.body;

    if (!token) {
        return next(new AppError('Refresh token required', 401));
    }

    const refreshTokenDoc = await verifyRefreshToken(token);
    
    if (!refreshTokenDoc) {
        return next(new AppError('Invalid or expired refresh token', 403));
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
});

exports.logout = catchAsync(async (req, res, next) => {
    const { refreshToken } = req.body;

    if (refreshToken) {
        await revokeRefreshToken(refreshToken);
    }

    res.status(200).json({ message: 'Logged out successfully' });
});

exports.logoutAll = catchAsync(async (req, res, next) => {
    const revokedCount = await revokeAllUserRefreshTokens(req.user.id);
    
    res.status(200).json({ 
        message: 'Logged out from all devices successfully',
        revokedTokens: revokedCount
    });
});

exports.verifyToken = catchAsync(async (req, res, next) => {
    // If we reach here, the auth middleware has already verified the token
    res.status(200).json({ 
        valid: true, 
        user: req.user 
    });
});