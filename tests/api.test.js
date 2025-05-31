// tests/api.test.js

const request = require('supertest');
const path = require('path');
const app = require('../server'); // this requires your server.js to export the Express app
const mongoose = require('mongoose');
const User = require('../models/User');
const { sortItems, findItemRecursive, hasSiblingWithName, updateItemInTree } = require('../utils/backendTreeUtils');

let authToken = ''; // will store access token for further tests
let refreshToken = '';
let testUserEmail = 'testuser@example.com';
let testUserPassword = 'password123';

describe('Authentication Endpoints', () => {
  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: testUserEmail, password: testUserPassword });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toHaveProperty('email', testUserEmail.toLowerCase());
  });

  it('should not allow duplicate registration', async () => {
    // first registration
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: testUserPassword });
    // duplicate registration should fail
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: testUserPassword });
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should login an existing user', async () => {
    // First register a new user for login if not yet done
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'loginuser@example.com', password: testUserPassword });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginuser@example.com', password: testUserPassword });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    authToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('should verify an access token', async () => {
    // Use an authenticated endpoint to check the token, for example /auth/verify-token
    const res = await request(app)
      .get('/api/auth/verify-token')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('valid', true);
    expect(res.body.user).toHaveProperty('email');
  });

  it('should refresh tokens using a valid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ token: refreshToken });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    // Optionally update tokens if needed in later tests
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


describe('Items Endpoints', () => {
  let userToken = '';
  let createdItemId = '';

  beforeAll(async () => {
    // Ensure there is a valid user and capture the token
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'itemsuser@example.com', password: testUserPassword });
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

  it('should create a new root-level item', async () => {
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

    // Now create a child item inside that folder
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

  it('should delete an item', async () => {
    const res = await request(app)
      .delete(`/api/items/${createdItemId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('message', 'Item deleted successfully.');
  });

  it('should replace the entire tree', async () => {
    // Prepare a new tree structure
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
      .set('Authorization', `Bearer ${userToken}`)
      .send({ newTree });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('message', 'Tree replaced successfully.');
    expect(Array.isArray(res.body.notesTree)).toBe(true);
    expect(res.body.notesTree.length).toBe(2);
  });
});


describe('Image Upload Endpoint', () => {
  let userToken = '';

  beforeAll(async () => {
    // Get an authenticated user token
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'imageuser@example.com', password: testUserPassword });
    userToken = res.body.accessToken;
  });

  it('should successfully upload a valid image', async () => {
    // Make sure to have a small valid image at tests/fixtures/test.png (or update the path accordingly)
    const imagePath = path.join(__dirname, 'fixtures', 'test.png');
    const res = await request(app)
      .post('/api/images/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('image', imagePath);

    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('url');
    expect(res.body).toHaveProperty('metadata');
    expect(res.body.metadata).toHaveProperty('width');
  });

  it('should reject uploads with an invalid file type', async () => {
    // Use a .txt file for example as an invalid image file.
    const invalidFilePath = path.join(__dirname, 'fixtures', 'test.txt');
    // Write a dummy text file if it does not exist.
    const fs = require('fs');
    if (!fs.existsSync(invalidFilePath)) {
      fs.writeFileSync(invalidFilePath, 'This is not an image');
    }
    const res = await request(app)
      .post('/api/images/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('image', invalidFilePath);

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).toHaveProperty('message');
  });
});

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
    // folders should come first
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
