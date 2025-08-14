// ============================================================================
// BACKEND TREE UTILITIES
// ============================================================================
// Utilities for tree operations on the backend/server side

// ============================================================================
// IMPORTS
// ============================================================================
import { v4 as uuidv4_imported } from 'uuid';
import { sanitizeContent } from './contentSanitizer.js';

// ============================================================================
// EXPORTS AND CONSTANTS
// ============================================================================
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

export function findParentAndSiblings(nodes, itemId, parent = null) {
    if (!Array.isArray(nodes)) {
        return { parent: null, siblings: null, index: -1 };
    }
    for (let i = 0; i < nodes.length; i++) {
        const item = nodes[i];
        if (item.id === itemId) {
            return { parent, siblings: nodes, index: i };
        }
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const found = findParentAndSiblings(item.children, itemId, item);
            if (found.siblings) {
                return found;
            }
        }
    }
    return { parent: null, siblings: null, index: -1 };
}

export function deleteItemInTree(nodes, itemId) {
    if (!Array.isArray(nodes) || !itemId) return nodes;
    let itemFoundAndDeleted = false;
    const newNodes = nodes.filter(item => {
        if (item.id === itemId) {
            itemFoundAndDeleted = true;
            return false;
        }
        return true;
    });
    if (itemFoundAndDeleted) {
        return newNodes;
    }
    let treeChangedInChildren = false;
    const processedNodes = nodes.map(item => {
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = deleteItemInTree(item.children, itemId);
            if (updatedChildren !== item.children) {
                treeChangedInChildren = true;
                return { ...item, children: updatedChildren };
            }
        }
        return item;
    });
    return treeChangedInChildren ? processedNodes : nodes;
}

export function updateItemInTree(nodes, itemId, updates) {
    if (!Array.isArray(nodes) || !itemId || !updates || Object.keys(updates).length === 0) return nodes;
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
                const sanitizedContent = sanitizeContent(updates.content);
                if (item.content !== sanitizedContent) {
                    allowedUpdates.content = sanitizedContent;
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
                const newDirection = (updates.direction === 'rtl' || updates.direction === 'ltr') ? updates.direction : 'ltr';
                if (item.direction !== newDirection) {
                    allowedUpdates.direction = newDirection;
                    itemChanged = true;
                }
            }
            if (updates.hasOwnProperty('reminder')) {
                allowedUpdates.reminder = updates.reminder; // Can be object or null
                itemChanged = true;
            }

            if (itemChanged) {
                treeModified = true;
                allowedUpdates.updatedAt = new Date().toISOString();
                return { ...item, ...allowedUpdates };
            }
            return item;
        }
        if (item.type === 'folder' && Array.isArray(item.children)) {
            const updatedChildren = updateItemInTree(item.children, itemId, updates);
            if (updatedChildren !== item.children) {
                treeModified = true;
                return { ...item, children: updatedChildren, updatedAt: new Date().toISOString() };
            }
        }
        return item;
    });
    return treeModified ? newNodes : nodes;
}

export function hasSiblingWithName(siblings, nameToCheck, excludeId = null) {
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

export function ensureServerSideIdsAndStructure(item) {
    const newItem = { ...item };
    const now = new Date().toISOString();
    newItem.id = newItem.id && typeof newItem.id === 'string' &&
                 !newItem.id.startsWith('client-') && !newItem.id.startsWith('temp-')
                 ? newItem.id : uuidv4_imported();

    newItem.label = (typeof newItem.label === 'string' && newItem.label.trim())
        ? newItem.label.trim()
        : "Untitled";

    const validTypes = ['folder', 'note', 'task'];
    if (!validTypes.includes(newItem.type)) {
        newItem.type = (Array.isArray(newItem.children) && newItem.children.length > 0) ? 'folder' : 'note';
    }

    try {
        if (!newItem.createdAt || new Date(newItem.createdAt).toISOString() !== newItem.createdAt) {
            newItem.createdAt = now;
        }
    } catch (e) {
        newItem.createdAt = now;
    }
    newItem.updatedAt = now;

    if (newItem.type === 'folder') {
        newItem.children = Array.isArray(newItem.children)
            ? newItem.children.map(child => ensureServerSideIdsAndStructure(child))
            : [];
        delete newItem.content;
        delete newItem.completed;
        delete newItem.direction;
    } else if (newItem.type === 'note') {
        newItem.content = (typeof newItem.content === 'string') ? newItem.content : "";
        newItem.direction = (newItem.direction === 'rtl' || newItem.direction === 'ltr') ? newItem.direction : 'ltr';
        delete newItem.children;
        delete newItem.completed;
    } else if (newItem.type === 'task') {
        newItem.content = (typeof newItem.content === 'string') ? newItem.content : "";
        newItem.completed = typeof newItem.completed === 'boolean' ? newItem.completed : false;
        newItem.direction = (newItem.direction === 'rtl' || newItem.direction === 'ltr') ? newItem.direction : 'ltr';
        delete newItem.children;
    }
    return newItem;
}