// controllers/itemsController.js
import User from '../models/User.js'; // Assuming ESM
import {
    sortItems,
    findItemRecursive,
    deleteItemInTree,
    updateItemInTree,
    hasSiblingWithName,
    ensureServerSideIdsAndStructure,
    uuidv4
} from '../utils/backendTreeUtils.js'; // Assuming ESM
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js'; // Assuming ESM
import logger from '../config/logger.js'; // Import logger

function addMissingTimestampsToTree(nodes, defaultTimestamp) {
    if (!Array.isArray(nodes)) {
        return [];
    }
    return nodes.map(node => {
        const processedNode = { ...node };
        if (!processedNode.createdAt) {
            processedNode.createdAt = defaultTimestamp;
        }
        if (!processedNode.updatedAt) {
            processedNode.updatedAt = processedNode.createdAt;
        }
        if (processedNode.children && Array.isArray(processedNode.children)) {
            processedNode.children = addMissingTimestampsToTree(processedNode.children, defaultTimestamp);
        }
        return processedNode;
    });
}

export const getNotesTree = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    logger.info('Fetching notes tree', { userId });
    const user = await User.findById(userId);
    if (!user) {
        logger.warn('User not found for fetching tree', { userId });
        return next(new AppError('User not found', 404));
    }

    let treeToReturn = user.notesTree || [];
    if (Array.isArray(treeToReturn)) {
        const userLastUpdated = user.updatedAt ? user.updatedAt.toISOString() : new Date(0).toISOString();
        treeToReturn = addMissingTimestampsToTree(treeToReturn, userLastUpdated);
    }
    logger.debug('Notes tree fetched successfully', { userId, treeSize: treeToReturn.length });
    res.status(200).json({ notesTree: treeToReturn });
});

export const getItem = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { itemId } = req.params;
    logger.info('Attempting to get item', { userId, itemId });

    const user = await User.findById(userId);
    if (!user) {
        logger.warn('User not found for item retrieval', { userId, itemId });
        return next(new AppError('User not found', 404));
    }

    let currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
    const itemSearchResult = findItemRecursive(currentTree, itemId);

    if (!itemSearchResult || !itemSearchResult.item) {
        logger.warn('Item not found for retrieval', { userId, itemId });
        return next(new AppError('Item not found', 404));
    }

    logger.info('Item retrieved successfully', { userId, itemId });
    res.status(200).json(itemSearchResult.item);
});

export const createItem = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { label, type, content, completed } = req.body;
    const parentId = req.params.parentId || null;
    const trimmedLabel = label; // Already trimmed by validator

    logger.info('Attempting to create item', { userId, type, label: trimmedLabel, parentId });

    const user = await User.findById(userId);
    if (!user) {
        logger.warn('User not found for item creation', { userId });
        return next(new AppError('User not found', 404));
    }

    let currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
    let parentArray = currentTree;
    let parentItem = null;

    if (parentId) {
        const parentSearchResult = findItemRecursive(currentTree, parentId);
        if (!parentSearchResult || !parentSearchResult.item || parentSearchResult.item.type !== 'folder') {
            logger.warn('Parent folder not found or item is not a folder for item creation', { userId, parentId });
            return next(new AppError('Parent folder not found or item is not a folder', 404));
        }
        parentItem = parentSearchResult.item;
        if (!Array.isArray(parentItem.children)) {
            parentItem.children = [];
        }
        parentArray = parentItem.children;
    }

    if (hasSiblingWithName(parentArray, trimmedLabel)) {
        const location = parentId ? `in folder "${parentItem?.label || parentId}"` : "at the root level";
        logger.warn('Item name conflict during creation', { userId, label: trimmedLabel, location });
        return next(new AppError(`An item named "${trimmedLabel}" already exists ${location}`, 400));
    }

    const now = new Date().toISOString();
    const newItem = {
        id: uuidv4(),
        label: trimmedLabel,
        type: type,
        createdAt: now,
        updatedAt: now,
    };
    if (type === 'folder') {
        newItem.children = [];
    }
    if (type === 'note' || type === 'task') {
        newItem.content = content !== undefined ? content : "";
    }
    if (type === 'task') {
        newItem.completed = !!completed;
    }

    if (parentId && parentItem) {
        if (!Array.isArray(parentItem.children)) parentItem.children = [];
        parentItem.children.push(newItem);
        parentItem.children = sortItems(parentItem.children);
    } else {
        currentTree.push(newItem);
        currentTree = sortItems(currentTree);
    }

    user.notesTree = currentTree;
    user.markModified('notesTree');
    const savedUser = await user.save();
    logger.info('Item created successfully', { userId, itemId: newItem.id, type, label: trimmedLabel, parentId });

    const finalTree = Array.isArray(savedUser.notesTree) ? savedUser.notesTree : [];
    const createdItemSearchResult = findItemRecursive(finalTree, newItem.id);

    if (!createdItemSearchResult || !createdItemSearchResult.item) {
        logger.error("Critical Error: Newly created item not found after save", { userId, itemId: newItem.id });
        return next(new AppError('Error retrieving created item after save', 500));
    }
    res.status(201).json(createdItemSearchResult.item);
});

export const updateItem = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { itemId } = req.params;
    const updates = req.body;
    logger.info('Attempting to update item', { userId, itemId, updates: Object.keys(updates) });

    const user = await User.findById(userId);
    if (!user) {
        logger.warn('User not found for item update', { userId, itemId });
        return next(new AppError('User not found', 404));
    }

    let currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
    logger.debug('Current tree before update attempt', { userId, itemId, treeSize: currentTree.length });

    const originalItemSearchResult = findItemRecursive(currentTree, itemId);
    if (!originalItemSearchResult || !originalItemSearchResult.item) {
        logger.warn('Item not found for update', { userId, itemId });
        return next(new AppError('Item not found', 404));
    }
    const { item: originalItem, parentArray: originalSiblings } = originalItemSearchResult;

    if (updates.hasOwnProperty('label') && typeof updates.label === 'string') {
        const trimmedNewLabel = updates.label.trim();
        if (trimmedNewLabel !== originalItem.label && hasSiblingWithName(originalSiblings || [], trimmedNewLabel, itemId)) {
            logger.warn('Item name conflict during update', { userId, itemId, newLabel: trimmedNewLabel });
            return next(new AppError(`An item named "${trimmedNewLabel}" already exists in this location`, 400));
        }
    }

    const updatedTreeInMemory = updateItemInTree(currentTree, itemId, updates);
    const itemAfterInMemoryUpdateResult = findItemRecursive(updatedTreeInMemory, itemId);
    const itemAfterInMemoryUpdate = itemAfterInMemoryUpdateResult ? itemAfterInMemoryUpdateResult.item : null;

    if (!itemAfterInMemoryUpdate) {
        logger.error('Item not found after in-memory update (should not happen)', { userId, itemId });
        return next(new AppError('Internal error processing update', 500));
    }

    if (JSON.stringify(originalItem) === JSON.stringify(itemAfterInMemoryUpdate) && originalItem.updatedAt === itemAfterInMemoryUpdate.updatedAt) {
        logger.info('No effective changes for item update, returning original', { userId, itemId });
        return res.status(200).json(originalItem);
    }

    user.notesTree = updatedTreeInMemory;
    user.markModified('notesTree');
    logger.debug('notesTree marked as modified, attempting save', { userId, itemId });

    const savedUser = await user.save();
    logger.info('Item updated successfully', { userId, itemId });

    let finalTreeToSearch = (savedUser && Array.isArray(savedUser.notesTree)) ? savedUser.notesTree : [];
    if (!Array.isArray(savedUser?.notesTree)) {
         logger.warn('savedUser.notesTree is not an array after save, re-fetching', { userId, itemId, savedNotesTreeType: typeof savedUser?.notesTree });
         const reFetchedUser = await User.findById(userId);
         finalTreeToSearch = (reFetchedUser && Array.isArray(reFetchedUser.notesTree)) ? reFetchedUser.notesTree : [];
         if (!Array.isArray(finalTreeToSearch)){
            logger.error('Even re-fetched user.notesTree is problematic', { userId, itemId });
            finalTreeToSearch = [];
         }
    }

    const itemSearchResult = findItemRecursive(finalTreeToSearch, itemId);
    if (!itemSearchResult || !itemSearchResult.item) {
        logger.error('Error finding updated item in the final tree', { userId, itemId });
        return next(new AppError('Error retrieving updated item after save (not found in final tree)', 500));
    }
    
    logger.debug('Updated item details being sent to client', { userId, itemId, itemLabel: itemSearchResult.item.label });
    res.status(200).json(itemSearchResult.item);
});

export const deleteItem = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { itemId } = req.params;
    logger.info('Attempting to delete item', { userId, itemId });

    const user = await User.findById(userId);
    if (!user) {
        logger.warn('User not found for item deletion', { userId, itemId });
        return next(new AppError('User not found', 404));
    }

    let currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
    const itemExistsResult = findItemRecursive(currentTree, itemId);

    if (!itemExistsResult) {
        logger.info('Item not found or already deleted (idempotent)', { userId, itemId });
        return res.status(200).json({ message: 'Item not found or already deleted.' });
    }

    const updatedTree = deleteItemInTree(currentTree, itemId);
    user.notesTree = updatedTree;
    user.markModified('notesTree');
    await user.save();
    logger.info('Item deleted successfully', { userId, itemId });
    res.status(200).json({ message: 'Item deleted successfully.' });
});

export const deleteTree = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    logger.info('Attempting to delete entire tree', { userId });
    const user = await User.findById(userId);
    if (!user) {
        logger.warn('User not found for tree deletion', { userId });
        return next(new AppError('User not found', 404));
    }
    user.notesTree = [];
    user.markModified('notesTree');
    await user.save();
    logger.info('Entire tree deleted successfully', { userId });
    res.status(200).json({ message: 'Tree deleted successfully' });
});

export const replaceUserTree = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { newTree } = req.body; // Validated by express-validator
    logger.info('Attempting to replace user tree (import)', { userId, newTreeItemsCount: newTree?.length });

    const user = await User.findById(userId);
    if (!user) {
        logger.warn('User not found for tree replacement', { userId });
        return next(new AppError('User not found', 404));
    }

    const processedNewTree = Array.isArray(newTree) ? newTree.map(item => ensureServerSideIdsAndStructure(item)) : [];
    logger.debug('Processed new tree structure for replacement', { userId, processedTreeItemsCount: processedNewTree.length });

    user.notesTree = processedNewTree;
    user.markModified('notesTree');
    const savedUser = await user.save();

    logger.info('User tree replaced successfully', { userId });
    res.status(200).json({
        message: 'Tree replaced successfully.',
        notesTree: savedUser.notesTree || []
    });
});