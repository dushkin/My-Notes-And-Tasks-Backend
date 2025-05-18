// utils/backendTreeUtils.js
const { v4: uuidv4 } = require('uuid');

function sortItems(items) {
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

function deleteItemInTree(nodes, itemId) {
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

function updateItemInTree(nodes, itemId, updates) {
    if (!Array.isArray(nodes)) return nodes || [];
    if (!itemId || !updates || Object.keys(updates).length === 0) return nodes;

    let treeModified = false;
    const newNodes = nodes.map(item => {
        if (item.id === itemId) {
            const allowedUpdates = {};
            let itemChanged = false;
            if (updates.hasOwnProperty('label') && typeof updates.label === 'string') {
                const trimmedLabel = updates.label.trim();
                if (item.label !== trimmedLabel) {
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
            if (itemChanged) {
                treeModified = true;
                return { ...item, ...allowedUpdates };
            }
            return item;
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

function ensureServerSideIdsAndStructure(item) {
    const newItem = { ...item };

    // Always generate a new server-side ID for imported items and their children
    newItem.id = uuidv4();

    newItem.label = (typeof newItem.label === 'string' && newItem.label.trim())
        ? newItem.label.trim()
        : "Untitled";
    const validTypes = ['folder', 'note', 'task'];
    if (!validTypes.includes(newItem.type)) {
        newItem.type = (Array.isArray(newItem.children) && newItem.children.length > 0) ? 'folder' : 'note';
    }

    if (newItem.type === 'folder') {
        newItem.children = Array.isArray(newItem.children)
            ? newItem.children.map(child => ensureServerSideIdsAndStructure(child))
            : [];
        delete newItem.content;
        delete newItem.completed;
    } else if (newItem.type === 'note') {
        newItem.content = (typeof newItem.content === 'string') ? newItem.content : "";
        delete newItem.children;
        delete newItem.completed;
    } else if (newItem.type === 'task') {
        newItem.content = (typeof newItem.content === 'string') ? newItem.content : "";
        newItem.completed = typeof newItem.completed === 'boolean' ? newItem.completed : false;
        delete newItem.children;
    }
    return newItem;
}

module.exports = {
    sortItems,
    findItemRecursive,
    deleteItemInTree,
    updateItemInTree,
    hasSiblingWithName,
    ensureServerSideIdsAndStructure,
    uuidv4
};