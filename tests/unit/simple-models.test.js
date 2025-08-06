// Simple model tests that work with actual model structure
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Task from '../../models/Task.js';
import { cleanupTestData } from '../helpers/testHelpers.js';
import { hashPassword, comparePassword } from '../../utils/hash.js';

describe('Simple Model Tests', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('User Model Basic Tests', () => {
    it('should create a user with valid data', async () => {
      const hashedPassword = await hashPassword('password123');
      const userData = {
        email: `user-${Date.now()}@test.com`,
        password: hashedPassword
      };

      const user = new User(userData);
      await user.save();

      expect(user._id).toBeDefined();
      expect(user.email).toBe(userData.email);
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
    });

    it('should require email and password', async () => {
      const user = new User({});
      
      await expect(user.save()).rejects.toThrow(/required/i);
    });

    it('should hash and compare passwords', async () => {
      const plainPassword = 'myTestPassword123';
      const hashedPassword = await hashPassword(plainPassword);
      
      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe(plainPassword);
      
      const isMatch = await comparePassword(plainPassword, hashedPassword);
      expect(isMatch).toBe(true);
      
      const isWrongMatch = await comparePassword('wrongPassword', hashedPassword);
      expect(isWrongMatch).toBe(false);
    });
  });

  describe('Task Model Basic Tests', () => {
    let testUserId;

    beforeEach(async () => {
      const hashedPassword = await hashPassword('password123');
      const user = new User({
        email: `taskuser-${Date.now()}@test.com`,
        password: hashedPassword
      });
      await user.save();
      testUserId = user._id;
    });

    it('should create a task with valid data', async () => {
      const taskData = {
        title: 'Test Task',
        content: 'This is a test task',
        userId: testUserId
      };

      const task = new Task(taskData);
      await task.save();

      expect(task._id).toBeDefined();
      expect(task.title).toBe(taskData.title);
      expect(task.content).toBe(taskData.content);
      expect(task.userId.toString()).toBe(testUserId.toString());
      expect(task.completed).toBe(false); // Default value
      expect(task.type).toBe('task'); // Default value
    });

    it('should create different task types', async () => {
      const noteData = {
        title: 'Test Note',
        type: 'note',
        userId: testUserId
      };

      const note = new Task(noteData);
      await note.save();

      expect(note.type).toBe('note');
    });

    it('should require title and userId', async () => {
      const task = new Task({});
      
      await expect(task.save()).rejects.toThrow(/required/i);
    });

    it('should validate type enum', async () => {
      const task = new Task({
        title: 'Test Task',
        type: 'invalid-type',
        userId: testUserId
      });

      await expect(task.save()).rejects.toThrow(/invalid-type.*not a valid enum/i);
    });

    it('should handle completed field', async () => {
      const task = new Task({
        title: 'Completed Task',
        completed: true,
        userId: testUserId
      });
      await task.save();

      expect(task.completed).toBe(true);
    });

    it('should support parent-child relationships', async () => {
      const parent = new Task({
        title: 'Parent Task',
        userId: testUserId
      });
      await parent.save();

      const child = new Task({
        title: 'Child Task',
        parentId: parent._id,
        userId: testUserId
      });
      await child.save();

      expect(child.parentId.toString()).toBe(parent._id.toString());
    });

    it('should support reminders', async () => {
      const reminderDate = new Date(Date.now() + 60000); // 1 minute from now
      
      const task = new Task({
        title: 'Task with reminder',
        userId: testUserId,
        reminder: {
          dateTime: reminderDate,
          enabled: true
        }
      });
      await task.save();

      expect(task.reminder).toBeDefined();
      expect(task.reminder.dateTime).toEqual(reminderDate);
      expect(task.reminder.enabled).toBe(true);
    });
  });

  describe('MongoDB Connection', () => {
    it('should be connected to test database', () => {
      expect(mongoose.connection.readyState).toBe(1); // Connected
      expect(mongoose.connection.name).toContain('test'); // Test database
    });

    it('should handle basic queries', async () => {
      const userCount = await User.countDocuments();
      expect(typeof userCount).toBe('number');
      expect(userCount).toBeGreaterThanOrEqual(0);
    });
  });
});