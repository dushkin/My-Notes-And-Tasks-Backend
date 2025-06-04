// utils/backendTreeUtils.js
import { v4 as uuidv4_imported } from 'uuid';

// Re-export uuidv4 if it's intended to be part of this module's public API
// and used by other modules importing from backendTreeUtils.js
export const uuidv4 = uuidv4_imported;

export function sortItems(items) {
    if (!Array.isArray(items)) {
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

export function findItemRecursive(nodes, itemId) {
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

export function deleteItemInTree(nodes, itemId) {
    if (!Array.isArray(nodes) || !itemId) return nodes; // Return original if not an array or no itemId
    let itemFoundAndDeleted = false;
    const newNodes = nodes.filter(item => {
        if (item.id === itemId) {
            itemFoundAndDeleted = true;
            return false; // Exclude the item
        }
        return true;
    });

    // If item was found and deleted at the current level, return the new array
    if (itemFoundAndDeleted) {
        return newNodes;
    }

    // If not found at current level, recurse into children of folders
    // and map to new array only if a child's structure changes
    let treeChangedInChildren = false;
    const processedNodes = nodes.map(item => {
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = deleteItemInTree(item.children, itemId);
            if (updatedChildren !== item.children) { // Check if children array actually changed
                treeChangedInChildren = true;
                return { ...item, children: updatedChildren };
            }
        }
        return item;
    });

    return treeChangedInChildren ? processedNodes : nodes; // Return original array if no changes in children
}


export function updateItemInTree(nodes, itemId, updates) {
    if (!Array.isArray(nodes)) return nodes || [];
    if (!itemId || !updates || Object.keys(updates).length === 0) return nodes;

    let treeModified = false;
    const newNodes = nodes.map(item => {
        if (item.id === itemId) {
            const allowedUpdates = {};
            let itemChanged = false;

            if (updates.hasOwnProperty('label') && typeof updates.label === 'string') {
                const trimmedLabel = updates.label.trim();
                if (item.label !== trimmedLabel && trimmedLabel.length > 0) {
                    allowedUpdates.label = trimmedLabel;
                    itemChanged = true;
                }
            }
            if (updates.hasOwnProperty('content') && (item.type === 'note' || item.type === 'task')) {
                const newContent = updates.content !== undefined ? updates.content : "";
                if (item.content !== newContent) {
                    allowedUpdates.content = newContent;
                    itemChanged = true;
                }
            }
            if (updates.hasOwnProperty('completed') && item.type === 'task') {
                const newCompleted = !!updates.completed;
                if (item.completed !== newCompleted) {
                    allowedUpdates.completed = newCompleted;
                    itemChanged = true;
                }
            }
            if (updates.hasOwnProperty('direction') && (item.type === 'note' || item.type === 'task')) {
                const newDirection = (updates.direction === 'rtl' || updates.direction === 'ltr') ? updates.direction : (item.direction || 'ltr');
                if (item.direction !== newDirection) {
                    allowedUpdates.direction = newDirection;
                    itemChanged = true;
                }
            }

            if (itemChanged) {
                treeModified = true;
                allowedUpdates.updatedAt = new Date().toISOString(); // Update timestamp
                return { ...item, ...allowedUpdates };
            }
            return item; // No valid updates for this item
        }
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = updateItemInTree(item.children, itemId, updates);
            if (updatedChildren !== item.children) { // Check if children array actually changed
                treeModified = true;
                return { ...item, children: updatedChildren };
            }
        }
        return item;
    });
    return treeModified ? newNodes : nodes; // Return original array if no changes
}


export function hasSiblingWithName(siblings, nameToCheck, excludeId = null) {
    if (!Array.isArray(siblings) || !nameToCheck) return false;
    const normalizedName = nameToCheck.trim().toLowerCase();
    if (!normalizedName) return false; // Empty name after trim doesn't conflict
    return siblings.some(sibling =>
        sibling &&
        sibling.id !== excludeId &&
        sibling.label &&
        sibling.label.trim().toLowerCase() === normalizedName
    );
}

export function ensureServerSideIdsAndStructure(item) {
    const newItem = { ...item };
    const now = new Date().toISOString();

    // Ensure ID exists and is a valid server-side ID (UUID) or generate one
    newItem.id = newItem.id && typeof newItem.id === 'string' &&
                 !newItem.id.startsWith('client-') && !newItem.id.startsWith('temp-') // Basic check for client-side IDs
                 ? newItem.id : uuidv4_imported(); // Use the imported uuid

    newItem.label = (typeof newItem.label === 'string' && newItem.label.trim())
        ? newItem.label.trim()
        : "Untitled";

    const validTypes = ['folder', 'note', 'task'];
    if (!validTypes.includes(newItem.type)) {
        newItem.type = (Array.isArray(newItem.children) && newItem.children.length > 0) ? 'folder' : 'note';
    }

    // Ensure timestamps are valid ISO strings or set them
    try {
        if (!newItem.createdAt || new Date(newItem.createdAt).toISOString() !== newItem.createdAt) {
            newItem.createdAt = now;
        }
    } catch (e) {
        newItem.createdAt = now;
    }
    newItem.updatedAt = now; // Always set/update updatedAt on server processing

    if (newItem.type === 'folder') {
        newItem.children = Array.isArray(newItem.children)
            ? newItem.children.map(child => ensureServerSideIdsAndStructure(child)) // Recurse
            : [];
        delete newItem.content; // Folders don't have content/completed/direction
        delete newItem.completed;
        delete newItem.direction;
    } else if (newItem.type === 'note') {
        newItem.content = (typeof newItem.content === 'string') ? newItem.content : "";
        newItem.direction = (newItem.direction === 'rtl' || newItem.direction === 'ltr') ? newItem.direction : 'ltr';
        delete newItem.children; // Notes don't have children/completed
        delete newItem.completed;
    } else if (newItem.type === 'task') {
        newItem.content = (typeof newItem.content === 'string') ? newItem.content : "";
        newItem.completed = typeof newItem.completed === 'boolean' ? newItem.completed : false;
        newItem.direction = (newItem.direction === 'rtl' || newItem.direction === 'ltr') ? newItem.direction : 'ltr';
        delete newItem.children; // Tasks don't have children
    }
    return newItem;
}