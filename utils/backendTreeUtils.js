// utils/backendTreeUtils.js

const { v4: uuidv4 } = require('uuid'); // Assuming you use this for new item IDs elsewhere

// --- Sorting Function (consistent with frontend if possible) ---
function sortItems(items) {
    if (!Array.isArray(items)) {
        // console.warn("sortItems: called with non-array, returning []. Input:", items);
        return [];
    }
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

// --- Recursive Find Function (returns item and its direct parent array) ---
function findItemRecursive(nodes, itemId) {
    if (!Array.isArray(nodes) || !itemId) return null;
    for (const item of nodes) {
        if (item.id === itemId) return { item, parentArray: nodes };
        if (item.type === "folder" && Array.isArray(item.children)) {
            const found = findItemRecursive(item.children, itemId);
            if (found) return found;
        }
    }
    return null;
}

// --- Recursive Delete Function ---
function deleteItemInTree(nodes, itemId) {
    if (!Array.isArray(nodes) || !itemId) return nodes;

    let itemFoundAndDeleted = false;
    const newNodes = nodes.filter(item => {
        if (item.id === itemId) {
            itemFoundAndDeleted = true;
            return false; // Exclude this item
        }
        return true;
    });

    if (itemFoundAndDeleted) {
        return newNodes; // Item was at this level
    }

    // If not deleted at this level, recurse and map
    let treeChanged = false;
    const processedNodes = nodes.map(item => {
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = deleteItemInTree(item.children, itemId);
            if (updatedChildren !== item.children) { // Check if children array reference changed
                treeChanged = true;
                return { ...item, children: updatedChildren };
            }
        }
        return item;
    });
    return treeChanged ? processedNodes : nodes; // Return new array only if changes were made
}


// --- Recursive Update Function ---
// Ensures new object references are created for modified items and their ancestors
function updateItemInTree(nodes, itemId, updates) {
    if (!Array.isArray(nodes)) {
        // console.warn("updateItemInTree: received non-array 'nodes', returning original (or [] if !nodes). Input:", nodes);
        return nodes || []; // Return original or empty array if nodes is null/undefined
    }
    if (!itemId || !updates || Object.keys(updates).length === 0) {
        // console.log("updateItemInTree: No itemId or no updates provided. Returning original nodes.");
        return nodes; // No actual update to perform or no item to target
    }

    let treeModified = false;

    const newNodes = nodes.map(item => {
        if (item.id === itemId) {
            console.log(`backendTreeUtils: Matched item ${itemId}. Original type: '${item.type}'. Received updates:`, JSON.stringify(updates));
            const allowedUpdates = {};
            let itemChanged = false;

            if (updates.hasOwnProperty('label') && typeof updates.label === 'string') {
                const trimmedLabel = updates.label.trim();
                if (item.label !== trimmedLabel) {
                    allowedUpdates.label = trimmedLabel;
                    console.log(`backendTreeUtils: -> Applying label: "${allowedUpdates.label}"`);
                    itemChanged = true;
                }
            }

            if (updates.hasOwnProperty('content') && (item.type === 'note' || item.type === 'task')) {
                // Ensure content is not undefined, default to empty string if necessary
                const newContent = updates.content !== undefined ? updates.content : "";
                if (item.content !== newContent) {
                    allowedUpdates.content = newContent;
                    console.log(`backendTreeUtils: -> Applying content for type '${item.type}': "${String(newContent).substring(0, 50)}..."`);
                    itemChanged = true;
                }
            } else if (updates.hasOwnProperty('content')) {
                console.log(`backendTreeUtils: -> Content update for ${item.id} SKIPPED. Item type is '${item.type}'.`);
            }

            if (updates.hasOwnProperty('completed') && item.type === 'task') {
                const newCompleted = !!updates.completed;
                if (item.completed !== newCompleted) {
                    allowedUpdates.completed = newCompleted;
                    console.log(`backendTreeUtils: -> Applying completed: ${allowedUpdates.completed}`);
                    itemChanged = true;
                }
            }

            if (itemChanged) {
                treeModified = true;
                const updatedItem = { ...item, ...allowedUpdates };
                console.log(`backendTreeUtils: -> Item ${item.id} after merge:`, JSON.stringify(updatedItem, null, 2).substring(0, 200) + "...");
                return updatedItem;
            } else {
                // No actual change to this item's properties based on 'updates'
                console.log(`backendTreeUtils: -> Item ${item.id} matched, but no effective changes applied from updates.`);
                return item; // Return original item reference if no valid updates were applied
            }
        }

        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = updateItemInTree(item.children, itemId, updates);
            if (updatedChildren !== item.children) { // Check if children array reference changed
                treeModified = true;
                return { ...item, children: updatedChildren };
            }
        }
        return item; // Return original item if not matched and not a folder with changed children
    });

    // Only return a new array reference if a modification actually happened anywhere in the tree
    return treeModified ? newNodes : nodes;
}


// --- Check for Sibling Name Conflict ---
function hasSiblingWithName(siblings, nameToCheck, excludeId = null) {
    if (!Array.isArray(siblings) || !nameToCheck) return false;
    const normalizedName = nameToCheck.trim().toLowerCase();
    if (!normalizedName) return false; // Empty name cannot conflict
    return siblings.some(sibling =>
        sibling &&
        sibling.id !== excludeId && // Don't compare item with itself if excludeId is given (for rename)
        sibling.label &&
        sibling.label.trim().toLowerCase() === normalizedName
    );
}

module.exports = {
    sortItems,
    findItemRecursive,
    // findParentArrayAndIndex, // Not strictly needed by the controller if findItemRecursive returns parentArray
    deleteItemInTree,
    updateItemInTree,
    hasSiblingWithName,
    uuidv4 // If you use it for creating items; ensure it's consistent if IDs come from client too
};