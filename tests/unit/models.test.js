// tests/unit/models.test.js
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Task from '../../models/Task.js';
import RefreshToken from '../../models/refreshToken.js';
import { cleanupTestData } from '../helpers/testHelpers.js';
import { hashPassword, comparePassword } from '../../utils/hash.js';

describe('Unit Tests - User Model', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });
  
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('User Creation', () => {
    it('should create a user with valid data', async () => {
      const userData = {
        email: `test-${Date.now()}@example.com`,
        password: 'hashedPassword123'
      };

      const user = new User(userData);
      await user.save();

      expect(user._id).toBeDefined();
      expect(user.email).toBe(userData.email.toLowerCase());
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
    });

    it('should normalize email to lowercase', async () => {
      const timestamp = Date.now();
      const user = new User({
        email: `TEST-${timestamp}@EXAMPLE.COM`,
        password: 'password123'
      });
      await user.save();

      expect(user.email).toBe(`test-${timestamp}@example.com`);
    });

    it('should require email', async () => {
      const user = new User({ password: 'password123' });
      
      await expect(user.save()).rejects.toThrow(/email.*required/i);
    });

    it('should require valid email format', async () => {
      const user = new User({
        email: 'invalid-email',
        password: 'password123'
      });

      await expect(user.save()).rejects.toThrow(/valid email/i);
    });

    it('should require password', async () => {
      const user = new User({ email: 'test@example.com' });
      
      await expect(user.save()).rejects.toThrow(/password.*required/i);
    });

    it('should enforce unique email constraint', async () => {
      const email = `unique-${Date.now()}@example.com`;
      
      await new User({ email, password: 'password1' }).save();
      
      const duplicateUser = new User({ email, password: 'password2' });
      await expect(duplicateUser.save()).rejects.toThrow(/duplicate key error/i);
    });
  });

  describe('User Password Handling', () => {
    it('should hash password using utility function', async () => {
      const plainPassword = 'plainPassword123';
      const hashedPassword = await hashPassword(plainPassword);
      
      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe(plainPassword);
      expect(hashedPassword.length).toBeGreaterThan(20);
    });

    it('should compare passwords correctly', async () => {
      const plainPassword = 'testPassword123';
      const hashedPassword = await hashPassword(plainPassword);
      
      const user = new User({
        email: `test-${Date.now()}@example.com`,
        password: hashedPassword
      });
      await user.save();

      const isMatch = await comparePassword(plainPassword, hashedPassword);
      expect(isMatch).toBe(true);

      const isWrongMatch = await comparePassword('wrongPassword', hashedPassword);
      expect(isWrongMatch).toBe(false);
    });
  });

  describe('User Indexes', () => {
    it('should have email index', async () => {
      const indexes = await User.collection.getIndexes();
      const emailIndex = Object.keys(indexes).find(key => key.includes('email'));
      expect(emailIndex).toBeDefined();
    });
  });
});

describe('Unit Tests - Task Model', () => {
  let testUserId;

  beforeEach(async () => {
    const user = new User({
      email: `test-${Date.now()}@example.com`,
      password: 'password123'
    });
    await user.save();
    testUserId = user._id;
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('Task Creation', () => {
    it('should create a task with valid data', async () => {
      const taskData = {
        title: 'Test Task',
        type: 'note',
        content: '<p>Test content</p>',
        userId: testUserId
      };

      const task = new Task(taskData);
      await task.save();

      expect(task._id).toBeDefined();
      expect(task.title).toBe(taskData.title);
      expect(task.type).toBe(taskData.type);
      expect(task.content).toBe(taskData.content);
      expect(task.userId.toString()).toBe(testUserId.toString());
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
    });

    it('should create different task types', async () => {
      const types = ['note', 'task']; // Only valid types for this model
      
      for (const type of types) {
        const task = new Task({
          title: `Test ${type}`,
          type: type,
          userId: testUserId
        });
        await task.save();
        
        expect(task.type).toBe(type);
      }
    });

    it('should handle completed field for tasks', async () => {
      const task = new Task({
        title: 'Completed Task',
        type: 'task',
        completed: true,
        userId: testUserId
      });
      await task.save();

      expect(task.completed).toBe(true);
    });

    it('should require title', async () => {
      const task = new Task({
        type: 'note',
        userId: testUserId
      });

      await expect(task.save()).rejects.toThrow(/title.*required/i);
    });

    it('should use default type when not specified', async () => {
      const task = new Task({
        title: 'Test Task',
        userId: testUserId
      });
      await task.save();

      expect(task.type).toBe('task'); // Default value
    });

    it('should require userId', async () => {
      const task = new Task({
        title: 'Test Task',
        type: 'note'
      });

      await expect(task.save()).rejects.toThrow(/userId.*required/i);
    });

    it('should validate type enum', async () => {
      const task = new Task({
        title: 'Test Task',
        type: 'invalid-type',
        userId: testUserId
      });

      await expect(task.save()).rejects.toThrow(/invalid-type.*not a valid enum/i);
    });
  });

  describe('Task Hierarchy', () => {
    it('should support parent-child relationships', async () => {
      const parent = new Task({
        title: 'Parent Task',
        type: 'task', // Use valid type
        userId: testUserId
      });
      await parent.save();

      const child = new Task({
        title: 'Child Task',
        type: 'note',
        parentId: parent._id,
        userId: testUserId
      });
      await child.save();

      expect(child.parentId.toString()).toBe(parent._id.toString());
    });

    it('should handle deep nesting', async () => {
      const grandparent = new Task({
        title: 'Grandparent',
        type: 'task', // Use valid type
        userId: testUserId
      });
      await grandparent.save();

      const parent = new Task({
        title: 'Parent',
        type: 'task', // Use valid type
        parentId: grandparent._id,
        userId: testUserId
      });
      await parent.save();

      const child = new Task({
        title: 'Child',
        type: 'note',
        parentId: parent._id,
        userId: testUserId
      });
      await child.save();

      expect(child.parentId.toString()).toBe(parent._id.toString());
      expect(parent.parentId.toString()).toBe(grandparent._id.toString());
    });
  });

  describe('Task Indexes', () => {
    it('should have default _id index', async () => {
      const indexes = await Task.collection.getIndexes();
      const defaultIndex = Object.keys(indexes).find(key => key.includes('_id'));
      expect(defaultIndex).toBeDefined();
    });
  });
});

describe('Unit Tests - RefreshToken Model', () => {
  let testUserId;

  beforeEach(async () => {
    const user = new User({
      email: `test-${Date.now()}@example.com`,
      password: 'password123'
    });
    await user.save();
    testUserId = user._id;
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('RefreshToken Creation', () => {
    it('should create a refresh token with valid data', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
      const tokenData = {
        token: 'valid-refresh-token',
        userId: testUserId,
        expiresAt: expiresAt
      };

      const refreshToken = new RefreshToken(tokenData);
      await refreshToken.save();

      expect(refreshToken._id).toBeDefined();
      expect(refreshToken.token).toBe(tokenData.token);
      expect(refreshToken.userId.toString()).toBe(testUserId.toString());
      expect(refreshToken.expiresAt).toEqual(expiresAt);
      expect(refreshToken.createdAt).toBeDefined();
    });

    it('should require token', async () => {
      const refreshToken = new RefreshToken({
        userId: testUserId
      });

      await expect(refreshToken.save()).rejects.toThrow(/token.*required/i);
    });

    it('should require userId', async () => {
      const refreshToken = new RefreshToken({
        token: 'test-token'
      });

      await expect(refreshToken.save()).rejects.toThrow(/userId.*required/i);
    });

    it('should enforce unique token constraint', async () => {
      const token = 'unique-token';
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      await new RefreshToken({ token, userId: testUserId, expiresAt }).save();
      
      const duplicateToken = new RefreshToken({ token, userId: testUserId, expiresAt });
      await expect(duplicateToken.save()).rejects.toThrow(/duplicate key error/i);
    });
  });

  describe('RefreshToken Expiration', () => {
    it('should have TTL index for automatic expiration', async () => {
      const indexes = await RefreshToken.collection.getIndexes();
      const ttlIndex = Object.keys(indexes).find(key => key.includes('expiresAt'));
      expect(ttlIndex).toBeDefined();
    });
  });
});