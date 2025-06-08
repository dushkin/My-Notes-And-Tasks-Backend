// src/routes/itemsRoutes.jsx
import express from 'express';
import { body, param, validationResult } from 'express-validator';
import {
  getNotesTree,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  replaceUserTree,
  moveItem,
} from '../controllers/itemsController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { createItemLimiter } from '../middleware/rateLimiterMiddleware.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import User from '../models/User.js';
import logger from '../config/logger.js';

const router = express.Router();

router.use(authMiddleware);

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msgs = errors.array().map(err => err.msg);
    logger.warn('Validation error in itemsRoutes', {
      errors: msgs,
      path: req.path,
      ip: req.ip,
      userId: req.user?.id,
    });
    return next(new AppError(msgs.join(', '), 400));
  }
  next();
};

// Get full notes tree
router.get('/', getNotesTree);

// Get a single item
router.get(
  '/:id',
  [
    param('id').isMongoId().withMessage('Invalid item ID'),
    validate,
  ],
  getItem
);

// Create a new item
router.post(
  '/',
  createItemLimiter,
  [
    body('label').notEmpty().withMessage('Label is required'),
    body('type')
      .isIn(['note', 'folder'])
      .withMessage('Type must be "note" or "folder"'),
    body('parentId').optional().isMongoId().withMessage('Invalid parent ID'),
    validate,
  ],
  createItem
);

// Update an item
router.patch(
  '/:id',
  [
    param('id').isMongoId().withMessage('Invalid item ID'),
    body('label').optional().isString(),
    body('content').optional().isString(),
    body('direction')
      .optional()
      .isIn(['ltr', 'rtl'])
      .withMessage('Direction must be "ltr" or "rtl"'),
    validate,
  ],
  updateItem
);

// Delete an item
router.delete(
  '/:id',
  [
    param('id').isMongoId().withMessage('Invalid item ID'),
    validate,
  ],
  deleteItem
);

// Test-only: clear entire tree
router.delete(
  '/',
  catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    logger.info(`[TEST-CLEANUP] DELETE / - clearing tree for user: ${userId}`);
    const user = await User.findById(userId);
    if (!user) {
      logger.warn(`[TEST-CLEANUP] User not found: ${userId}`);
      return next(new AppError('User not found', 404));
    }
    const countItemsRecursively = (items) => {
      if (!Array.isArray(items)) return 0;
      let count = items.length;
      for (const item of items) {
        if (item.children && Array.isArray(item.children)) {
          count += countItemsRecursively(item.children);
        }
      }
      return count;
    };
    const itemsDeleted = countItemsRecursively(user.notesTree || []);
    user.notesTree = [];
    await user.save();
    logger.info(`[TEST-CLEANUP] Tree cleared, removed ${itemsDeleted} items for user: ${userId}`);
    res.status(200).json({ status: 'success', deleted: itemsDeleted });
  })
);

// Replace entire tree
router.put(
  '/',
  [
    body('tree').isArray().withMessage('Tree must be an array'),
    validate,
  ],
  replaceUserTree
);

// Move an item
router.patch(
  '/:id/move',
  [
    param('id').isMongoId().withMessage('Invalid item ID'),
    body('newParentId').optional().isMongoId().withMessage('Invalid parent ID'),
    body('newIndex')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Index must be a non-negative integer'),
    validate,
  ],
  moveItem
);

export default router;
