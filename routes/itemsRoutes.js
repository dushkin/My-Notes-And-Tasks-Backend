// routes/itemsRoutes.js
const express = require('express');
const { body, param, validationResult, check } = require('express-validator');
const {
    getNotesTree,
    createItem,
    updateItem,
    deleteItem,
    replaceUserTree,
} = require('../controllers/itemsController');
const authMiddleware = require('../middleware/authMiddleware');
const { createItemLimiter } = require('../middleware/rateLimiterMiddleware');
const { catchAsync, AppError } = require('../middleware/errorHandlerMiddleware');

const router = express.Router();

// Middleware to handle validation errors
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Simplified error message: just the msg from express-validator
        const errorMessages = errors.array().map(err => err.msg);

        // The rest of the function remains the same for joining messages
        let flatErrorMessages = [];
        errorMessages.forEach(msg => {
            if (Array.isArray(msg)) {
                flatErrorMessages = flatErrorMessages.concat(msg);
            } else {
                flatErrorMessages.push(msg);
            }
        });
        return next(new AppError(flatErrorMessages.join(', ') || 'Validation error', 400));
    }
    next();
};

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Validation rules for creating items
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
        .customSanitizer(value => {
            // Don't escape HTML - return the content as-is
            return value;
        }),
    body('completed')
        .optional()
        .isBoolean().withMessage('Completed status must be a boolean.'),
];

// Validation rules for updating items
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
        .customSanitizer(value => {
            // Don't escape HTML - return the content as-is
            return value;
        }),
    body('completed')
        .optional()
        .isBoolean().withMessage('Completed status must be a boolean if provided.'),
    check().custom((value, { req }) => {
        if (Object.keys(req.body).length === 0) {
            throw new Error('No update data provided. At least one field (label, content, or completed) must be present for an update.');
        }
        const allowedFields = ['label', 'content', 'completed', 'direction'];
        const unknownFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
        if (unknownFields.length > 0) {
            throw new Error(`Unknown field(s) in update request: ${unknownFields.join(', ')}`);
        }
        return true;
    }),
];

// Validation for itemId parameter
const itemIdParamValidation = [
    param('itemId')
        .trim()
        .notEmpty().withMessage('Item ID path parameter is required.')
        .isString().withMessage('Item ID must be a string.'),
];

// Validation for parentId parameter
const parentIdParamValidation = [
    param('parentId')
        .trim()
        .notEmpty().withMessage('Parent ID path parameter is required.')
        .isString().withMessage('Parent ID must be a string.'),
];

// ... rest of your routes remain the same

/**
 * @openapi
 * /items/tree:
 *   get:
 *     tags:
 *       - Items
 *     summary: Retrieve the full notes tree for the user
 *     description: Fetches the entire hierarchical structure of notes, folders, and tasks.
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
 *         $ref: '#/components/responses/NotFoundError'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/tree', getNotesTree);

/**
 * @openapi
 * /items/tree:
 *   put:
 *     tags:
 *       - Items
 *     summary: Replace the entire notes tree for the user
 *     description: Replaces the user's current notes and tasks tree with the provided tree structure. Used for full import.
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
 *                 description: The new tree structure. Each item should conform to the Item schema, but IDs will be server-generated if not valid UUIDs. Timestamps will be handled by the server.
 *     responses:
 *       '200':
 *         description: Tree replaced successfully. Returns the new tree.
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
 *         description: Invalid input (e.g., newTree is not an array or items within are malformed).
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
 *     tags:
 *       - Items
 *     summary: Create a new item at the root level
 *     description: Adds a new note, folder, or task to the top level of the user's tree.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       description: Data for the new item. ID should not be provided (server generates it).
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateItemInput'
 *     responses:
 *       '201':
 *         description: Item created successfully. Returns the newly created item.
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
 *     tags:
 *       - Items
 *     summary: Create a new item as a child of a folder
 *     description: Adds a new note, folder, or task inside the specified parent folder.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: parentId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the parent folder where the new item should be created.
 *         example: folder-123
 *     requestBody:
 *       required: true
 *       description: Data for the new item. ID should not be provided.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateItemInput'
 *     responses:
 *       '201':
 *         description: Item created successfully. Returns the newly created item.
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
 *   patch:
 *     tags:
 *       - Items
 *     summary: Update an existing item
 *     description: Partially updates an item's properties (e.g., label, content, task completion). Does not handle moving items between parents.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId'
 *         schema:
 *         name: itemId
 *           type: string
 *         required: true
 *         description: The ID of the item to update.
 *         example: note-456
 *     requestBody:
 *       required: true
 *       description: Fields to update. Include only the properties you want to change. At least one property must be provided.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateItemInput'
 *     responses:
 *       '200':
 *         description: Item updated successfully. Returns the updated item.
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
 *     tags:
 *       - Items
 *     summary: Delete an item
 *     description: Deletes an item (and all its children if it's a folder).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the item to delete.
 *         example: folder-123
 *     responses:
 *       '200':
 *         description: Item deleted successfully or item not found (considered successful deletion).
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

// Updated GET single item endpoint with error handling
router.get('/:itemId', authMiddleware, catchAsync(async (req, res, next) => {
    console.log('GET /:itemId: itemId=', req.params.itemId);

    const User = require('../models/User');
    const { findItemRecursive } = require('../utils/backendTreeUtils');

    const user = await User.findById(req.user.id);
    if (!user) {
        return next(new AppError('User not found', 404));
    }

    const currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
    const itemSearchResult = findItemRecursive(currentTree, req.params.itemId);

    if (!itemSearchResult || !itemSearchResult.item) {
        console.log('GET /:itemId: Item not found');
        return next(new AppError('Item not found', 404));
    }

    res.json(itemSearchResult.item);
}));

module.exports = router;