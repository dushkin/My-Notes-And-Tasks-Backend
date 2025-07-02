import User from '../models/User.js';
import { hashPassword, comparePassword } from '../utils/hash.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens
} from '../utils/jwt.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import logger from '../config/logger.js';
import { getDeviceInfo } from '../utils/device.js';

export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  const lowerEmail = email.toLowerCase();
  logger.info('Login attempt', { email: lowerEmail });

  const user = await User.findOne({ email: lowerEmail }).select('+password');
  if (!user) return next(new AppError('Invalid credentials', 401));

  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) return next(new AppError('Invalid credentials', 401));

  const deviceInfo = getDeviceInfo(req);
  const accessToken = generateAccessToken(user.id);
  const refreshToken = await generateRefreshToken(user.id, deviceInfo);

  // Set HTTP-only secure cookie for refresh token
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'None',
  });

  logger.info('Login successful', { userId: user.id });
  const userResponse = await User.findById(user.id);
  res.status(200).json({ accessToken, refreshToken, user: userResponse });
});

export const register = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new AppError('Email and password are required', 400));
  }
  const lowerEmail = email.toLowerCase();

  // Check if user already exists
  const existingUser = await User.findOne({ email: lowerEmail });
  if (existingUser) {
    return next(new AppError('Email already in use', 409));
  }

  // Hash the password and create the user
  const hashedPassword = await hashPassword(password);
  const newUser = await User.create({
    email: lowerEmail,
    password: hashedPassword,
  });

  const deviceInfo = getDeviceInfo(req);
  const accessToken = generateAccessToken(newUser.id);
  const refreshToken = await generateRefreshToken(newUser.id, deviceInfo);

  // Set HTTP-only secure cookie for refresh token
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'None',
  });

  logger.info('Registration successful', { userId: newUser.id });
  const userResponse = await User.findById(newUser.id);
  res.status(201).json({ accessToken, refreshToken, user: userResponse });
});

export const refreshToken = catchAsync(async (req, res, next) => {
  const { token } = req.body;
  if (!token) return next(new AppError('Refresh token required', 401));

  const refreshTokenDoc = await verifyRefreshToken(token);
  if (!refreshTokenDoc) return next(new AppError('Invalid or expired refresh token', 403));

  const deviceInfo = getDeviceInfo(req);
  const newAccessToken = generateAccessToken(refreshTokenDoc.userId._id);
  const newRefreshTokenString = await generateRefreshToken(refreshTokenDoc.userId._id, deviceInfo);

  await revokeRefreshToken(token);

  // Set HTTP-only secure cookie for new refresh token
  res.cookie('refreshToken', newRefreshTokenString, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'None',
  });

  logger.info('Refresh token successful', { userId: refreshTokenDoc.userId._id });
  res.status(200).json({ accessToken: newAccessToken, refreshToken: newRefreshTokenString });
});

export const logout = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;
  const userId = req.user?.id;
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
    logger.info('Refresh token revoked upon logout', { userId });
  }

  // Clear the HTTP-only refreshToken cookie
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'None',
  });

  res.status(200).json({ message: 'Logged out successfully' });
});

export const logoutAll = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const revokedCount = await revokeAllUserRefreshTokens(userId);
  logger.info('Logout all devices', { userId, revokedCount });
  res.status(200).json({ message: 'Logged out from all devices successfully', revokedTokens: revokedCount });
});

export const verifyToken = catchAsync(async (req, res, next) => {
  logger.info('Token verified successfully', { userId: req.user.id });
  res.status(200).json({ valid: true, user: req.user });
});
