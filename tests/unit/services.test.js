// tests/unit/services.test.js
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Task from '../../models/Task.js';
import PushSubscription from '../../models/PushSubscription.js';
import { cleanupTestData, createTestUser, createTestItem } from '../helpers/testHelpers.js';

// Mock external dependencies
jest.mock('web-push', () => ({
  sendNotification: jest.fn().mockResolvedValue({ statusCode: 200 }),
  setVapidDetails: jest.fn()
}));

jest.mock('firebase-admin', () => ({
  messaging: () => ({
    send: jest.fn().mockResolvedValue({ messageId: 'mock-message-id' })
  }),
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn()
  }
}));

// Import services after mocking
import PushNotificationService from '../../services/pushNotificationService.js';
import DeviceSyncService from '../../services/deviceSyncService.js';
import ReminderService from '../../services/reminderService.js';

describe('Unit Tests - Push Notification Service', () => {
  let testUserId;
  let testUser;

  beforeEach(async () => {
    const { user } = await createTestUser(`pushtest-${Date.now()}@test.com`);
    testUser = user;
    testUserId = user._id;
  });

  afterEach(async () => {
    await cleanupTestData();
    jest.clearAllMocks();
  });

  describe('subscribeUser', () => {
    it('should create a new push subscription', async () => {
      const subscriptionData = {
        endpoint: 'https://example.com/push',
        keys: {
          p256dh: 'test-p256dh-key',
          auth: 'test-auth-key'
        }
      };

      const result = await PushNotificationService.subscribeUser(
        testUserId, 
        subscriptionData
      );

      expect(result).toBeDefined();
      expect(result.userId.toString()).toBe(testUserId.toString());
      expect(result.endpoint).toBe(subscriptionData.endpoint);

      // Verify subscription was saved to database
      const savedSubscription = await PushSubscription.findOne({ userId: testUserId });
      expect(savedSubscription).toBeTruthy();
      expect(savedSubscription.endpoint).toBe(subscriptionData.endpoint);
    });

    it('should update existing subscription for user', async () => {
      const initialSubscription = {
        endpoint: 'https://example.com/push/old',
        keys: { p256dh: 'old-key', auth: 'old-auth' }
      };

      const newSubscription = {
        endpoint: 'https://example.com/push/new',
        keys: { p256dh: 'new-key', auth: 'new-auth' }
      };

      // Create initial subscription
      await PushNotificationService.subscribeUser(testUserId, initialSubscription);
      
      // Update with new subscription
      const result = await PushNotificationService.subscribeUser(testUserId, newSubscription);

      expect(result.endpoint).toBe(newSubscription.endpoint);

      // Verify only one subscription exists
      const subscriptions = await PushSubscription.find({ userId: testUserId });
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].endpoint).toBe(newSubscription.endpoint);
    });

    it('should handle invalid subscription data', async () => {
      const invalidSubscription = {
        endpoint: '', // Invalid empty endpoint
        keys: { p256dh: 'key', auth: 'auth' }
      };

      await expect(
        PushNotificationService.subscribeUser(testUserId, invalidSubscription)
      ).rejects.toThrow();
    });
  });

  describe('unsubscribeUser', () => {
    beforeEach(async () => {
      const subscriptionData = {
        endpoint: 'https://example.com/push',
        keys: { p256dh: 'test-key', auth: 'test-auth' }
      };
      await PushNotificationService.subscribeUser(testUserId, subscriptionData);
    });

    it('should remove push subscription for user', async () => {
      const result = await PushNotificationService.unsubscribeUser(testUserId);
      expect(result).toBe(true);

      // Verify subscription was removed
      const subscription = await PushSubscription.findOne({ userId: testUserId });
      expect(subscription).toBeNull();
    });

    it('should handle unsubscribing non-existent subscription', async () => {
      const fakeUserId = new mongoose.Types.ObjectId();
      const result = await PushNotificationService.unsubscribeUser(fakeUserId);
      expect(result).toBe(false);
    });
  });

  describe('sendNotification', () => {
    let subscription;

    beforeEach(async () => {
      const subscriptionData = {
        endpoint: 'https://example.com/push',
        keys: { p256dh: 'test-key', auth: 'test-auth' }
      };
      subscription = await PushNotificationService.subscribeUser(testUserId, subscriptionData);
    });

    it('should send push notification to user', async () => {
      const webPush = require('web-push');
      
      const notification = {
        title: 'Test Notification',
        body: 'This is a test notification',
        data: { taskId: 'test-task-id' }
      };

      const result = await PushNotificationService.sendNotification(
        testUserId, 
        notification
      );

      expect(result.success).toBe(true);
      expect(webPush.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: subscription.endpoint
        }),
        expect.stringContaining('Test Notification')
      );
    });

    it('should handle sending to non-existent user', async () => {
      const fakeUserId = new mongoose.Types.ObjectId();
      const notification = {
        title: 'Test',
        body: 'Test body'
      };

      const result = await PushNotificationService.sendNotification(
        fakeUserId, 
        notification
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('subscription not found');
    });

    it('should handle push service errors', async () => {
      const webPush = require('web-push');
      webPush.sendNotification.mockRejectedValueOnce(new Error('Push service error'));

      const notification = {
        title: 'Test',
        body: 'Test body'
      };

      const result = await PushNotificationService.sendNotification(
        testUserId, 
        notification
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Push service error');
    });
  });
});

describe('Unit Tests - Device Sync Service', () => {
  let testUserId;
  let testItems;

  beforeEach(async () => {
    const { user } = await createTestUser(`synctest-${Date.now()}@test.com`);
    testUserId = user._id;
    
    // Create test items
    testItems = await Promise.all([
      createTestItem(testUserId, { label: 'Item 1', type: 'note' }),
      createTestItem(testUserId, { label: 'Item 2', type: 'task', completed: false }),
      createTestItem(testUserId, { label: 'Folder 1', type: 'folder' })
    ]);
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('getLastSyncTimestamp', () => {
    it('should return null for user with no sync history', async () => {
      const timestamp = await DeviceSyncService.getLastSyncTimestamp(testUserId, 'device1');
      expect(timestamp).toBeNull();
    });

    it('should store and retrieve sync timestamp', async () => {
      const deviceId = 'test-device-1';
      const syncTime = new Date();

      await DeviceSyncService.updateLastSync(testUserId, deviceId, syncTime);
      
      const retrievedTime = await DeviceSyncService.getLastSyncTimestamp(testUserId, deviceId);
      expect(retrievedTime).toEqual(syncTime);
    });
  });

  describe('getItemsModifiedSince', () => {
    it('should return all items when no timestamp provided', async () => {
      const items = await DeviceSyncService.getItemsModifiedSince(testUserId);
      expect(items).toHaveLength(3);
    });

    it('should return only items modified after timestamp', async () => {
      const baseTime = new Date();
      
      // Update one item after base time
      await Task.findByIdAndUpdate(testItems[0]._id, {
        label: 'Updated Item 1',
        updatedAt: new Date(baseTime.getTime() + 1000)
      });

      const items = await DeviceSyncService.getItemsModifiedSince(testUserId, baseTime);
      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('Updated Item 1');
    });

    it('should return empty array when no items modified since timestamp', async () => {
      const futureTime = new Date(Date.now() + 60000); // 1 minute in future
      const items = await DeviceSyncService.getItemsModifiedSince(testUserId, futureTime);
      expect(items).toHaveLength(0);
    });
  });

  describe('mergeSyncData', () => {
    it('should merge client changes with server state', async () => {
      const clientChanges = [
        {
          id: testItems[0]._id.toString(),
          label: 'Updated from client',
          content: '<p>Client update</p>',
          updatedAt: new Date(Date.now() + 5000) // Newer than server
        }
      ];

      const result = await DeviceSyncService.mergeSyncData(testUserId, clientChanges);
      
      expect(result.conflicts).toHaveLength(0);
      expect(result.merged).toHaveLength(1);

      // Verify item was updated in database
      const updatedItem = await Task.findById(testItems[0]._id);
      expect(updatedItem.label).toBe('Updated from client');
    });

    it('should detect conflicts when server item is newer', async () => {
      // Update server item first
      await Task.findByIdAndUpdate(testItems[0]._id, {
        label: 'Updated on server',
        updatedAt: new Date(Date.now() + 5000)
      });

      const clientChanges = [
        {
          id: testItems[0]._id.toString(),
          label: 'Updated from client',
          updatedAt: new Date(Date.now() + 1000) // Older than server
        }
      ];

      const result = await DeviceSyncService.mergeSyncData(testUserId, clientChanges);
      
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].id).toBe(testItems[0]._id.toString());
    });

    it('should create new items from client', async () => {
      const newItemData = {
        label: 'New client item',
        type: 'note',
        content: '<p>Created on client</p>',
        clientId: 'client-temp-id-1'
      };

      const result = await DeviceSyncService.mergeSyncData(testUserId, [newItemData]);
      
      expect(result.merged).toHaveLength(1);
      expect(result.merged[0].label).toBe('New client item');

      // Verify item was created in database
      const createdItem = await Task.findById(result.merged[0].id);
      expect(createdItem).toBeTruthy();
      expect(createdItem.label).toBe('New client item');
    });
  });
});

describe('Unit Tests - Reminder Service', () => {
  let testUserId;
  let testTask;

  beforeEach(async () => {
    const { user } = await createTestUser(`remindertest-${Date.now()}@test.com`);
    testUserId = user._id;
    
    testTask = await createTestItem(testUserId, {
      label: 'Task with reminder',
      type: 'task',
      completed: false
    });
  });

  afterEach(async () => {
    await cleanupTestData();
    jest.clearAllMocks();
  });

  describe('scheduleReminder', () => {
    it('should schedule a reminder for a task', async () => {
      const reminderTime = new Date(Date.now() + 60000); // 1 minute from now
      
      const result = await ReminderService.scheduleReminder(
        testTask._id,
        testUserId,
        reminderTime
      );

      expect(result).toBeDefined();
      expect(result.taskId.toString()).toBe(testTask._id.toString());
      expect(result.userId.toString()).toBe(testUserId.toString());
      expect(result.scheduledFor).toEqual(reminderTime);
      expect(result.status).toBe('scheduled');
    });

    it('should not allow scheduling reminders for past times', async () => {
      const pastTime = new Date(Date.now() - 60000); // 1 minute ago
      
      await expect(
        ReminderService.scheduleReminder(testTask._id, testUserId, pastTime)
      ).rejects.toThrow(/cannot be in the past/i);
    });

    it('should not allow scheduling reminders for completed tasks', async () => {
      // Mark task as completed
      await Task.findByIdAndUpdate(testTask._id, { completed: true });
      
      const futureTime = new Date(Date.now() + 60000);
      
      await expect(
        ReminderService.scheduleReminder(testTask._id, testUserId, futureTime)
      ).rejects.toThrow(/completed task/i);
    });
  });

  describe('cancelReminder', () => {
    let reminderId;

    beforeEach(async () => {
      const reminderTime = new Date(Date.now() + 60000);
      const reminder = await ReminderService.scheduleReminder(
        testTask._id,
        testUserId,
        reminderTime
      );
      reminderId = reminder._id;
    });

    it('should cancel a scheduled reminder', async () => {
      const result = await ReminderService.cancelReminder(reminderId, testUserId);
      expect(result).toBe(true);

      // Verify reminder status was updated
      const reminder = await Task.findById(reminderId);
      // Note: This assumes reminders are stored as part of tasks or in separate collection
      // Adjust based on your actual implementation
    });

    it('should handle canceling non-existent reminder', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const result = await ReminderService.cancelReminder(fakeId, testUserId);
      expect(result).toBe(false);
    });
  });

  describe('getDueReminders', () => {
    beforeEach(async () => {
      // Schedule multiple reminders
      const now = new Date();
      
      await ReminderService.scheduleReminder(
        testTask._id,
        testUserId,
        new Date(now.getTime() - 5000) // 5 seconds ago (due)
      );

      const futureTask = await createTestItem(testUserId, {
        label: 'Future task',
        type: 'task'
      });

      await ReminderService.scheduleReminder(
        futureTask._id,
        testUserId,
        new Date(now.getTime() + 60000) // 1 minute from now (not due)
      );
    });

    it('should return only due reminders', async () => {
      const dueReminders = await ReminderService.getDueReminders();
      
      expect(dueReminders.length).toBeGreaterThan(0);
      // All returned reminders should be due (scheduledFor <= now)
      dueReminders.forEach(reminder => {
        expect(new Date(reminder.scheduledFor).getTime()).toBeLessThanOrEqual(Date.now());
      });
    });

    it('should mark reminders as sent after processing', async () => {
      const dueReminders = await ReminderService.getDueReminders();
      
      if (dueReminders.length > 0) {
        await ReminderService.markReminderAsSent(dueReminders[0]._id);
        
        const updatedReminders = await ReminderService.getDueReminders();
        expect(updatedReminders.length).toBe(dueReminders.length - 1);
      }
    });
  });

  describe('processReminders', () => {
    it('should process and send due reminders', async () => {
      // Mock push notification service
      jest.spyOn(PushNotificationService, 'sendNotification')
        .mockResolvedValue({ success: true });

      // Schedule a due reminder
      const reminderTime = new Date(Date.now() - 1000); // 1 second ago
      await ReminderService.scheduleReminder(testTask._id, testUserId, reminderTime);

      const result = await ReminderService.processReminders();
      
      expect(result.processed).toBeGreaterThan(0);
      expect(result.sent).toBeGreaterThan(0);
      expect(result.errors).toBe(0);
    });

    it('should handle errors during reminder processing', async () => {
      // Mock push notification service to fail
      jest.spyOn(PushNotificationService, 'sendNotification')
        .mockResolvedValue({ success: false, error: 'Push failed' });

      const reminderTime = new Date(Date.now() - 1000);
      await ReminderService.scheduleReminder(testTask._id, testUserId, reminderTime);

      const result = await ReminderService.processReminders();
      
      expect(result.processed).toBeGreaterThan(0);
      expect(result.errors).toBeGreaterThan(0);
    });
  });
});