// tests/api.test.js

const request = require('supertest');
const path = require('path');
const fs = require("fs");
const app = require('../server'); // Ensure your server.js exports the Express app
const mongoose = require('mongoose');
const User = require('../models/User');
const {
  sortItems,
  findItemRecursive,
  hasSiblingWithName,
  updateItemInTree
} = require('../utils/backendTreeUtils');

//
// AUTHENTICATION ENDPOINTS
//

let authToken = ''; // global token for some tests
let refreshToken = '';
const testUserEmail = 'testuser@e2e.com';
const testUserPassword = 'password123';

describe('Authentication Endpoints', () => {

  it('should not allow registration with an invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: testUserPassword });
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/valid email/);
  });

  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: testUserEmail, password: testUserPassword });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toHaveProperty('email', testUserEmail.toLowerCase());
  });

  it('should not allow duplicate registration (case-insensitive)', async () => {
    // first registration
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@e2e.com', password: testUserPassword });
    // duplicate registration should fail
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@e2e.com', password: testUserPassword });
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should fail login with incorrect password', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'loginuser@e2e.com', password: testUserPassword });
    // Try logging in with an incorrect password
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginuser@e2e.com', password: 'wrongPassword' });
    expect(res.statusCode).toEqual(401);
    expect(res.body.error).toMatch(/Invalid credentials/);
  });

  it('should login an existing user', async () => {
    // First register a new user for login if not yet done
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'loginsuccess@e2e.com', password: testUserPassword });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginsuccess@e2e.com', password: testUserPassword });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    authToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('should verify an access token', async () => {
    const res = await request(app)
      .get('/api/auth/verify-token')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('valid', true);
    expect(res.body.user).toHaveProperty('email');
  });

  it('should fail token refresh with missing token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ token: '' });
    expect(res.statusCode).toEqual(400);
  });

  it('should refresh tokens using a valid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ token: refreshToken });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    // Update tokens for further test usage.
    authToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('should log out using refreshToken', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('message', 'Logged out successfully');
  });
});

//
// ITEMS ENDPOINTS
//

describe('Items Endpoints', () => {
  let userToken = '';
  let createdItemId = '';

  beforeAll(async () => {
    // Register a new user for item-related operations
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'itemsuser@e2e.com', password: testUserPassword });
    userToken = res.body.accessToken;
  });

  it('should get an empty notes tree', async () => {
    const res = await request(app)
      .get('/api/items/tree')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('notesTree');
    expect(Array.isArray(res.body.notesTree)).toBe(true);
    expect(res.body.notesTree.length).toBe(0);
  });

  it('should create a new root-level note', async () => {
    const itemData = {
      label: 'Test Note',
      type: 'note',
      content: '<p>This is a test note.</p>'
    };

    const res = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${userToken}`)
      .send(itemData);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.label).toEqual('Test Note');
    expect(res.body.type).toEqual('note');
    createdItemId = res.body.id;
  });

  it('should create a child item inside a folder', async () => {
    // First, create a folder
    const folderRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ label: 'Work Folder', type: 'folder' });
    expect(folderRes.statusCode).toEqual(201);
    const folderId = folderRes.body.id;
    // Create a child item inside that folder
    const childData = {
      label: 'Child Note',
      type: 'note',
      content: '<p>Child note content</p>'
    };
    const res = await request(app)
      .post(`/api/items/${folderId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send(childData);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.label).toEqual('Child Note');
  });

  it('should prevent creating duplicate siblings with same name', async () => {
    // Create a folder and add a note
    const folderRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ label: 'Duplicate Folder', type: 'folder' });
    expect(folderRes.statusCode).toEqual(201);
    const folderId = folderRes.body.id;
    // Create first note with a name
    let childRes = await request(app)
      .post(`/api/items/${folderId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ label: 'Unique Child', type: 'note', content: '<p>Note content</p>' });
    expect(childRes.statusCode).toEqual(201);
    // Try creating a duplicate
    childRes = await request(app)
      .post(`/api/items/${folderId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ label: 'Unique Child', type: 'note', content: '<p>Duplicate note</p>' });
    expect(childRes.statusCode).toEqual(400);
    expect(childRes.body.error).toMatch(/already exists/);
  });

  it('should update an existing item', async () => {
    const updateData = { label: 'Updated Test Note', content: '<p>Updated content</p>' };
    const res = await request(app)
      .patch(`/api/items/${createdItemId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send(updateData);
    expect(res.statusCode).toEqual(200);
    expect(res.body.label).toEqual('Updated Test Note');
    expect(res.body.content).toEqual('<p>Updated content</p>');
  });

  it('should return original item if update does not change data', async () => {
    // Retrieve the item first
    const current = await request(app)
      .get(`/api/items/${createdItemId}`)
      .set("Authorization", `Bearer ${userToken}`);
    const original = current.body;
    const res = await request(app)
      .patch(`/api/items/${createdItemId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ label: original.label });
    expect(res.statusCode).toEqual(200);
    expect(res.body.label).toEqual(original.label);
  });

  it('should delete an existing item and be idempotent', async () => {
    // Delete the created item
    let res = await request(app)
      .delete(`/api/items/${createdItemId}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('message', 'Item deleted successfully.');
    // Try deleting again; should return idempotent message
    res = await request(app)
      .delete(`/api/items/${createdItemId}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toMatch(/not found or already deleted/);
  });

  it('should replace the entire tree', async () => {
    const newTree = [
      {
        label: 'Folder A',
        type: 'folder',
        children: [
          { label: 'Note inside Folder A', type: 'note', content: '<p>Content A</p>' }
        ]
      },
      {
        label: 'Standalone Note',
        type: 'note',
        content: '<p>Standalone content</p>'
      }
    ];
    const res = await request(app)
      .put('/api/items/tree')
      .set("Authorization", `Bearer ${userToken}`)
      .send({ newTree });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('message', 'Tree replaced successfully.');
    expect(Array.isArray(res.body.notesTree)).toBe(true);
    expect(res.body.notesTree.length).toBe(2);
  });

  it('should fail to replace tree when JSON structure is invalid', async () => {
    // Send an invalid tree (e.g., missing required "label")
    const invalidTree = [
      { type: 'note', content: '<p>No label provided</p>' }
    ];
    const res = await request(app)
      .put('/api/items/tree')
      .set("Authorization", `Bearer ${userToken}`)
      .send({ newTree: invalidTree });
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/non-empty label/);
  });
});

//
// IMAGE UPLOAD ENDPOINT
//

describe('Image Upload Endpoint', () => {
  let userToken = '';

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'imageuser@e2e.com', password: testUserPassword });
    userToken = res.body.accessToken;
  });

  it('should successfully upload a valid image', async () => {
    // Expect a valid PNG file at tests/fixtures/test.png
    const imagePath = path.join(__dirname, 'fixtures', 'test.png');
    if (!fs.existsSync(imagePath)) {
      // Create a minimal 1x1 PNG in case it doesn't exist
      const base64PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gK+fn29AAAAAElFTkSuQmCC";
      fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
      fs.writeFileSync(imagePath, Buffer.from(base64PNG, "base64"));
    }
    const res = await request(app)
      .post('/api/images/upload')
      .set("Authorization", `Bearer ${userToken}`)
      .attach('image', imagePath);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('url');
    expect(res.body).toHaveProperty('metadata');
    expect(res.body.metadata).toHaveProperty('width');
  });

  it('should reject uploads with an invalid file type', async () => {
    const invalidFilePath = path.join(__dirname, 'fixtures', 'test.txt');
    if (!fs.existsSync(invalidFilePath)) {
      fs.writeFileSync(invalidFilePath, 'This is not an image');
    }
    const res = await request(app)
      .post('/api/images/upload')
      .set("Authorization", `Bearer ${userToken}`)
      .attach('image', invalidFilePath);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).toHaveProperty('message');
  });
});

//
// UTILITY FUNCTIONS (backendTreeUtils)
//

describe('Utility Functions (backendTreeUtils)', () => {
  const sampleItems = [
    { id: '1', label: 'Alpha', type: 'note', content: 'First note' },
    { id: '2', label: 'Beta', type: 'folder', children: [
      { id: '3', label: 'Gamma', type: 'note', content: 'Nested note' }
    ] },
    { id: '4', label: 'Delta', type: 'task', content: 'Task content', completed: false }
  ];

  it('should sort items correctly', () => {
    const unsorted = [
      { id: 'a', label: 'zeta', type: 'note' },
      { id: 'b', label: 'alpha', type: 'folder', children: [] },
      { id: 'c', label: 'theta', type: 'task' }
    ];
    const sorted = sortItems(unsorted);
    // Expect folders first
    expect(sorted[0].type).toEqual('folder');
  });

  it('should find an item recursively', () => {
    const result = findItemRecursive(sampleItems, '3');
    expect(result).not.toBeNull();
    expect(result.item.label).toEqual('Gamma');
  });

  it('should detect sibling name conflicts correctly', () => {
    const siblings = [
      { id: 'a1', label: 'Note A' },
      { id: 'a2', label: 'Note B' }
    ];
    expect(hasSiblingWithName(siblings, 'note a')).toBe(true);
    expect(hasSiblingWithName(siblings, 'note c')).toBe(false);
  });

  it('should update an item in tree', () => {
    const updates = { label: 'Updated Alpha', content: 'Updated content' };
    const newTree = updateItemInTree(sampleItems, '1', updates);
    const result = findItemRecursive(newTree, '1');
    expect(result.item.label).toEqual('Updated Alpha');
    expect(result.item.content).toEqual('Updated content');
  });
});
