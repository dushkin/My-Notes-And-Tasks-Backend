// src/routes/itemsRoutes.js
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
import { validateItemNameMiddleware } from '../utils/itemNameValidation.js'; // Add this import
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
  '/:itemId',
  [
    param('itemId').isString().withMessage('Item ID must be a string.'),
    validate,
  ],
  getItem
);

// Create a new root-level item
router.post(
  '/',
  createItemLimiter,
  [
    body('label')
      .notEmpty()
      .withMessage('Label is required')
      .trim()
      .isLength({ max: 255 })
      .withMessage('Label cannot exceed 255 characters'),
    body('type')
      .isIn(['note', 'folder', 'task'])
      .withMessage('Type must be "note", "folder", or "task"'),
    validate,
  ],
  validateItemNameMiddleware, // Add validation middleware here
  createItem
);

// Create a child item under a specific parent
router.post(
  '/:parentId',
  createItemLimiter,
  [
    param('parentId').isString().notEmpty().withMessage('Parent ID must be a non-empty string.'),
    body('label')
      .notEmpty()
      .withMessage('Label is required')
      .trim()
      .isLength({ max: 255 })
      .withMessage('Label cannot exceed 255 characters'),
    body('type')
      .isIn(['note', 'folder', 'task'])
      .withMessage('Type must be "note", "folder", or "task"'),
    validate,
  ],
  validateItemNameMiddleware, // Add validation middleware here
  createItem
);

// Update an item
router.patch(
  '/:itemId',
  [
    param('itemId').isString().withMessage('Item ID must be a string.'),
    body('label')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Label cannot exceed 255 characters'),
    body('content').optional().isString(),
    body('completed').optional().isBoolean(),
    body('direction')
      .optional()
      .isIn(['ltr', 'rtl'])
      .withMessage('Direction must be "ltr" or "rtl"'),
    validate,
  ],
  validateItemNameMiddleware, // Add validation middleware here
  updateItem
);

// Delete an item
router.delete(
  '/:itemId',
  [
    param('itemId').isString().notEmpty().withMessage('Invalid item ID format.'),
    validate,
  ],
  deleteItem
);

// Test-only: clear entire tree
if (process.env.NODE_ENV !== 'production') {
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
        user.markModified('notesTree');
        await user.save();
        logger.info(`[TEST-CLEANUP] Tree cleared, removed ${itemsDeleted} items for user: ${userId}`);
        res.status(200).json({ status: 'success', deleted: itemsDeleted });
    })
    );
}

// Replace entire tree
router.put(
  '/tree',
  [
    body('newTree').isArray().withMessage('newTree must be an array'),
    validate,
  ],
  replaceUserTree
);

// Move an item
router.patch(
  '/:itemId/move',
  [
    param('itemId').isString().notEmpty().withMessage('Item ID must be a non-empty string.'),
    body('newParentId').optional({ checkFalsy: true }).isString().withMessage('Invalid newParentId format.'),
    body('newIndex')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Index must be a non-negative integer'),
    validate,
  ],
  moveItem
);

export default router;