// tests/integration/auth.api.test.js
import request from 'supertest';
import app from '../../server.js';
import { cleanupTestData, testUserPassword, assertions } from '../helpers/testHelpers.js';

describe('Integration Tests - Authentication API', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user with valid data', async () => {
      const uniqueTestUserEmail = `testuser-${Date.now()}@e2e.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: uniqueTestUserEmail, password: testUserPassword });

      expect(res.statusCode).toEqual(201);
      assertions.expectAuthResponseWithUser(res);
      expect(res.body.user).toHaveProperty('email', uniqueTestUserEmail.toLowerCase());
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('should normalize email to lowercase', async () => {
      const email = `TESTUSER-${Date.now()}@E2E.COM`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email, password: testUserPassword });

      expect(res.statusCode).toEqual(201);
      expect(res.body.user.email).toBe(email.toLowerCase());
    });

    it('should not allow registration with invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: testUserPassword });

      assertions.expectErrorResponse(res, 400);
      expect(res.body.error).toMatch(/valid email/i);
    });

    it('should not allow registration with weak password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: `test-${Date.now()}@e2e.com`, password: '123' });

      assertions.expectErrorResponse(res, 400);
      expect(res.body.error).toMatch(/password/i);
    });

    it('should not allow duplicate registration (case-insensitive)', async () => {
      const dupEmail = `dup-${Date.now()}@e2e.com`;
      
      // First registration
      await request(app)
        .post('/api/auth/register')
        .send({ email: dupEmail, password: testUserPassword });

      // Attempt duplicate with different case
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: dupEmail.toUpperCase(), password: testUserPassword });

      assertions.expectErrorResponse(res, 409); // Conflict status code
      expect(res.body.error).toBe('User already exists with this email');
    });

    it('should handle missing required fields', async () => {
      // Missing email
      let res = await request(app)
        .post('/api/auth/register')
        .send({ password: testUserPassword });
      assertions.expectErrorResponse(res, 400);

      // Missing password
      res = await request(app)
        .post('/api/auth/register')
        .send({ email: `test-${Date.now()}@e2e.com` });
      assertions.expectErrorResponse(res, 400);
    });
  });

  describe('POST /api/auth/login', () => {
    let testUserEmail;

    beforeEach(async () => {
      testUserEmail = `loginuser-${Date.now()}@e2e.com`;
      await request(app)
        .post('/api/auth/register')
        .send({ email: testUserEmail, password: testUserPassword });
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUserEmail, password: testUserPassword });

      expect(res.statusCode).toEqual(200);
      assertions.expectAuthResponseWithUser(res);
      expect(res.body.user.email).toBe(testUserEmail);
    });

    it('should login with case-insensitive email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUserEmail.toUpperCase(), password: testUserPassword });

      expect(res.statusCode).toEqual(200);
      assertions.expectAuthResponseWithUser(res);
    });

    it('should fail with incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUserEmail, password: 'wrongPassword' });

      assertions.expectErrorResponse(res, 401);
      expect(res.body.error).toMatch(/Invalid credentials/i);
    });

    it('should fail with non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@e2e.com', password: testUserPassword });

      assertions.expectErrorResponse(res, 401);
      expect(res.body.error).toMatch(/Invalid credentials/i);
    });

    it('should handle missing credentials', async () => {
      // Missing email
      let res = await request(app)
        .post('/api/auth/login')
        .send({ password: testUserPassword });
      assertions.expectErrorResponse(res, 400);

      // Missing password
      res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUserEmail });
      assertions.expectErrorResponse(res, 400);
    });
  });

  describe('GET /api/auth/verify-token', () => {
    let authToken;
    let testUserEmail;

    beforeEach(async () => {
      testUserEmail = `verifyuser-${Date.now()}@e2e.com`;
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({ email: testUserEmail, password: testUserPassword });
      authToken = registerRes.body.accessToken;
    });

    it('should verify a valid access token', async () => {
      const res = await request(app)
        .get('/api/auth/verify-token')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('valid', true);
      expect(res.body.user).toHaveProperty('email', testUserEmail);
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('should fail with missing token', async () => {
      const res = await request(app)
        .get('/api/auth/verify-token');

      assertions.expectErrorResponse(res, 401);
    });

    it('should fail with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/verify-token')
        .set('Authorization', 'Bearer invalid.token');

      assertions.expectErrorResponse(res, 401);
    });

    it('should fail with malformed authorization header', async () => {
      const res = await request(app)
        .get('/api/auth/verify-token')
        .set('Authorization', 'InvalidFormat token');

      assertions.expectErrorResponse(res, 401);
    });
  });

  describe('POST /api/auth/refresh-token', () => {
    let refreshToken;
    let testUserEmail;

    beforeEach(async () => {
      testUserEmail = `refreshuser-${Date.now()}@e2e.com`;
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({ email: testUserEmail, password: testUserPassword });
      refreshToken = registerRes.body.refreshToken;
    });

    it('should refresh tokens with valid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .send({ token: refreshToken });

      expect(res.statusCode).toEqual(200);
      assertions.expectAuthResponse(res);
      
      // New tokens should be different
      expect(res.body.accessToken).not.toBe(refreshToken);
      expect(res.body.refreshToken).not.toBe(refreshToken);
    });

    it('should fail with missing refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .send({});

      assertions.expectErrorResponse(res, 400);
    });

    it('should fail with invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .send({ token: 'invalid.refresh.token' });

      // May return 429 due to rate limiting, or 401 for invalid token
      expect([401, 429]).toContain(res.statusCode);
      expect(res.body).toHaveProperty('error');
    });

    it('should fail with empty refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .send({ token: '' });

      assertions.expectErrorResponse(res, 400);
    });
  });

  describe('POST /api/auth/logout', () => {
    let refreshToken;
    let testUserEmail;

    beforeEach(async () => {
      testUserEmail = `logoutuser-${Date.now()}@e2e.com`;
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({ email: testUserEmail, password: testUserPassword });
      refreshToken = registerRes.body.refreshToken;
    });

    it('should logout successfully with valid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('message', 'Logged out successfully');
    });

    it('should handle logout with invalid refresh token gracefully', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: 'invalid.token' });

      // Should still return success for security reasons
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('message', 'Logged out successfully');
    });

    it('should handle missing refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .send({});

      assertions.expectErrorResponse(res, 400);
    });

    it('should invalidate refresh token after logout', async () => {
      // First logout
      await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken });

      // Try to use the same refresh token
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .send({ token: refreshToken });

      assertions.expectErrorResponse(res, 401);
    });
  });
});