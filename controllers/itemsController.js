import { emitToUser } from "../socket/socketController.js";
import User from '../models/User.js';
import {
    sortItems,
    findItemRecursive,
    deleteItemInTree,
    updateItemInTree,
    hasSiblingWithName,
    ensureServerSideIdsAndStructure,
    uuidv4,
    findParentAndSiblings
} from '../utils/backendTreeUtils.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import logger from '../config/logger.js';

// ... (keep the addMissingTimestampsToTree function as is) ...

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
        const userLastUpdated = user.updatedAt ?
            user.updatedAt.toISOString() : new Date(0).toISOString();
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
    const
        itemSearchResult = findItemRecursive(currentTree, itemId);

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
    const trimmedLabel = label;

    logger.info('Attempting to create item', { userId, type, label: trimmedLabel, parentId });

    const user = await User.findById(userId);
    if (!user) {
        logger.warn('User not found for item creation', {
            userId
        });
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
    await user.save();
    emitToUser(user._id.toString(), 'itemCreated', newItem);
    logger.info('Item created successfully', { userId, itemId: newItem.id, type, label: trimmedLabel, parentId });
    res.status(201).json(newItem);
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

    let currentTree =
        Array.isArray(user.notesTree) ? user.notesTree : [];
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
    await user.save();
    emitToUser(user._id.toString(), 'itemUpdated', itemAfterInMemoryUpdate);
    logger.info('Item updated successfully', { userId, itemId });
    res.status(200).json(itemAfterInMemoryUpdate);
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
    emitToUser(user._id.toString(), 'itemDeleted', { itemId });
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
    emitToUser(user._id.toString(), 'treeReplaced', []); // 👈 CORRECTED: Notify clients
    logger.info('Entire tree deleted successfully', {
        userId
    });
    res.status(200).json({ message: 'Tree deleted successfully' });
});

export const replaceUserTree = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { newTree } = req.body;
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
    emitToUser(user._id.toString(), 'treeReplaced', user.notesTree);

    logger.info('User tree replaced successfully', { userId });
    res.status(200).json({
        message: 'Tree replaced successfully.',
        notesTree: savedUser.notesTree ||
            []
    });
});

export const moveItem = catchAsync(async (req, res, next) => {
    const userId = req.user.id;
    const { newParentId, newIndex } = req.body;
    const itemId = req.params.itemId;

    const user = await User.findById(userId);
    if (!user) return next(new AppError('User not found', 404));

    let currentTree = user.notesTree || [];

    const { parent: oldParent, siblings: oldSiblings, index: oldIndex } = findParentAndSiblings(currentTree, itemId);
    if (!oldSiblings || oldIndex === -1) {
        return next(new AppError('Item to move not found', 404));
    }

    const [itemToMove] = oldSiblings.splice(oldIndex, 1);
    if (oldParent) {
        oldParent.updatedAt = new Date().toISOString();
    }

    let targetChildren = currentTree;
    let newParent = null;

    if (newParentId) {
        const newParentResult = findItemRecursive(currentTree, newParentId);
        if (!newParentResult || !newParentResult.item) {
            return next(new AppError('New parent folder not found', 404));
        }
        newParent = newParentResult.item;
        if (!Array.isArray(newParent.children)) {
            newParent.children = [];
        }
        targetChildren = newParent.children;
    }

    const finalIndex = (newIndex !== null && newIndex !== undefined && newIndex >= 0 && newIndex <= targetChildren.length) ?
        newIndex :
        targetChildren.length;

    targetChildren.splice(finalIndex, 0, itemToMove);

    itemToMove.updatedAt = new Date().toISOString();
    if (newParent) {
        newParent.updatedAt = itemToMove.updatedAt;
    }

    user.notesTree = currentTree;
    user.markModified('notesTree');
    await user.save();
    emitToUser(user._id.toString(), 'itemMoved', { itemId, newParentId });
    res.status(200).json({ status: 'success', data: { movedItem: itemToMove } });
});