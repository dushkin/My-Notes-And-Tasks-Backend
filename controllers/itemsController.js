// controllers/itemsController.js
const User = require('../models/User');
const {
    sortItems,
    findItemRecursive,
    deleteItemInTree,
    updateItemInTree,
    hasSiblingWithName,
    ensureServerSideIdsAndStructure,
    uuidv4
} = require('../utils/backendTreeUtils');

// Helper function to recursively add missing timestamps
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

// --- Get Full Tree ---
exports.getNotesTree = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let treeToReturn = user.notesTree || [];
        if (Array.isArray(treeToReturn)) {
            const userLastUpdated = user.updatedAt ? user.updatedAt.toISOString() : new Date(0).toISOString();
            treeToReturn = addMissingTimestampsToTree(treeToReturn, userLastUpdated);
        }

        res.status(200).json({ notesTree: treeToReturn });
    } catch (err) {
        console.error('Get Notes Tree Error:', err.message, err.stack);
        res.status(500).json({ error: 'Server error fetching notes tree' });
    }
};

// --- Create Item ---
exports.createItem = async (req, res) => {
    const { label, type, content = '', completed = false } = req.body;
    const parentId = req.params.parentId || null;

    const trimmedLabel = label?.trim();
    if (!trimmedLabel) return res.status(400).json({ error: 'Label is required.' });
    if (!['folder', 'note', 'task'].includes(type)) return res.status(400).json({ error: 'Invalid item type.' });

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
        let parentArray = currentTree;
        let parentItem = null;

        if (parentId) {
            const parentSearchResult = findItemRecursive(currentTree, parentId);
            if (!parentSearchResult || !parentSearchResult.item || parentSearchResult.item.type !== 'folder') {
                return res.status(404).json({ error: 'Parent folder not found or item is not a folder.' });
            }
            parentItem = parentSearchResult.item;
            if (!Array.isArray(parentItem.children)) {
                parentItem.children = [];
            }
            parentArray = parentItem.children;
        }

        if (hasSiblingWithName(parentArray, trimmedLabel)) {
            const location = parentId ?
                `in folder "${parentItem?.label || parentId}"` : "at the root level";
            return res.status(400).json({ error: `An item named "${trimmedLabel}" already exists ${location}.` });
        }

        const now = new Date().toISOString();
        const newItem = {
            id: uuidv4(),
            label: trimmedLabel,
            type: type,
            createdAt: now,
            updatedAt: now,
        };
        if (type === 'folder') newItem.children = [];
        if (type === 'note' || type === 'task') newItem.content = content || "";
        if (type === 'task') {
            newItem.completed = !!completed;
        }

        if (parentId && parentItem) {
            if (!Array.isArray(parentItem.children)) {
                parentItem.children = [];
            }
            parentItem.children.push(newItem);
            parentItem.children = sortItems(parentItem.children);
        } else {
            currentTree.push(newItem);
            currentTree = sortItems(currentTree);
        }

        user.notesTree = currentTree;
        user.markModified('notesTree');
        const savedUser = await user.save();
        const finalTree = Array.isArray(savedUser.notesTree) ? savedUser.notesTree : [];
        const createdItemSearchResult = findItemRecursive(finalTree, newItem.id);

        if (!createdItemSearchResult || !createdItemSearchResult.item) {
            console.error("Critical Error: Newly created item not found in savedUser.notesTree. newItem ID:", newItem.id);
            console.log("savedUser.notesTree content:", JSON.stringify(finalTree, null, 2));
            return res.status(500).json({ error: 'Error retrieving created item after save.' });
        }
        res.status(201).json(createdItemSearchResult.item);
    } catch (err) {
        console.error('Create Item Error:', err.message, err.stack);
        res.status(500).json({ error: 'Server error creating item.' });
    }
};

// --- Update Item ---
exports.updateItem = async (req, res) => {
    console.log('--- Backend: updateItem Controller ---');
    const { itemId } = req.params;
    const updates = req.body;
    console.log('Received Item ID:', itemId);
    console.log('Received Request Body (updates):', JSON.stringify(updates, null, 2));

    if (!itemId) {
        console.log('Backend: updateItem - Error: Item ID is required.');
        return res.status(400).json({ error: 'Item ID is required.' });
    }
    if (Object.keys(updates).length === 0) {
        console.log('Backend: updateItem - Error: No update data provided.');
        return res.status(400).json({ error: 'No update data provided.' });
    }
    if (updates.hasOwnProperty('label')) {
        if (updates.label === null) {
            console.log('Backend: updateItem - Error: Label cannot be null.');
            return res.status(400).json({ error: 'Label cannot be null.' });
        }
        if (typeof updates.label === 'string' && !updates.label.trim()) {
            console.log('Backend: updateItem - Error: Label cannot be empty.');
            return res.status(400).json({ error: 'Label cannot be empty.' });
        }
    }
    if (updates.hasOwnProperty('content') && updates.content === null) {
        console.log('Backend: updateItem - Error: Content cannot be null.');
        return res.status(400).json({ error: 'Content cannot be null.' });
    }

    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            console.error(`Backend: updateItem - User not found for ID: ${req.user.id}`);
            return res.status(404).json({ error: 'User not found' });
        }

        let currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
        const initialTreeString = JSON.stringify(currentTree, null, 2);
        console.log(`Backend: updateItem - User ${user.email}'s currentTree from DB before find (is array: ${Array.isArray(currentTree)}). Snippet:`, initialTreeString.substring(0, Math.min(200, initialTreeString.length)) + (initialTreeString.length > 200 ? "..." : ""));

        const originalItemSearchResult = findItemRecursive(currentTree, itemId);
        if (!originalItemSearchResult || !originalItemSearchResult.item) {
            console.error(`Backend: updateItem - Item ${itemId} NOT FOUND in user's currentTree during initial search.`);
            return res.status(404).json({ error: 'Item not found.' });
        }
        const { item: originalItem, parentArray: originalSiblings } = originalItemSearchResult;

        if (updates.label && typeof updates.label === 'string' && updates.label.trim() !== originalItem.label) {
            const trimmedNewLabel = updates.label.trim();
            if (hasSiblingWithName(originalSiblings || [], trimmedNewLabel, itemId)) {
                console.log(`Backend: updateItem - Name conflict for label: "${trimmedNewLabel}"`);
                return res.status(400).json({ error: `An item named "${trimmedNewLabel}" already exists in this location.` });
            }
        }

        const updatedTreeInMemory = updateItemInTree(currentTree, itemId, updates);
        const itemAfterInMemoryUpdateResult = findItemRecursive(updatedTreeInMemory, itemId);
        const itemAfterInMemoryUpdate = itemAfterInMemoryUpdateResult ? itemAfterInMemoryUpdateResult.item : null;

        if (JSON.stringify(originalItem) === JSON.stringify(itemAfterInMemoryUpdate)) {
            console.log(`Backend: updateItem - No effective changes made by updateItemInTree for item ${itemId} (properties are identical). Returning original item.`);
            return res.status(200).json(originalItem);
        }
        if (updatedTreeInMemory === currentTree && !itemAfterInMemoryUpdate.updatedAt) { // Check if only updatedAt was the potential change and it didn't happen
            console.log(`Backend: updateItem - updateItemInTree returned the same tree reference and no updatedAt change, indicating no effective property changes for item ${itemId}. Returning original item.`);
            return res.status(200).json(originalItem);
        }


        const updatedTreeInMemoryString = JSON.stringify(updatedTreeInMemory, null, 2);
        console.log('itemsController: Tree after updateItemInTree (before assignment - snippet):', updatedTreeInMemoryString.substring(0, Math.min(200, updatedTreeInMemoryString.length)) + (updatedTreeInMemoryString.length > 200 ? "..." : ""));

        user.notesTree = updatedTreeInMemory;

        const preSaveTreeLog = user.notesTree ? JSON.stringify(user.notesTree, null, 2) : "undefined/null";
        console.log('itemsController: Attempting to mark notesTree as modified. Current user.notesTree snippet before save:', preSaveTreeLog.substring(0, Math.min(200, preSaveTreeLog.length)) + (preSaveTreeLog.length > 200 ? "..." : ""));

        user.markModified('notesTree');
        console.log('itemsController: notesTree marked as modified. Attempting user.save().');

        const savedUser = await user.save();
        console.log('itemsController: User.save() completed.');

        let itemToReturn;
        let finalTreeToSearch;

        if (savedUser && savedUser.notesTree !== undefined && savedUser.notesTree !== null && Array.isArray(savedUser.notesTree)) {
            const savedTreeString = JSON.stringify(savedUser.notesTree, null, 2);
            console.log('itemsController: `savedUser` from user.save() has notesTree. Snippet:', savedTreeString.substring(0, Math.min(700, savedTreeString.length)) + (savedTreeString.length > 700 ? "..." : ""));
            finalTreeToSearch = savedUser.notesTree;
        } else {
            console.error('itemsController: CRITICAL - `savedUser.notesTree` is undefined, null, or not an array AFTER save. Value:', savedUser ? String(savedUser.notesTree) : 'savedUser is null/undefined');
            const reFetchedUser = await User.findById(user.id);
            if (reFetchedUser && reFetchedUser.notesTree !== undefined && reFetchedUser.notesTree !== null && Array.isArray(reFetchedUser.notesTree)) {
                const reFetchedTreeString = JSON.stringify(reFetchedUser.notesTree, null, 2);
                console.log('itemsController: Re-fetched user HAS notesTree. Snippet:', reFetchedTreeString.substring(0, Math.min(700, reFetchedTreeString.length)) + (reFetchedTreeString.length > 700 ? "..." : ""));
                finalTreeToSearch = reFetchedUser.notesTree;
            } else {
                console.error('itemsController: Even re-fetched user.notesTree is problematic. Value:', reFetchedUser ? String(reFetchedUser.notesTree) : 'reFetchedUser is null/undefined');
                finalTreeToSearch = [];
            }
        }

        const itemSearchResult = findItemRecursive(finalTreeToSearch, itemId);
        if (!itemSearchResult || !itemSearchResult.item) {
            console.error(`itemsController: Error finding item ${itemId} in the tree used for response (finalTreeToSearch). Item might have been unexpectedly lost or structure changed.`);
            const finalTreeForLog = JSON.stringify(finalTreeToSearch, null, 2);
            console.log("Content of finalTreeToSearch during item finding failure:", finalTreeForLog.substring(0, Math.min(1000, finalTreeForLog.length)) + (finalTreeForLog.length > 1000 ? "..." : ""));
            return res.status(500).json({ error: 'Error retrieving updated item after save (not found in final tree).' });
        }
        itemToReturn = itemSearchResult.item;

        if (updates.hasOwnProperty('content') && itemToReturn.content !== updates.content) {
            console.warn(`itemsController: Content mismatch for item ${itemId} in final response! Expected: "${updates.content}", Got: "${itemToReturn.content}".`);
        } else if (updates.hasOwnProperty('content')) {
            console.log(`itemsController: Content for item ${itemId} appears correct in the object being sent to client.`);
        }
        if (updates.hasOwnProperty('label') && typeof updates.label === 'string' && itemToReturn.label !== updates.label.trim()) {
            console.warn(`itemsController: Label mismatch for item ${itemId} in final response! Expected: "${updates.label.trim()}", Got: "${itemToReturn.label}".`);
        }
        if (updates.hasOwnProperty('completed') && itemToReturn.type === 'task' && itemToReturn.completed !== !!updates.completed) {
            console.warn(`itemsController: Completion status mismatch for task ${itemId} in final response! Expected: "${!!updates.completed}", Got: "${itemToReturn.completed}".`);
        }

        const itemToReturnString = JSON.stringify(itemToReturn, null, 2);
        console.log(`itemsController: Sending item ${itemId} to client:`, itemToReturnString.substring(0, Math.min(700, itemToReturnString.length)) + (itemToReturnString.length > 700 ? "..." : ""));
        res.status(200).json(itemToReturn);
    } catch (err) {
        console.error('Update Item Error in Controller CATCH BLOCK:', err.message, err.stack);
        res.status(500).json({ error: 'Server error updating item.' });
    }
};


// --- Delete Item ---
exports.deleteItem = async (req, res) => {
    const { itemId } = req.params;
    if (!itemId) return res.status(400).json({ error: 'Item ID is required.' });

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let currentTree = Array.isArray(user.notesTree) ? user.notesTree : [];
        const itemExistsResult = findItemRecursive(currentTree, itemId);

        if (!itemExistsResult) {
            return res.status(200).json({ message: 'Item not found or already deleted.' });
        }
        const updatedTree = deleteItemInTree(currentTree, itemId);
        user.notesTree = updatedTree;
        user.markModified('notesTree');
        await user.save();
        res.status(200).json({ message: 'Item deleted successfully.' });
    } catch (err) {
        console.error('Delete Item Error:', err.message, err.stack);
        res.status(500).json({ error: 'Server error deleting item.' });
    }
};

// --- Replace User's Entire Tree (for Import) ---
exports.replaceUserTree = async (req, res) => {
    const { newTree } = req.body;
    if (!Array.isArray(newTree)) {
        return res.status(400).json({ error: 'Invalid tree data: Must be an array.' });
    }

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const processedNewTree = newTree.map(item => ensureServerSideIdsAndStructure(item));

        user.notesTree = processedNewTree;
        user.markModified('notesTree');
        const savedUser = await user.save();

        res.status(200).json({
            message: 'Tree replaced successfully.',
            notesTree: savedUser.notesTree || []
        });
    } catch (err) {
        console.error('Replace User Tree Error:', err.message, err.stack);
        res.status(500).json({ error: 'Server error replacing tree.' });
    }
};