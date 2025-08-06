// tests/helpers/testHelpers.js
import request from 'supertest';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Task from '../../models/Task.js';
import { generateAccessToken } from '../../utils/jwt.js';
import { hashPassword } from '../../utils/hash.js';

/**
 * Test helper functions for backend testing
 */

export const testUserPassword = 'TestPassword123!';

/**
 * Creates a test user and returns auth token
 */
export async function createTestUser(email, password = testUserPassword) {
  const hashedPassword = await hashPassword(password);
  const userData = { email, password: hashedPassword };
  const user = new User(userData);
  await user.save();
  
  const token = generateAccessToken(user._id.toString());
  return { user, token };
}

/**
 * Creates multiple test users
 */
export async function createTestUsers(count = 3) {
  const users = [];
  for (let i = 0; i < count; i++) {
    const email = `testuser${i}-${Date.now()}@test.com`;
    const { user, token } = await createTestUser(email);
    users.push({ user, token, email });
  }
  return users;
}

/**
 * Creates a test item/task
 */
export async function createTestItem(userId, itemData = {}) {
  const defaultData = {
    title: `Test Item ${Date.now()}`,
    type: 'note',
    content: '<p>Test content</p>',
    userId: userId
  };
  
  const item = new Task({ ...defaultData, ...itemData });
  await item.save();
  return item;
}

/**
 * Creates multiple test items for a user
 */
export async function createTestItems(userId, count = 3) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const item = await createTestItem(userId, {
      title: `Test Item ${i} - ${Date.now()}`,
      type: i % 2 === 0 ? 'note' : 'task'
    });
    items.push(item);
  }
  return items;
}

/**
 * Cleans up test data
 */
export async function cleanupTestData() {
  try {
    // Clean up in the right order (remove dependent data first)
    await Task.deleteMany({});
    
    // Import RefreshToken model dynamically to avoid circular imports
    const RefreshTokenModel = mongoose.models.RefreshToken || mongoose.model('RefreshToken');
    await RefreshTokenModel.deleteMany({});
    
    await User.deleteMany({ 
      email: { 
        $regex: /@(test\.com|e2e\.com|example\.com)$/ 
      } 
    });
    
    // Wait a bit to ensure cleanup completes
    await new Promise(resolve => setTimeout(resolve, 10));
  } catch (error) {
    console.warn('Cleanup warning:', error.message);
  }
}

/**
 * Makes authenticated request helper
 */
export function makeAuthenticatedRequest(app, token) {
  return {
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
    put: (url) => request(app).put(url).set('Authorization', `Bearer ${token}`),
    patch: (url) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`)
  };
}

/**
 * Waits for a specified amount of time
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generates mock data
 */
export const mockData = {
  user: (overrides = {}) => ({
    email: `user-${Date.now()}@test.com`,
    password: testUserPassword,
    ...overrides
  }),
  
  item: (overrides = {}) => ({
    label: `Item ${Date.now()}`,
    type: 'note',
    content: '<p>Mock content</p>',
    ...overrides
  }),
  
  folder: (overrides = {}) => ({
    label: `Folder ${Date.now()}`,
    type: 'folder',
    children: [],
    ...overrides
  }),
  
  task: (overrides = {}) => ({
    label: `Task ${Date.now()}`,
    type: 'task',
    content: '<p>Mock task content</p>',
    completed: false,
    ...overrides
  })
};

/**
 * Database helpers
 */
export const dbHelpers = {
  async clearCollection(model) {
    await model.deleteMany({});
  },
  
  async countDocuments(model, query = {}) {
    return await model.countDocuments(query);
  },
  
  async findById(model, id) {
    return await model.findById(id);
  }
};

/**
 * Assertion helpers
 */
export const assertions = {
  expectValidObjectId(id) {
    expect(mongoose.Types.ObjectId.isValid(id)).toBe(true);
  },
  
  expectValidDate(date) {
    expect(new Date(date).toString()).not.toBe('Invalid Date');
  },
  
  expectValidUser(user) {
    expect(user).toHaveProperty('_id');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('createdAt');
    expect(user).toHaveProperty('updatedAt');
  },
  
  expectValidItem(item) {
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('label');
    expect(item).toHaveProperty('type');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('updatedAt');
  },
  
  expectAuthResponse(response) {
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    // Note: Some endpoints may not return user object (e.g., refresh token)
    if (response.body.user) {
      expect(response.body.user).toBeDefined();
    }
  },

  expectAuthResponseWithUser(response) {
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(response.body).toHaveProperty('user');
  },
  
  expectErrorResponse(response, statusCode = 400) {
    expect(response.statusCode).toBe(statusCode);
    expect(response.body).toHaveProperty('error');
  }
};