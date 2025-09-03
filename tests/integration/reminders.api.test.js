import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import express from 'express';

// Import your models and routes
import Reminder from '../../models/Reminder.js';
import User from '../../models/User.js';
import reminderRoutes from '../../routes/reminderRoutes.js';
import authMiddleware from '../../middleware/authMiddleware.js';

describe('Reminders API', () => {
  let mongoServer;
  let app;
  let authToken;
  let userId;

  beforeAll(async () => {
    // Disconnect any existing connection
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    
    // Start in-memory MongoDB instance
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create Express app for testing
    app = express();
    app.use(express.json());
    
    // Mock Socket.IO middleware
    app.use((req, res, next) => {
      req.io = {
        to: () => ({
          emit: jest.fn()
        })
      };
      next();
    });
    
    app.use('/api/reminders', authMiddleware, reminderRoutes);

    // Create test user
    const testUser = new User({
      email: 'test@example.com',
      password: 'hashedpassword123',
      isVerified: true
    });
    await testUser.save();
    userId = testUser._id.toString();

    // Generate auth token
    authToken = jwt.sign(
      { user: { id: userId }, type: 'access' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear reminders collection before each test
    await Reminder.deleteMany({});
  });

  describe('POST /api/reminders/:itemId', () => {
    it('should create a new reminder', async () => {
      const itemId = 'test-item-123';
      const reminderData = {
        timestamp: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        itemTitle: 'Test Item',
        repeatOptions: {
          type: 'daily',
          interval: 1,
          endDate: null,
          daysOfWeek: []
        }
      };

      const response = await request(app)
        .put(`/api/reminders/${itemId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(reminderData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.reminder).toMatchObject({
        itemId,
        itemTitle: 'Test Item',
        enabled: true
      });

      // Verify in database
      const savedReminder = await Reminder.findOne({ userId, itemId });
      expect(savedReminder).toBeTruthy();
      expect(savedReminder.itemTitle).toBe('Test Item');
    });

    it('should update existing reminder', async () => {
      const itemId = 'test-item-456';
      
      // Create initial reminder
      const initialReminder = new Reminder({
        userId,
        itemId,
        itemTitle: 'Original Title',
        timestamp: new Date(Date.now() + 3600000)
      });
      await initialReminder.save();

      // Update reminder
      const updateData = {
        timestamp: new Date(Date.now() + 7200000).toISOString(), // 2 hours from now
        itemTitle: 'Updated Title'
      };

      const response = await request(app)
        .put(`/api/reminders/${itemId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.reminder.itemTitle).toBe('Updated Title');

      // Verify in database
      const updatedReminder = await Reminder.findOne({ userId, itemId });
      expect(updatedReminder.itemTitle).toBe('Updated Title');
    });

    it('should reject past timestamps', async () => {
      const itemId = 'test-item-past';
      const pastData = {
        timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        itemTitle: 'Past Reminder'
      };

      const response = await request(app)
        .put(`/api/reminders/${itemId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(pastData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Reminder timestamp must be in the future');
    });
  });

  describe('GET /api/reminders', () => {
    beforeEach(async () => {
      // Create test reminders
      const reminders = [
        new Reminder({
          userId,
          itemId: 'item-1',
          itemTitle: 'First Reminder',
          timestamp: new Date(Date.now() + 3600000),
          enabled: true
        }),
        new Reminder({
          userId,
          itemId: 'item-2',
          itemTitle: 'Second Reminder',
          timestamp: new Date(Date.now() + 7200000),
          enabled: false
        })
      ];
      await Reminder.insertMany(reminders);
    });

    it('should return all active reminders by default', async () => {
      const response = await request(app)
        .get('/api/reminders')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.reminders).toHaveLength(1);
      expect(response.body.reminders[0].itemTitle).toBe('First Reminder');
    });

    it('should return all reminders when activeOnly=false', async () => {
      const response = await request(app)
        .get('/api/reminders?activeOnly=false')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.reminders).toHaveLength(2);
    });
  });

  describe('GET /api/reminders/:itemId', () => {
    it('should return specific reminder', async () => {
      const itemId = 'specific-item';
      const reminder = new Reminder({
        userId,
        itemId,
        itemTitle: 'Specific Reminder',
        timestamp: new Date(Date.now() + 3600000)
      });
      await reminder.save();

      const response = await request(app)
        .get(`/api/reminders/${itemId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.reminder.itemTitle).toBe('Specific Reminder');
    });

    it('should return 404 for non-existent reminder', async () => {
      const response = await request(app)
        .get('/api/reminders/non-existent')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Reminder not found');
    });
  });

  describe('POST /api/reminders/:itemId/snooze', () => {
    it('should snooze a reminder', async () => {
      const itemId = 'snooze-item';
      const reminder = new Reminder({
        userId,
        itemId,
        itemTitle: 'Snooze Test',
        timestamp: new Date(Date.now() + 3600000)
      });
      await reminder.save();

      const response = await request(app)
        .post(`/api/reminders/${itemId}/snooze`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ minutes: 30 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.reminder.snoozedUntil).toBeTruthy();

      // Verify snooze time is approximately 30 minutes from now
      const snoozedUntil = new Date(response.body.reminder.snoozedUntil);
      const expectedSnoozeTime = new Date(Date.now() + 30 * 60 * 1000);
      const timeDiff = Math.abs(snoozedUntil.getTime() - expectedSnoozeTime.getTime());
      expect(timeDiff).toBeLessThan(5000); // Within 5 seconds
    });
  });

  describe('DELETE /api/reminders/:itemId', () => {
    it('should delete a reminder', async () => {
      const itemId = 'delete-item';
      const reminder = new Reminder({
        userId,
        itemId,
        itemTitle: 'Delete Test',
        timestamp: new Date(Date.now() + 3600000)
      });
      await reminder.save();

      const response = await request(app)
        .delete(`/api/reminders/${itemId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify deletion
      const deletedReminder = await Reminder.findOne({ userId, itemId });
      expect(deletedReminder).toBeNull();
    });
  });

  describe('POST /api/reminders/bulk-import', () => {
    it('should bulk import reminders', async () => {
      const reminders = [
        {
          itemId: 'bulk-1',
          timestamp: new Date(Date.now() + 3600000).toISOString(),
          itemTitle: 'Bulk Reminder 1'
        },
        {
          itemId: 'bulk-2',
          timestamp: new Date(Date.now() + 7200000).toISOString(),
          itemTitle: 'Bulk Reminder 2'
        }
      ];

      const response = await request(app)
        .post('/api/reminders/bulk-import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reminders })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results.created).toBe(2);
      expect(response.body.results.errors).toHaveLength(0);

      // Verify in database
      const savedReminders = await Reminder.find({ userId });
      expect(savedReminders).toHaveLength(2);
    });

    it('should skip past reminders during bulk import', async () => {
      const reminders = [
        {
          itemId: 'bulk-future',
          timestamp: new Date(Date.now() + 3600000).toISOString(),
          itemTitle: 'Future Reminder'
        },
        {
          itemId: 'bulk-past',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          itemTitle: 'Past Reminder'
        }
      ];

      const response = await request(app)
        .post('/api/reminders/bulk-import')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reminders })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results.created).toBe(1);
      expect(response.body.results.skipped).toBe(1);
    });
  });

  describe('Authentication', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/reminders')
        .expect(401);

      expect(response.body.message).toBe('No token provided');
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/reminders')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.message).toBe('Invalid token');
    });
  });
});