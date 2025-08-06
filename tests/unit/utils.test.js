// tests/unit/utils.test.js
import mongoose from 'mongoose';
import { hashPassword, comparePassword } from '../../utils/hash.js';
import { generateAccessToken, verifyAccessToken, generateRefreshToken } from '../../utils/jwt.js';
import { 
  sortItems, 
  findItemRecursive, 
  hasSiblingWithName, 
  updateItemInTree 
} from '../../utils/backendTreeUtils.js';

describe('Unit Tests - Hash Utilities', () => {
  it('should hash and verify a password correctly', async () => {
    const plain = 'superSecure123!';
    const hashed = await hashPassword(plain);
    expect(typeof hashed).toBe('string');
    expect(hashed).not.toBe(plain);
    
    const isMatch = await comparePassword(plain, hashed);
    expect(isMatch).toBe(true);
    
    const isWrongMatch = await comparePassword('wrongPassword', hashed);
    expect(isWrongMatch).toBe(false);
  });

  it('should handle empty passwords', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });

  it('should handle null/undefined passwords', async () => {
    await expect(hashPassword(null)).rejects.toThrow();
    await expect(hashPassword(undefined)).rejects.toThrow();
  });
});

describe('Unit Tests - JWT Utilities', () => {
  const validUserId = new mongoose.Types.ObjectId().toString();

  it('should generate and verify an access token', () => {
    const token = generateAccessToken(validUserId);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    
    const decoded = verifyAccessToken(token);
    expect(decoded).toHaveProperty('user');
    expect(decoded.user).toHaveProperty('id', validUserId);
    expect(decoded).toHaveProperty('iat');
    expect(decoded).toHaveProperty('exp');
  });

  it('should generate a refresh token', () => {
    const token = generateRefreshToken(validUserId);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('should fail with invalid token', () => {
    expect(() => verifyAccessToken('invalid.token')).toThrow();
    expect(() => verifyAccessToken('')).toThrow();
    expect(() => verifyAccessToken(null)).toThrow();
  });

  it('should handle invalid user IDs', () => {
    expect(() => generateAccessToken('')).toThrow();
    expect(() => generateAccessToken(null)).toThrow();
    expect(() => generateAccessToken(undefined)).toThrow();
  });
});

describe('Unit Tests - Tree Utilities', () => {
  const dateNow = new Date().toISOString();
  const sampleItems = [
    { id: '1', label: 'Alpha', type: 'note', content: 'First note', createdAt: dateNow, updatedAt: dateNow },
    {
      id: '2', 
      label: 'Beta', 
      type: 'folder', 
      createdAt: dateNow, 
      updatedAt: dateNow, 
      children: [
        { id: '3', label: 'Gamma', type: 'note', content: 'Nested note', createdAt: dateNow, updatedAt: dateNow }
      ]
    },
    { id: '4', label: 'Delta', type: 'task', content: 'Task content', completed: false, createdAt: dateNow, updatedAt: dateNow }
  ];

  describe('sortItems', () => {
    it('should sort items correctly (folders first, then notes, then tasks, then alphabetically)', () => {
      const unsorted = [
        { id: 'a', label: 'Zeta Note', type: 'note', createdAt: "1", updatedAt: "1" },
        { id: 'b', label: 'Alpha Folder', type: 'folder', children: [], createdAt: "1", updatedAt: "1" },
        { id: 'c', label: 'Theta Task', type: 'task', completed: false, createdAt: "1", updatedAt: "1" },
        { id: 'd', label: 'Beta Note', type: 'note', createdAt: "1", updatedAt: "1" }
      ];
      
      const sorted = sortItems(unsorted);
      expect(sorted[0].type).toEqual('folder');
      expect(sorted[1].type).toEqual('note');
      expect(sorted[1].label).toEqual('Beta Note'); // Alphabetically first note
      expect(sorted[2].type).toEqual('note');
      expect(sorted[2].label).toEqual('Zeta Note');
      expect(sorted[3].type).toEqual('task');
    });

    it('should handle empty arrays', () => {
      expect(sortItems([])).toEqual([]);
    });

    it('should handle single item', () => {
      const singleItem = [{ id: '1', label: 'Solo', type: 'note' }];
      expect(sortItems(singleItem)).toEqual(singleItem);
    });
  });

  describe('findItemRecursive', () => {
    it('should find an item recursively', () => {
      const result = findItemRecursive(sampleItems, '3');
      expect(result).not.toBeNull();
      expect(result.item.label).toEqual('Gamma');
      expect(result.parent).toBeTruthy();
      expect(result.parent.id).toEqual('2');
    });

    it('should find root level items', () => {
      const result = findItemRecursive(sampleItems, '1');
      expect(result).not.toBeNull();
      expect(result.item.label).toEqual('Alpha');
      expect(result.parent).toBeNull();
    });

    it('should return null for non-existent items', () => {
      const result = findItemRecursive(sampleItems, 'non-existent');
      expect(result).toBeNull();
    });

    it('should handle empty tree', () => {
      const result = findItemRecursive([], '1');
      expect(result).toBeNull();
    });
  });

  describe('hasSiblingWithName', () => {
    const siblings = [
      { id: 'a1', label: 'Note A', type: 'note', createdAt: "1", updatedAt: "1" },
      { id: 'a2', label: 'Note B', type: 'note', createdAt: "1", updatedAt: "1" }
    ];

    it('should detect sibling name conflicts correctly (case-insensitive)', () => {
      expect(hasSiblingWithName(siblings, 'note a')).toBe(true);
      expect(hasSiblingWithName(siblings, 'NOTE A')).toBe(true);
      expect(hasSiblingWithName(siblings, 'Note A')).toBe(true);
      expect(hasSiblingWithName(siblings, 'note c')).toBe(false);
    });

    it('should exclude specified item from conflict check', () => {
      expect(hasSiblingWithName(siblings, 'Note B', 'a1')).toBe(true); // Different item with same name
      expect(hasSiblingWithName(siblings, 'Note B', 'a2')).toBe(false); // Same item, should be excluded
    });

    it('should handle empty siblings array', () => {
      expect(hasSiblingWithName([], 'Any Name')).toBe(false);
    });
  });

  describe('updateItemInTree', () => {
    it('should update an item in tree', () => {
      const updates = { label: 'Updated Alpha', content: 'Updated content' };
      const originalItem = sampleItems.find(i => i.id === '1');
      const originalTimestamp = originalItem.updatedAt;
      
      const newTree = updateItemInTree(sampleItems, '1', updates);
      const result = findItemRecursive(newTree, '1');
      
      expect(result.item.label).toEqual('Updated Alpha');
      expect(result.item.content).toEqual('Updated content');
      expect(result.item.updatedAt).not.toEqual(originalTimestamp);
      expect(new Date(result.item.updatedAt).getTime()).toBeGreaterThan(new Date(originalTimestamp).getTime());
    });

    it('should update nested items', () => {
      const updates = { label: 'Updated Gamma' };
      const newTree = updateItemInTree(sampleItems, '3', updates);
      const result = findItemRecursive(newTree, '3');
      
      expect(result.item.label).toEqual('Updated Gamma');
    });

    it('should return original tree if item not found', () => {
      const updates = { label: 'Updated' };
      const newTree = updateItemInTree(sampleItems, 'non-existent', updates);
      
      expect(newTree).toEqual(sampleItems);
    });

    it('should handle empty updates', () => {
      const newTree = updateItemInTree(sampleItems, '1', {});
      const result = findItemRecursive(newTree, '1');
      
      expect(result.item.label).toEqual('Alpha'); // Should remain unchanged
    });
  });
});