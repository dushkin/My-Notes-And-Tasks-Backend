const { v4: uuidv4 } = require('uuid'); // Or your preferred UUID generation method

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

    let treeChanged = false;
    const processedNodes = nodes.map(item => {
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = deleteItemInTree(item.children, itemId);
            if (updatedChildren !== item.children) {
                treeChanged = true;
                return { ...item, children: updatedChildren };
            }
        }
        return item;
    });
    return treeChanged ? processedNodes : nodes;
}


// --- Recursive Update Function ---
function updateItemInTree(nodes, itemId, updates) {
    if (!Array.isArray(nodes)) {
        return nodes || [];
    }
    if (!itemId || !updates || Object.keys(updates).length === 0) {
        return nodes;
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
                console.log(`backendTreeUtils: -> Item ${item.id} matched, but no effective changes applied from updates.`);
                return item;
            }
        }

        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = updateItemInTree(item.children, itemId, updates);
            if (updatedChildren !== item.children) {
                treeModified = true;
                return { ...item, children: updatedChildren };
            }
        }
        return item;
    });
    return treeModified ? newNodes : nodes;
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

// --- Helper for ensuring server-side structure for imported tree (can be expanded) ---
function ensureServerSideIdsAndStructure(item) {
    const newItem = { ...item }; // Create a shallow copy to avoid modifying original import data directly

    // Ensure ID: If client sends 'client-' prefixed IDs or no ID, generate server ID.
    // If client sends a valid-looking UUID that isn't 'client-', we might trust it or still regenerate.
    // For simplicity here, if it looks like a temporary client ID or is missing, generate one.
    if (!newItem.id || typeof newItem.id !== 'string' || newItem.id.startsWith('client-')) {
        newItem.id = uuidv4();
    }

    // Ensure basic fields
    newItem.label = (typeof newItem.label === 'string' && newItem.label.trim()) ? newItem.label.trim() : "Untitled";
    const validTypes = ['folder', 'note', 'task'];
    if (!validTypes.includes(newItem.type)) {
        // Basic guess for type if invalid
        newItem.type = (Array.isArray(newItem.children) && newItem.children.length > 0) ? 'folder' : 'note';
    }

    if (newItem.type === 'folder') {
        newItem.children = Array.isArray(newItem.children)
            ? newItem.children.map(child => ensureServerSideIdsAndStructure(child)) // Recursive call
            : [];
        delete newItem.content; // Folders shouldn't have content
        delete newItem.completed; // Folders aren't completable
    } else if (newItem.type === 'note') {
        newItem.content = (typeof newItem.content === 'string') ? newItem.content : "";
        delete newItem.children; // Notes don't have children
        delete newItem.completed; // Notes aren't completable
    } else if (newItem.type === 'task') {
        newItem.content = (typeof newItem.content === 'string') ? newItem.content : "";
        newItem.completed = typeof newItem.completed === 'boolean' ? newItem.completed : false;
        delete newItem.children; // Tasks don't have children
    }
    return newItem;
}


module.exports = {
    sortItems,
    findItemRecursive,
    deleteItemInTree,
    updateItemInTree,
    hasSiblingWithName,
    ensureServerSideIdsAndStructure, // Export the new helper
    uuidv4
};