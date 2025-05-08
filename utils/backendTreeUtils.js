// utils/backendTreeUtils.js

const { v4: uuidv4 } = require('uuid'); // Use UUID for new item IDs

// --- Sorting Function (same as frontend) ---
function sortItems(items) {
    if (!Array.isArray(items)) return [];
    return [...items].sort((a, b) => {
        const typeA = a?.type ?? '';
        const typeB = b?.type ?? '';
        const labelA = a?.label ?? '';
        const labelB = b?.label ?? '';
        if (typeA === "folder" && typeB !== "folder") return -1;
        if (typeA !== "folder" && typeB === "folder") return 1;
        if (typeA === "note" && typeB === "task") return -1;
        if (typeA === "task" && typeB === "note") return 1;
        return labelA.localeCompare(labelB, undefined, { sensitivity: "base" });
    });
}

// --- Recursive Find Function ---
function findItemRecursive(nodes, itemId) {
    if (!Array.isArray(nodes) || !itemId) return null;
    for (const item of nodes) {
        if (item.id === itemId) return { item, parentArray: nodes }; // Return item and its container array
        if (item.type === "folder" && Array.isArray(item.children)) {
            const found = findItemRecursive(item.children, itemId);
            if (found) return found;
        }
    }
    return null;
}

// --- Find Parent Array and Index ---
function findParentArrayAndIndex(nodes, itemId) {
    if (!Array.isArray(nodes) || !itemId) return null;
    for (let i = 0; i < nodes.length; i++) {
        const item = nodes[i];
        if (item.id === itemId) return { parentArray: nodes, index: i };
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const found = findParentArrayAndIndex(item.children, itemId);
            if (found) return found;
        }
    }
    return null;
}

// --- Recursive Delete Function ---
function deleteItemInTree(nodes, itemId) {
    if (!Array.isArray(nodes) || !itemId) return nodes; // Return original if invalid input
    let itemDeleted = false;

    const filteredNodes = nodes.filter(item => {
        if (item.id === itemId) {
            itemDeleted = true;
            return false; // Exclude the item to be deleted
        }
        return true;
    });

    // If item was deleted at this level, return the filtered array
    if (itemDeleted) {
        return filteredNodes;
    }

    // Otherwise, recurse into children
    return filteredNodes.map(item => {
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = deleteItemInTree(item.children, itemId);
            // Only return new object if children changed
            if (updatedChildren !== item.children) {
                return { ...item, children: updatedChildren };
            }
        }
        return item; // Return unchanged item
    });
}

// --- Recursive Update Function ---
function updateItemInTree(nodes, itemId, updates) {
    if (!Array.isArray(nodes) || !itemId) return nodes;
    let itemUpdated = false;

    const updatedNodes = nodes.map(item => {
        if (item.id === itemId) {
            itemUpdated = true;
            // Create a new object with merged updates
            // Only allow specific fields to be updated for safety
            const allowedUpdates = {};
            if (updates.hasOwnProperty('label')) allowedUpdates.label = updates.label.trim();
            if (updates.hasOwnProperty('content') && (item.type === 'note' || item.type === 'task')) allowedUpdates.content = updates.content;
            if (updates.hasOwnProperty('completed') && item.type === 'task') allowedUpdates.completed = !!updates.completed; // Ensure boolean
            return { ...item, ...allowedUpdates };
        }

        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = updateItemInTree(item.children, itemId, updates);
            if (updatedChildren !== item.children) {
                // Ensure the parent object reference changes if children changed
                return { ...item, children: updatedChildren };
            }
        }
        return item; // Return unchanged item
    });

    // Return the updated array *only if* an item was actually modified
    return itemUpdated ? updatedNodes : nodes;
}


// --- Check for Sibling Name Conflict ---
function hasSiblingWithName(siblings, nameToCheck, excludeId = null) {
    if (!Array.isArray(siblings) || !nameToCheck) return false;
    const normalizedName = nameToCheck.trim().toLowerCase();
    if (!normalizedName) return false;
    return siblings.some(sibling =>
        sibling &&
        sibling.id !== excludeId &&
        sibling.label &&
        sibling.label.trim().toLowerCase() === normalizedName
    );
}

module.exports = {
    sortItems,
    findItemRecursive,
    findParentArrayAndIndex,
    deleteItemInTree,
    updateItemInTree,
    hasSiblingWithName,
    uuidv4 // Export UUID generator
};