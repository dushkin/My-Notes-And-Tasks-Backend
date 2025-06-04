// routes/itemsRoutes.js
import express from 'express';
import { body, param, validationResult, check } from 'express-validator';
import {
  getNotesTree,
  createItem,
  updateItem,
  deleteItem,
  replaceUserTree,
  getItem,
} from '../controllers/itemsController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { createItemLimiter } from '../middleware/rateLimiterMiddleware.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import User from '../models/User.js';
import { findItemRecursive } from '../utils/backendTreeUtils.js';
import logger from '../config/logger.js';

const router = express.Router();

// Validation error handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((err) => err.msg);
    const flatErrorMessages = errorMessages.flat();
    logger.warn('Validation error in itemsRoutes', {
      errors: flatErrorMessages,
      path: req.path,
      userId: req.user?.id,
    });
    return next(new AppError(flatErrorMessages.join(', ') || 'Validation error', 400));
  }
  next();
};

router.use(authMiddleware);

// Validations
const itemValidations = [
  body('label')
    .trim()
    .notEmpty().withMessage('Label is required.')
    .isString().withMessage('Label must be a string.')
    .isLength({ min: 1, max: 255 }).withMessage('Label must be between 1 and 255 characters.'),
  body('type')
    .isIn(['folder', 'note', 'task']).withMessage('Invalid item type. Must be folder, note, or task.'),
  body('content')
    .optional()
    .isString().withMessage('Content must be a string.')
    .customSanitizer((value) => value),
  body('completed')
    .optional()
    .isBoolean().withMessage('Completed status must be a boolean.'),
];

const updateItemValidations = [
  body('label')
    .optional()
    .trim()
    .notEmpty().withMessage('Label cannot be empty if provided.')
    .isString().withMessage('Label must be a string.')
    .isLength({ min: 1, max: 255 }).withMessage('Label must be between 1 and 255 characters.'),
  body('content')
    .optional({ checkFalsy: false })
    .isString().withMessage('Content must be a string if provided.')
    .customSanitizer((value) => value),
  body('completed')
    .optional()
    .isBoolean().withMessage('Completed status must be a boolean if provided.'),
  check().custom((value, { req }) => {
    if (Object.keys(req.body).length === 0) {
      throw new Error(
        'No update data provided. At least one field (label, content, or completed) must be present for an update.'
      );
    }
    const allowedFields = ['label', 'content', 'completed', 'direction'];
    const unknownFields = Object.keys(req.body).filter((key) => !allowedFields.includes(key));
    if (unknownFields.length > 0) {
      throw new Error(`Unknown field(s) in update request: ${unknownFields.join(', ')}`);
    }
    return true;
  }),
];

const itemIdParamValidation = [
  param('itemId')
    .trim()
    .notEmpty().withMessage('Item ID path parameter is required.')
    .isString().withMessage('Item ID must be a string.'),
];

const parentIdParamValidation = [
  param('parentId')
    .trim()
    .notEmpty().withMessage('Parent ID path parameter is required.')
    .isString().withMessage('Parent ID must be a string.'),
];

/**
 * @openapi
 * /items/tree:
 *   get:
 *     tags: [Items]
 *     summary: Retrieve the full notes tree for the user
 *     description: Fetches the entire hierarchical structure of notes, folders, and tasks for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successfully retrieved the notes tree.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotesTreeGetResponse'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '404':
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/tree', getNotesTree);

/**
 * @openapi
 * /items/tree:
 *   put:
 *     tags: [Items]
 *     summary: Replace the entire notes tree for the user
 *     description: Replaces the user's current notes and tasks tree with the provided tree structure.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       description: An object containing the new tree structure.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newTree
 *             properties:
 *               newTree:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/Item'
 *     responses:
 *       '200':
 *         description: Tree replaced successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tree replaced successfully.
 *                 notesTree:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Item'
 *       '400':
 *         description: Invalid input.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '404':
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.put(
  '/tree',
  [
    body('newTree')
      .isArray().withMessage('Invalid tree data: newTree must be an array.')
      .custom((value) => {
        if (!Array.isArray(value)) return true;
        for (const item of value) {
          if (typeof item !== 'object' || item === null) {
            throw new Error('Each item in newTree must be an object.');
          }
          if (!item.hasOwnProperty('label') || typeof item.label !== 'string' || item.label.trim() === '') {
            throw new Error('Each item in newTree must have a non-empty label.');
          }
          if (!item.hasOwnProperty('type') || !['folder', 'note', 'task'].includes(item.type)) {
            throw new Error('Each item in newTree must have a valid type (folder, note, task).');
          }
        }
        return true;
      }),
  ],
  validate,
  replaceUserTree
);

/**
 * @openapi
 * /items:
 *   post:
 *     tags: [Items]
 *     summary: Create a new item at the root level
 *     description: Adds a new note, folder, or task to the top level of the user's tree.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       description: Data for the new item.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateItemInput'
 *     responses:
 *       '201':
 *         description: Item created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Item'
 *       '400':
 *         $ref: '#/components/responses/BadRequestError'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', createItemLimiter, ...itemValidations, validate, createItem);

/**
 * @openapi
 * /items/{parentId}:
 *   post:
 *     tags: [Items]
 *     summary: Create a new item as a child of a folder
 *     description: Adds a new note, folder, or task inside the specified parent folder.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: parentId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the parent folder.
 *         example: folder-123
 *     requestBody:
 *       required: true
 *       description: Data for the new item.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateItemInput'
 *     responses:
 *       '201':
 *         description: Item created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Item'
 *       '400':
 *         $ref: '#/components/responses/BadRequestError'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '404':
 *         $ref: '#/components/responses/NotFoundError'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:parentId', createItemLimiter, ...parentIdParamValidation, ...itemValidations, validate, createItem);

/**
 * @openapi
 * /items/{itemId}:
 *   get:
 *     tags: [Items]
 *     summary: Get a specific item by ID
 *     description: Retrieves a single item by its ID.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: itemId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the item to retrieve.
 *         example: note-456
 *     responses:
 *       '200':
 *         description: Item retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Item'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '404':
 *         $ref: '#/components/responses/NotFoundError'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:itemId', ...itemIdParamValidation, validate, getItem);

/**
 * @openapi
 * /items/{itemId}:
 *   patch:
 *     tags: [Items]
 *     summary: Update an existing item
 *     description: Partially updates an item's properties.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: itemId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the item to update.
 *         example: note-456
 *     requestBody:
 *       required: true
 *       description: Fields to update.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateItemInput'
 *     responses:
 *       '200':
 *         description: Item updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Item'
 *       '400':
 *         $ref: '#/components/responses/BadRequestError'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '404':
 *         $ref: '#/components/responses/NotFoundError'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/:itemId', ...itemIdParamValidation, ...updateItemValidations, validate, updateItem);

/**
 * @openapi
 * /items/{itemId}:
 *   delete:
 *     tags: [Items]
 *     summary: Delete an item
 *     description: Deletes an item (and all its children if it's a folder).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: itemId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the item to delete.
 *         example: folder-123
 *     responses:
 *       '200':
 *         description: Item deleted successfully or item not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Item deleted successfully.
 *       '400':
 *         description: Invalid Item ID format.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '404':
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:itemId', ...itemIdParamValidation, validate, deleteItem);

export default router;