// controllers/itemsController.js
const User = require('../models/User');
const {
    sortItems,
    findItemRecursive,
    findParentArrayAndIndex,
    deleteItemInTree,
    updateItemInTree,
    hasSiblingWithName,
    uuidv4 // Import UUID generator
} = require('../utils/backendTreeUtils'); // Use backend utils

// --- Get Full Tree (Existing Logic) ---
exports.getNotesTree = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.status(200).json({ notesTree: user.notesTree || [] });
    } catch (err) {
        console.error('Get Notes Tree Error:', err.message);
        res.status(500).json({ error: 'Server error fetching notes tree' });
    }
};

// --- Create Item ---
exports.createItem = async (req, res) => {
    const { label, type, content = '', completed = false } = req.body; // Get potential fields
    const parentId = req.params.parentId || null; // Get parentId from URL params if present

    // Basic validation
    const trimmedLabel = label?.trim();
    if (!trimmedLabel) return res.status(400).json({ error: 'Label is required.' });
    if (!['folder', 'note', 'task'].includes(type)) return res.status(400).json({ error: 'Invalid item type.' });

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let currentTree = user.notesTree || [];
        let parentArray = currentTree; // Default to root array
        let parentItem = null;

        // Find parent if parentId is provided
        if (parentId) {
            const parentSearchResult = findItemRecursive(currentTree, parentId);
            if (!parentSearchResult || parentSearchResult.item.type !== 'folder') {
                return res.status(404).json({ error: 'Parent folder not found or item is not a folder.' });
            }
            parentItem = parentSearchResult.item;
            // Ensure children array exists
            if (!Array.isArray(parentItem.children)) {
                parentItem.children = [];
            }
            parentArray = parentItem.children;
        }

        // Check for name conflict within the parent array
        if (hasSiblingWithName(parentArray, trimmedLabel)) {
            const location = parentId ? `in folder "${parentItem?.label || parentId}"` : "at the root level";
            return res.status(400).json({ error: `An item named "${trimmedLabel}" already exists ${location}.` });
        }

        // Generate new item
        const newItem = {
            id: uuidv4(), // Generate unique ID on the server
            label: trimmedLabel,
            type: type,
        };
        if (type === 'folder') newItem.children = [];
        if (type === 'note') newItem.content = content;
        if (type === 'task') {
            newItem.content = content;
            newItem.completed = !!completed; // Ensure boolean
        }

        // --- Modify the Tree in JS ---
        if (parentId && parentItem) {
            // Find the actual parent object in the *original* tree structure (before potential copies)
            // and push the new item to its children, then sort.
            // This is tricky. It might be safer to rebuild the path or use specific $push.
            // Let's try modifying the fetched tree and saving it back for now.
            parentArray.push(newItem); // Add to the found parent's children array
            sortItems(parentArray); // Sort siblings
        } else {
            // Add to root and sort
            currentTree.push(newItem);
            currentTree = sortItems(currentTree);
        }

        // --- Save Updated Tree ---
        user.notesTree = currentTree; // Replace the tree on the user document
        user.markModified('notesTree'); // Explicitly mark the mixed type array as modified for Mongoose
        const savedUser = await user.save();

        // Find the newly created item in the saved tree to return it
        const createdItemSearchResult = findItemRecursive(savedUser.notesTree, newItem.id);


        if (!createdItemSearchResult) {
            // This shouldn't happen if save was successful, but good practice
            console.error("Error finding newly created item after save", newItem.id);
            return res.status(500).json({ error: 'Error retrieving created item after save.' });
        }


        res.status(201).json(createdItemSearchResult.item); // Return the newly created item

    } catch (err) {
        console.error('Create Item Error:', err);
        res.status(500).json({ error: 'Server error creating item.' });
    }
};

// --- Update Item ---
exports.updateItem = async (req, res) => {
    const { itemId } = req.params;
    const updates = req.body; // Contains fields like { label?, content?, completed? }

    if (!itemId) return res.status(400).json({ error: 'Item ID is required.' });
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No update data provided.' });
    if (updates.label !== undefined && !updates.label.trim()) return res.status(400).json({ error: 'Label cannot be empty.' });

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let currentTree = user.notesTree || [];

        // Find item and its siblings *before* potential update
        const originalItemSearchResult = findItemRecursive(currentTree, itemId);
        if (!originalItemSearchResult) return res.status(404).json({ error: 'Item not found.' });

        const { item: originalItem, parentArray: originalSiblings } = originalItemSearchResult;

        // Check for name conflict *if label is being changed*
        if (updates.label && updates.label.trim() !== originalItem.label) {
            const trimmedNewLabel = updates.label.trim();
            if (hasSiblingWithName(originalSiblings, trimmedNewLabel, itemId)) {
                return res.status(400).json({ error: `An item named "${trimmedNewLabel}" already exists in this location.` });
            }
        }


        // --- Modify the Tree in JS ---
        const updatedTree = updateItemInTree(currentTree, itemId, updates);

        // Check if the tree actually changed (updateItemInTree returns original if no change)
        if (updatedTree === currentTree) {
            // This might happen if the updates didn't change anything or only non-allowed fields were sent
            // Return the original item found
            return res.status(200).json(originalItem);
        }


        // --- Save Updated Tree ---
        user.notesTree = updatedTree;
        user.markModified('notesTree');
        const savedUser = await user.save();

        // Find the updated item in the saved tree to return it
        const updatedItemSearchResult = findItemRecursive(savedUser.notesTree, itemId);

        if (!updatedItemSearchResult) {
            console.error("Error finding updated item after save", itemId);
            return res.status(500).json({ error: 'Error retrieving updated item after save.' });
        }

        res.status(200).json(updatedItemSearchResult.item); // Return the updated item

    } catch (err) {
        console.error('Update Item Error:', err);
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

        let currentTree = user.notesTree || [];

        // Check if item exists before trying to delete
        const itemExists = findItemRecursive(currentTree, itemId);
        if (!itemExists) {
            // Item already deleted or never existed, arguably not an error for DELETE
            // return res.status(404).json({ error: 'Item not found.' });
            return res.status(200).json({ message: 'Item not found or already deleted.' });
        }

        // --- Modify the Tree in JS ---
        const updatedTree = deleteItemInTree(currentTree, itemId);

        // --- Save Updated Tree ---
        user.notesTree = updatedTree;
        user.markModified('notesTree');
        await user.save();

        res.status(200).json({ message: 'Item deleted successfully.' });

    } catch (err) {
        console.error('Delete Item Error:', err);
        res.status(500).json({ error: 'Server error deleting item.' });
    }
};

// Optional: Implement getItem if needed
// exports.getItem = async (req, res) => { ... };