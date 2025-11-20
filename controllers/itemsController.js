// ============================================================================
// MODELS AND DATA
// ============================================================================
import User from '../models/User.js';

// ============================================================================
// MIDDLEWARE AND ERROR HANDLING
// ============================================================================
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';

// ============================================================================
// UTILITIES AND HELPERS
// ============================================================================
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
import { sanitizeContent } from '../utils/contentSanitizer.js';

// ============================================================================
// SERVICES AND COMMUNICATION
// ============================================================================
import { emitToUser } from "../socket/socketController.js";

// ============================================================================
// CONFIGURATION
// ============================================================================
import logger from '../config/logger.js';

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
    const trimmedLabel = label;

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
        version: 1, // Initialize version for new items
    };
    if (type === 'folder') {
        newItem.children = [];
    }
    if (type === 'note' || type === 'task') {
        newItem.content = content !== undefined ? sanitizeContent(content) : "";
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
    
    // Wrap socket emission in try-catch to prevent server crashes
    // Emit to other devices but not the originating client to prevent duplicate adds
    try {
        emitToUser(user._id.toString(), 'itemCreated', { newItem, parentId });
    } catch (socketError) {
        logger.error('Socket emission failed for itemCreated', { 
            userId, 
            itemId: newItem.id, 
            error: socketError.message 
        });
    }
    
    logger.info('Item created successfully', { userId, itemId: newItem.id, type, label: trimmedLabel, parentId });
    res.status(201).json(newItem);
});

export const updateItem = catchAsync(async (req, res, next) => {
    const startTime = Date.now();
    const userId = req.user.id;
    const { itemId } = req.params;
    const updates = req.body;
    logger.info('Attempting to update item', {
        userId,
        itemId,
        updates: Object.keys(updates),
        contentType: updates.content ? typeof updates.content : 'undefined',
        contentPreview: updates.content ? updates.content.substring(0, 100) : 'undefined'
    });

    const beforeUserFetch = Date.now();
    // Only select the fields we need to reduce fetch time
    const user = await User.findById(userId).select('notesTree').lean(false);
    const userFetchTime = Date.now() - beforeUserFetch;
    logger.info('[TIMING] User fetch completed', { userId, duration: `${userFetchTime}ms` });
    console.log(`⏱️ [TIMING] User fetch: ${userFetchTime}ms (optimized with select)`);

    if (!user) {
        logger.warn('User not found for item update', { userId, itemId });
        return next(new AppError('User not found', 404));
    }

    let currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
    logger.debug('Current tree before update attempt', { userId, itemId, treeSize: currentTree.length });

    // Debug: Log all item IDs in the tree to diagnose search issues
    const getAllItemIds = (items, depth = 0) => {
        const ids = [];
        if (!Array.isArray(items)) return ids;
        items.forEach(item => {
            if (item && item.id) {
                ids.push({ id: item.id, label: item.label, type: item.type, depth });
                if (item.type === 'folder' && Array.isArray(item.children)) {
                    ids.push(...getAllItemIds(item.children, depth + 1));
                }
            }
        });
        return ids;
    };
    const allIds = getAllItemIds(currentTree);
    console.log(`🔍 [DEBUG] Tree contains ${allIds.length} items:`, allIds);
    console.log(`🔍 [DEBUG] Looking for itemId: ${itemId}`);
    console.log(`🔍 [DEBUG] Item exists in tree: ${allIds.some(i => i.id === itemId)}`);

    const beforeItemSearch = Date.now();
    // Pass 'notesTree' as path to enable mongoPath tracking for optimizations
    const originalItemSearchResult = findItemRecursive(currentTree, itemId, 'notesTree');
    const itemSearchTime = Date.now() - beforeItemSearch;
    logger.info('[TIMING] Item search completed', { userId, itemId, duration: `${itemSearchTime}ms` });
    console.log(`⏱️ [TIMING] Item search: ${itemSearchTime}ms`);
    console.log(`🔍 [DEBUG] Search result:`, {
        found: !!originalItemSearchResult,
        hasItem: !!originalItemSearchResult?.item,
        hasMongoPath: !!originalItemSearchResult?.mongoPath,
        mongoPath: originalItemSearchResult?.mongoPath,
        itemId: originalItemSearchResult?.item?.id
    });

    if (!originalItemSearchResult || !originalItemSearchResult.item) {
        console.error(`❌ [ERROR] Item not found:`, { userId, itemId, treeSize: currentTree.length });
        logger.warn('Item not found for update', { userId, itemId });
        return next(new AppError('Item not found', 404));
    }
    const { item: originalItem, parentArray: originalSiblings } = originalItemSearchResult;

    const beforeValidation = Date.now();
    if (updates.hasOwnProperty('label') && typeof updates.label === 'string') {
        const trimmedNewLabel = updates.label.trim();
        if (trimmedNewLabel !== originalItem.label && hasSiblingWithName(originalSiblings || [], trimmedNewLabel, itemId)) {
            logger.warn('Item name conflict during update', { userId, itemId, newLabel: trimmedNewLabel });
            return next(new AppError(`An item named "${trimmedNewLabel}" already exists in this location`, 400));
        }
    }
    const validationTime = Date.now() - beforeValidation;
    logger.info('[TIMING] Validation completed', { userId, itemId, duration: `${validationTime}ms` });
    console.log(`⏱️ [TIMING] Validation: ${validationTime}ms`);

    // Enable version control for content updates
    const versionControlOptions = {
        enforceVersionControl: updates.hasOwnProperty('content') || updates.hasOwnProperty('expectedVersion')
    };

    const beforeTreeUpdate = Date.now();
    const updateResult = updateItemInTree(currentTree, itemId, updates, versionControlOptions);
    const treeUpdateTime = Date.now() - beforeTreeUpdate;
    logger.info('[TIMING] Tree update in memory completed', { userId, itemId, duration: `${treeUpdateTime}ms` });
    console.log(`⏱️ [TIMING] Tree update in memory: ${treeUpdateTime}ms`);

    // Handle version conflicts
    if (updateResult.conflict) {
        logger.warn('Version conflict detected during item update', {
            userId,
            itemId,
            serverVersion: updateResult.conflict.serverVersion,
            clientVersion: updateResult.conflict.clientVersion
        });
        
        return res.status(409).json({
            error: 'Version conflict detected',
            conflict: {
                itemId: updateResult.conflict.itemId,
                serverVersion: updateResult.conflict.serverVersion,
                clientVersion: updateResult.conflict.clientVersion,
                serverItem: updateResult.conflict.serverItem,
                message: 'The item has been modified by another client. Please refresh and try again.'
            }
        });
    }
    
    const updatedTreeInMemory = updateResult.tree;
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

    const beforeSave = Date.now();

    // OPTIMIZATION: For simple label-only updates, use updateOne with $set to avoid saving entire tree
    const isSimpleLabelUpdate = updates.hasOwnProperty('label') &&
                                Object.keys(updates).length === 1 &&
                                originalItemSearchResult.mongoPath;

    if (isSimpleLabelUpdate && originalItemSearchResult.mongoPath) {
        // Use MongoDB $set to update only the specific field
        const updatePath = originalItemSearchResult.mongoPath;
        const updateFields = {
            [`${updatePath}.label`]: updates.label,
            [`${updatePath}.updatedAt`]: itemAfterInMemoryUpdate.updatedAt,
            [`${updatePath}.version`]: itemAfterInMemoryUpdate.version
        };

        await User.updateOne(
            { _id: userId },
            { $set: updateFields }
        );

        console.log(`⚡ [OPTIMIZATION] Used $set for label-only update at path: ${updatePath}`);
    } else {
        // For complex updates (content, multiple fields), use traditional save
        user.notesTree = updatedTreeInMemory;
        user.markModified('notesTree');
        logger.debug('notesTree marked as modified, attempting save', { userId, itemId });

        // Use validateBeforeSave: false for better performance on simple updates
        // Validation already happened in middleware
        await user.save({ validateBeforeSave: false });
        console.log(`📝 [OPTIMIZATION] Used traditional save() for complex update`);
    }

    const saveTime = Date.now() - beforeSave;
    logger.info('[TIMING] MongoDB save completed', { userId, itemId, duration: `${saveTime}ms` });
    console.log(`⏱️ [TIMING] MongoDB save: ${saveTime}ms`);

    // Wrap socket emission in try-catch to prevent server crashes
    const beforeSocket = Date.now();
    try {
        console.log(`🔄 Attempting to emit itemUpdated for user ${user._id.toString()}:`, {
            itemId: itemAfterInMemoryUpdate.id,
            type: itemAfterInMemoryUpdate.type
        });
        emitToUser(user._id.toString(), 'itemUpdated', itemAfterInMemoryUpdate);
        console.log(`✅ Successfully emitted itemUpdated for user ${user._id.toString()}`);
    } catch (socketError) {
        logger.error('Socket emission failed for itemUpdated', { 
            userId, 
            itemId, 
            error: socketError.message 
        });
        console.error(`❌ Socket emission failed for itemUpdated:`, socketError);
    }
    const socketTime = Date.now() - beforeSocket;
    logger.info('[TIMING] Socket emission completed', { userId, itemId, duration: `${socketTime}ms` });
    console.log(`⏱️ [TIMING] Socket emission: ${socketTime}ms`);

    const totalTime = Date.now() - startTime;
    logger.info('[TIMING] ========== TOTAL UPDATE TIME ==========', {
        userId,
        itemId,
        breakdown: {
            userFetch: `${userFetchTime}ms`,
            itemSearch: `${itemSearchTime}ms`,
            validation: `${validationTime}ms`,
            treeUpdate: `${treeUpdateTime}ms`,
            mongoSave: `${saveTime}ms`,
            socketEmit: `${socketTime}ms`,
            total: `${totalTime}ms`
        }
    });
    console.log(`⏱️ [TIMING] ========== TOTAL UPDATE TIME: ${totalTime}ms ==========`);
    console.log(`⏱️ [TIMING] Breakdown: userFetch=${userFetchTime}ms, itemSearch=${itemSearchTime}ms, validation=${validationTime}ms, treeUpdate=${treeUpdateTime}ms, mongoSave=${saveTime}ms, socketEmit=${socketTime}ms`);

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
    
    // Wrap socket emission in try-catch to prevent server crashes
    try {
        emitToUser(user._id.toString(), 'itemDeleted', { itemId });
    } catch (socketError) {
        logger.error('Socket emission failed for itemDeleted', { 
            userId, 
            itemId, 
            error: socketError.message 
        });
    }
    
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
    
    // Wrap socket emission in try-catch to prevent server crashes
    try {
        emitToUser(user._id.toString(), 'treeReplaced', []);
    } catch (socketError) {
        logger.error('Socket emission failed for treeReplaced', { 
            userId, 
            error: socketError.message 
        });
    }
    
    logger.info('Entire tree deleted successfully', { userId });
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
    console.log('CONTROLLER DEBUG: Input newTree:', JSON.stringify(newTree, null, 2));
    console.log('CONTROLLER DEBUG: Processed tree:', JSON.stringify(processedNewTree, null, 2));
    logger.debug('Processed new tree structure for replacement', { userId, processedTreeItemsCount: processedNewTree.length, firstItem: processedNewTree[0] });

    user.notesTree = processedNewTree;
    user.markModified('notesTree');
    const savedUser = await user.save();
    
    // Wrap socket emission in try-catch to prevent server crashes
    try {
        emitToUser(user._id.toString(), 'treeReplaced', user.notesTree);
    } catch (socketError) {
        logger.error('Socket emission failed for treeReplaced', { 
            userId, 
            error: socketError.message 
        });
    }

    logger.info('User tree replaced successfully', { userId });
    res.status(200).json({
        message: 'Tree replaced successfully.',
        notesTree: savedUser.notesTree || []
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
    
    // Wrap socket emission in try-catch to prevent server crashes
    try {
        emitToUser(user._id.toString(), 'itemMoved', { itemId, newParentId });
    } catch (socketError) {
        logger.error('Socket emission failed for itemMoved', { 
            userId, 
            itemId, 
            error: socketError.message 
        });
    }
    
    res.status(200).json({ status: 'success', data: { movedItem: itemToMove } });
});