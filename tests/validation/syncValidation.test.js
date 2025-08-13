import request from 'supertest';
import app from '../../server.js';
import User from '../../models/User.js';
import Device from '../../models/Device.js';
import { connectDB, disconnectDB, clearDB } from '../helpers/testHelpers.js';
import jwt from 'jsonwebtoken';

describe('Sync Validation Tests', () => {
  let testUser;
  let authToken;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDB();
    
    // Create test user
    testUser = await User.create({
      email: 'testuser@example.com',
      password: 'testPassword123',
      isVerified: true
    });

    // Generate auth token
    authToken = jwt.sign(
      { user: { id: testUser._id, email: testUser.email } },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  afterEach(async () => {
    await clearDB();
  });

  describe('Device Registration Validation', () => {
    describe('Valid Device Registration', () => {
      test('should accept valid device registration', async () => {
        const deviceData = {
          id: 'valid-device-123',
          name: 'Test Device',
          type: 'iOS',
          platform: 'iPhone',
          userAgent: 'Mozilla/5.0...',
          capabilities: {
            pushNotifications: true,
            backgroundSync: true,
            indexedDB: true,
            serviceWorker: true,
            offlineSupport: false
          }
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('registered successfully');
      });
    });

    describe('Invalid Device ID', () => {
      test('should reject empty device ID', async () => {
        const deviceData = {
          id: '',
          name: 'Test Device',
          type: 'iOS'
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors[0].field).toBe('id');
        expect(response.body.errors[0].message).toContain('Device ID is required');
      });

      test('should reject device ID with invalid characters', async () => {
        const deviceData = {
          id: 'invalid device@#$',
          name: 'Test Device',
          type: 'iOS'
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors[0].field).toBe('id');
        expect(response.body.errors[0].message).toContain('can only contain letters, numbers, hyphens, and underscores');
      });

      test('should reject device ID that is too long', async () => {
        const deviceData = {
          id: 'a'.repeat(129), // 129 characters, exceeds 128 limit
          name: 'Test Device',
          type: 'iOS'
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors[0].field).toBe('id');
        expect(response.body.errors[0].message).toContain('between 1-128 characters');
      });
    });

    describe('Invalid Device Name', () => {
      test('should reject empty device name', async () => {
        const deviceData = {
          id: 'valid-device-123',
          name: '',
          type: 'iOS'
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors[0].field).toBe('name');
        expect(response.body.errors[0].message).toContain('Device name is required');
      });

      test('should reject device name that is too long', async () => {
        const deviceData = {
          id: 'valid-device-123',
          name: 'a'.repeat(101), // 101 characters, exceeds 100 limit
          type: 'iOS'
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors[0].field).toBe('name');
        expect(response.body.errors[0].message).toContain('between 1-100 characters');
      });
    });

    describe('Invalid Device Type', () => {
      test('should reject invalid device type', async () => {
        const deviceData = {
          id: 'valid-device-123',
          name: 'Test Device',
          type: 'InvalidType'
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors[0].field).toBe('type');
        expect(response.body.errors[0].message).toContain('Invalid device type');
      });
    });

    describe('Invalid Device Capabilities', () => {
      test('should reject unknown capability', async () => {
        const deviceData = {
          id: 'valid-device-123',
          name: 'Test Device',
          type: 'iOS',
          capabilities: {
            pushNotifications: true,
            unknownCapability: true
          }
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors[0].field).toBe('capabilities');
        expect(response.body.errors[0].message).toContain('Unknown capabilities');
      });

      test('should reject non-boolean capability values', async () => {
        const deviceData = {
          id: 'valid-device-123',
          name: 'Test Device',
          type: 'iOS',
          capabilities: {
            pushNotifications: 'yes' // Should be boolean
          }
        };

        const response = await request(app)
          .post('/api/sync/devices/register')
          .set('Authorization', `Bearer ${authToken}`)
          .send(deviceData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors[0].field).toBe('capabilities.pushNotifications');
        expect(response.body.errors[0].message).toContain('Capability values must be boolean');
      });
    });
  });

  describe('Sync Trigger Validation', () => {
    test('should accept valid sync trigger', async () => {
      const response = await request(app)
        .post('/api/sync/trigger')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          deviceId: 'valid-device-123',
          dataType: 'all'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('triggered successfully');
    });

    test('should reject invalid data type', async () => {
      const response = await request(app)
        .post('/api/sync/trigger')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          deviceId: 'valid-device-123',
          dataType: 'invalidType'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].field).toBe('dataType');
      expect(response.body.errors[0].message).toContain('Invalid data type');
    });

    test('should reject invalid device ID format', async () => {
      const response = await request(app)
        .post('/api/sync/trigger')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          deviceId: 'invalid device@#$',
          dataType: 'all'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].field).toBe('deviceId');
      expect(response.body.errors[0].message).toContain('can only contain letters, numbers, hyphens, and underscores');
    });
  });

  describe('Push Notification Validation', () => {
    test('should accept valid push subscription', async () => {
      const subscriptionData = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/example',
        keys: {
          p256dh: 'validP256dhKey123',
          auth: 'validAuthKey123'
        }
      };

      const response = await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subscriptionData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Subscribed successfully');
    });

    test('should reject invalid endpoint URL', async () => {
      const subscriptionData = {
        endpoint: 'invalid-url',
        keys: {
          p256dh: 'validP256dhKey123',
          auth: 'validAuthKey123'
        }
      };

      const response = await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subscriptionData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].field).toBe('endpoint');
      expect(response.body.errors[0].message).toContain('valid HTTPS URL');
    });

    test('should reject HTTP endpoint (require HTTPS)', async () => {
      const subscriptionData = {
        endpoint: 'http://example.com/push',
        keys: {
          p256dh: 'validP256dhKey123',
          auth: 'validAuthKey123'
        }
      };

      const response = await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subscriptionData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].field).toBe('endpoint');
      expect(response.body.errors[0].message).toContain('valid HTTPS URL');
    });

    test('should reject missing keys', async () => {
      const subscriptionData = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/example'
      };

      const response = await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subscriptionData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].field).toBe('keys');
      expect(response.body.errors[0].message).toContain('Push keys are required');
    });

    test('should reject missing p256dh key', async () => {
      const subscriptionData = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/example',
        keys: {
          auth: 'validAuthKey123'
        }
      };

      const response = await request(app)
        .post('/api/push/subscribe')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subscriptionData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].field).toBe('keys.p256dh');
      expect(response.body.errors[0].message).toContain('P256DH key is required');
    });
  });

  describe('Authentication and Authorization', () => {
    test('should reject requests without authentication', async () => {
      const response = await request(app)
        .post('/api/sync/devices/register')
        .send({
          id: 'valid-device-123',
          name: 'Test Device',
          type: 'iOS'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should reject requests from unverified users', async () => {
      // Create unverified user
      const unverifiedUser = await User.create({
        email: 'unverified@example.com',
        password: 'testPassword123',
        isVerified: false
      });

      const unverifiedToken = jwt.sign(
        { user: { id: unverifiedUser._id, email: unverifiedUser.email } },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .post('/api/sync/devices/register')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .send({
          id: 'valid-device-123',
          name: 'Test Device',
          type: 'iOS'
        })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].field).toBe('verification');
      expect(response.body.errors[0].message).toContain('verify your account');
    });
  });

  describe('Rate Limiting', () => {
    test('should allow reasonable sync frequency', async () => {
      // First request should succeed
      const response1 = await request(app)
        .post('/api/sync/trigger')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ dataType: 'all' })
        .expect(200);

      expect(response1.body.success).toBe(true);

      // Wait a bit, then second request should succeed
      await new Promise(resolve => setTimeout(resolve, 100));

      const response2 = await request(app)
        .post('/api/sync/trigger')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ dataType: 'all' })
        .expect(200);

      expect(response2.body.success).toBe(true);
    });
  });

  describe('Security Headers', () => {
    test('should set appropriate security headers', async () => {
      const response = await request(app)
        .get('/api/sync/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
    });
  });

  describe('Data Sanitization', () => {
    test('should sanitize device name from XSS', async () => {
      const deviceData = {
        id: 'valid-device-123',
        name: '<script>alert("xss")</script>Test Device',
        type: 'iOS'
      };

      const response = await request(app)
        .post('/api/sync/devices/register')
        .set('Authorization', `Bearer ${authToken}`)
        .send(deviceData)
        .expect(201);

      expect(response.body.success).toBe(true);

      // Check that the device name was sanitized
      const device = await Device.findOne({ 
        userId: testUser._id, 
        deviceId: 'valid-device-123' 
      });
      
      expect(device.name).not.toContain('<script>');
      expect(device.name).toBe('Test Device'); // Should have HTML stripped
    });
  });
});