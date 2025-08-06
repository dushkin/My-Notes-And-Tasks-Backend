// Simple auth test
import request from 'supertest';
import app from '../../server.js';

describe('Simple Auth Integration Test', () => {
  it('should respond to health check', async () => {
    const res = await request(app)
      .get('/api/health')
      .expect(200);

    expect(res.body).toHaveProperty('status', 'UP');
  });

  it('should require authentication for protected routes', async () => {
    const res = await request(app)
      .get('/api/items/tree');

    expect(res.statusCode).toBe(401);
  });
});