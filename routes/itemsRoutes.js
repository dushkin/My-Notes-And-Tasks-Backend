// routes/itemsRoutes.js
const express = require('express');
const {
    getNotesTree, // Keep this for fetching the whole tree
    createItem,
    updateItem,
    deleteItem,
    // getItem, // Optional: Add later if needed
} = require('../controllers/itemsController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Apply auth middleware to all item routes
router.use(authMiddleware);

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
router.post('/', createItem);

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
router.post('/:parentId', createItem);

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
 *         name: itemId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the item to update.
 *         example: note-456
 *     requestBody:
 *       required: true
 *       description: Fields to update. Include only the properties you want to change.
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
router.patch('/:itemId', updateItem);

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
 *         description: Item deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Item deleted successfully.
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '404':
 *         $ref: '#/components/responses/NotFoundError'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:itemId', deleteItem);

// Optional: Route for getting a single item's details
// router.get('/:itemId', getItem);

module.exports = router;
