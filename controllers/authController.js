// controllers/authController.js
import User from '../models/User.js'; // Assuming ESM
import { hashPassword, comparePassword } from '../utils/hash.js'; // Assuming ESM
import {
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken,
    revokeRefreshToken,
    revokeAllUserRefreshTokens
} from '../utils/jwt.js'; // Assuming ESM
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js'; // Assuming ESM
import logger from '../config/logger.js'; // Import logger

const getDeviceInfo = (req) => ({
    userAgent: req.get('User-Agent') || '',
    ip: req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || ''
});

// Wrap all async functions with catchAsync
export const login = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;
    const lowerEmail = email.toLowerCase();
    logger.info('Login attempt', { email: lowerEmail });

    const user = await User.findOne({ email: lowerEmail }).select('+password');
    if (!user) {
        logger.warn('Login failed: User not found', { email: lowerEmail });
        return next(new AppError('Invalid credentials', 401));
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
        logger.warn('Login failed: Invalid password', { email: lowerEmail, userId: user.id });
        return next(new AppError('Invalid credentials', 401));
    }

    const deviceInfo = getDeviceInfo(req);
    const accessToken = generateAccessToken(user.id);
    const refreshToken = await generateRefreshToken(user.id, deviceInfo);

    logger.info('Login successful', { email: lowerEmail, userId: user.id, ip: deviceInfo.ip, userAgent: deviceInfo.userAgent });
    const userResponse = await User.findById(user.id); // Fetch without password
    res.status(200).json({
        accessToken,
        refreshToken,
        user: userResponse
    });
});

export const register = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;
    const lowerEmail = email.toLowerCase();
    logger.info('Registration attempt', { email: lowerEmail });

    let user = await User.findOne({ email: lowerEmail });
    if (user) {
        logger.warn('Registration failed: User already exists', { email: lowerEmail });
        return next(new AppError('User already exists with this email', 400));
    }

    const hashedPassword = await hashPassword(password);
    user = new User({
        email: lowerEmail,
        password: hashedPassword,
    });

    await user.save();
    logger.info('User registered successfully', { email: lowerEmail, userId: user.id });

    const deviceInfo = getDeviceInfo(req);
    const accessToken = generateAccessToken(user.id);
    const refreshTokenString = await generateRefreshToken(user.id, deviceInfo);

    // Fetch user without password for the response
    const userResponse = await User.findById(user.id);

    res.status(201).json({
        accessToken,
        refreshToken: refreshTokenString,
        user: userResponse
    });
});

export const refreshToken = catchAsync(async (req, res, next) => {
    const { token } = req.body;
    logger.info('Refresh token attempt');

    if (!token) {
        logger.warn('Refresh token failed: Token required');
        return next(new AppError('Refresh token required', 401));
    }

    const refreshTokenDoc = await verifyRefreshToken(token);

    if (!refreshTokenDoc) {
        logger.warn('Refresh token failed: Invalid or expired', { providedToken: token.substring(0, 10) + "..." });
        return next(new AppError('Invalid or expired refresh token', 403));
    }

    const deviceInfo = getDeviceInfo(req);
    const newAccessToken = generateAccessToken(refreshTokenDoc.userId._id);
    const newRefreshTokenString = await generateRefreshToken(refreshTokenDoc.userId._id, deviceInfo);

    await revokeRefreshToken(token);
    logger.info('Refresh token successful', { userId: refreshTokenDoc.userId._id });

    res.status(200).json({
        accessToken: newAccessToken,
        refreshToken: newRefreshTokenString
    });
});

export const logout = catchAsync(async (req, res, next) => {
    const { refreshToken } = req.body;
    const userId = req.user?.id; // If user is authenticated and logging out current session
    logger.info('Logout attempt', { userId, hasRefreshToken: !!refreshToken });

    if (refreshToken) {
        await revokeRefreshToken(refreshToken);
        logger.info('Refresh token revoked upon logout', { userId, "revokedToken": refreshToken.substring(0,10)+"..."});
    } else {
        logger.info('Logout without refresh token revocation (e.g. access token expiry)', { userId });
    }

    res.status(200).json({ message: 'Logged out successfully' });
});

export const logoutAll = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    logger.info('Logout all devices attempt', { userId });
    const revokedCount = await revokeAllUserRefreshTokens(userId);

    logger.info('Logout from all devices successful', { userId, revokedTokens: revokedCount });
    res.status(200).json({
        message: 'Logged out from all devices successfully',
        revokedTokens: revokedCount
    });
});

export const verifyToken = catchAsync(async (req, res, next) => {
    // If middleware passed, token is valid
    logger.info('Token verified successfully (via verifyToken endpoint)', { userId: req.user.id });
    res.status(200).json({
        valid: true,
        user: req.user // req.user is already lean (toJSON was applied)
    });
});
