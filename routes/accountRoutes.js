import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import requireAuth from '../middleware/authMiddleware.js';
import User from '../models/User.js';
import RefreshToken from '../models/refreshToken.js';
import mongoose from 'mongoose';
import logger from '../config/logger.js';

const router = express.Router();
// Token configuration
const DELETION_TOKEN_SECRET = process.env.DELETION_TOKEN_SECRET || process.env.JWT_SECRET || 'fallback-secret-key';
const DELETION_TOKEN_EXPIRY = '1h'; // A short lifespan is good for single-action tokens

// Helper functions for token management
const generateToken = (userId) => {
  try {
    const payload = { userId, purpose: 'account_deletion', timestamp: Date.now(), nonce: crypto.randomBytes(16).toString('hex') };
    return jwt.sign(payload, DELETION_TOKEN_SECRET, { expiresIn: DELETION_TOKEN_EXPIRY, issuer: 'your-app-name', subject: userId.toString() });
  } catch (error) {
    logger.error('Error generating deletion token:', error);
    throw new Error('Failed to generate deletion token');
  }
};

const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, DELETION_TOKEN_SECRET);
    if (decoded.purpose !== 'account_deletion') throw new Error('Invalid token purpose');
    return decoded.userId;
  } catch (error) {
    logger.warn('Account deletion token verification failed', { error: error.message });
    throw error; // Re-throw to be caught by the route handler
  }
};

import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

const sendDeletionEmail = async (email, token) => {
  try {
    const confirmationUrl = `${process.env.BACKEND_URL || 'http://localhost:5001'}/api/account/delete-confirm/${token}`;
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: 'Confirm Permanent Account Deletion - ACTION REQUIRED',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Confirm Account Deletion</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px; border-left: 4px solid #dc2626;">
            <h1 style="color: #dc2626; margin-top: 0;">⚠️ Final Confirmation: Permanent Account Deletion</h1>
            <p>Hello,</p>
            <p>You have requested to permanently delete your account and all associated data. <strong>This action is irreversible.</strong></p>
            <div style="background-color: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
              <h3 style="margin-top: 0; color: #374151;">Clicking the button below will:</h3>
              <ul style="color: #6b7280;">
                <li>Immediately and permanently delete your account.</li>
                <li>Immediately and permanently delete all your notes, tasks, and folders.</li>
                <li><strong>There is no grace period and no way to undo this action through the app.</strong></li>
              </ul>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${confirmationUrl}" 
                 style="background-color: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                ✓ I Understand, Permanently Delete My Account
              </a>
            </div>
            <div style="background-color: #fef3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #f59e0b; margin: 20px 0;">
              <p style="margin: 0; color: #92400e;"><strong>Important:</strong> This link expires in 1 hour. If you did not request this, please ignore this email and change your password immediately.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    logger.info('Deletion confirmation email sent successfully', { to: email });
    return true;
  } catch (error) {
    logger.error('Resend API error:', { message: error.message });
    throw new Error('Failed to send confirmation email');
  }
};

// Export user data
router.get(
  '/export',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId).select('-password');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.setHeader('Content-Disposition', 'attachment; filename="export.json"');
      res.json({ user: user.toJSON(), notesTree: user.notesTree || [] });
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ message: 'Failed to export data' });
    }
  }
);

// This endpoint sends the deletion email
router.post(
  '/delete-request',
  requireAuth,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const token = generateToken(req.user.id);
      await sendDeletionEmail(user.email, token);
      
      res.json({ message: 'Confirmation email sent' });
    } catch (error) {
      next(error);
    }
  }
);

// This is the endpoint the user clicks in the email to confirm permanent deletion
router.get(
  '/delete-confirm/:token',
  async (req, res, next) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const session = await mongoose.startSession();
    
    try {
      const userId = verifyToken(req.params.token);
      
      session.startTransaction();
      
      const user = await User.findById(userId).session(session);
      // If user is already gone, it's still a "success" from the user's perspective
      if (!user) {
        await session.abortTransaction();
        return res.redirect(`${frontendUrl}/deletion-status?success=true`);
      }
      
      // Perform the permanent deletion
      await RefreshToken.deleteMany({ userId: userId }).session(session);
      await User.findByIdAndDelete(userId).session(session);
      
      await session.commitTransaction();
      
      logger.info('User account permanently deleted via confirmation link', { userId });
      return res.redirect(`${frontendUrl}/deletion-status?success=true`);
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error during /delete-confirm endpoint execution:', { message: error.message });
      return res.redirect(`${frontendUrl}/deletion-status?success=false&error=${encodeURIComponent(error.message)}`);
    } finally {
      session.endSession();
    }
  }
);

export default router;