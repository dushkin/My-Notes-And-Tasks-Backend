// tests/api.test.js
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import app from '../server.js';
import {
  sortItems,
  findItemRecursive,
  hasSiblingWithName,
  updateItemInTree
} from '../utils/backendTreeUtils.js';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testUserPassword = 'password123';

// AUTHENTICATION ENDPOINTS
describe('Authentication Endpoints', () => {
  let authToken = '';
  let refreshToken = '';

  it('should not allow registration with an invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: testUserPassword });
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/valid email/);
  });

  it('should register a new user', async () => {
    const uniqueTestUserEmail = `testuser-${Date.now()}@e2e.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: uniqueTestUserEmail, password: testUserPassword });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toHaveProperty('email', uniqueTestUserEmail.toLowerCase());
  });

  it('should not allow duplicate registration (case-insensitive)', async () => {
    const dupEmail = `dup-${Date.now()}@e2e.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: dupEmail, password: testUserPassword });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: dupEmail.toUpperCase(), password: testUserPassword });
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error', 'User already exists with this email');
  });

  it('should fail login with incorrect password', async () => {
    const loginUserEmail = `loginuser-fail-${Date.now()}@e2e.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: loginUserEmail, password: testUserPassword });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: loginUserEmail, password: 'wrongPassword' });
    expect(res.statusCode).toEqual(401);
    expect(res.body.error).toMatch(/Invalid credentials/);
  });

  it('should login an existing user and set tokens for this suite', async () => {
    const loginSuccessEmail = `loginsuccess-${Date.now()}@e2e.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: loginSuccessEmail, password: testUserPassword });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: loginSuccessEmail, password: testUserPassword });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    authToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('should verify an access token', async () => {
    expect(authToken).not.toBe('');
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
    expect(refreshToken).not.toBe('');
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ token: refreshToken });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    authToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('should log out using refreshToken', async () => {
    expect(refreshToken).not.toBe('');
    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('message', 'Logged out successfully');
  });
});

// ITEMS ENDPOINTS
describe('Items Endpoints', () => {
  let itemsUserAuthToken = '';
  let testItemIdForUpdateAndDelete;

  beforeAll(async () => {
    const itemsUserEmail = `itemsuser-${Date.now()}@e2e.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: itemsUserEmail, password: testUserPassword });
    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: itemsUserEmail, password: testUserPassword });
    itemsUserAuthToken = loginRes.body.accessToken;
    expect(itemsUserAuthToken).not.toBe('');
  });

  beforeEach(async () => {
    const itemData = { label: `ItemToModify-${Date.now()}`, type: 'note', content: '<p>Initial Content</p>' };
    const res = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send(itemData);
    if (res.statusCode === 201 && res.body.id) {
      testItemIdForUpdateAndDelete = res.body.id;
    } else {
      console.error("ITEM CREATION FAILED IN beforeEach for Items Endpoints:", res.statusCode, res.body);
      testItemIdForUpdateAndDelete = null;
    }
  });

  afterEach(async () => {
    if (testItemIdForUpdateAndDelete) {
      await request(app)
        .delete(`/api/items/${testItemIdForUpdateAndDelete}`)
        .set('Authorization', `Bearer ${itemsUserAuthToken}`);
      testItemIdForUpdateAndDelete = null;
    }
  });

  it('should get an initial notes tree (might not be empty if other tests run)', async () => {
    const res = await request(app)
      .get('/api/items/tree')
      .set('Authorization', `Bearer ${itemsUserAuthToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('notesTree');
    expect(Array.isArray(res.body.notesTree)).toBe(true);
  });

  it('should create a new root-level note', async () => {
    const itemLabel = `Test Root Note API ${Date.now()}`;
    const itemData = { label: itemLabel, type: 'note', content: '<p>This is a test note.</p>' };
    const res = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send(itemData);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.label).toEqual(itemLabel);
    expect(res.body.type).toEqual('note');
  });

  it('should create a child item inside a folder', async () => {
    const folderLabel = `Work Folder Items API ${Date.now()}`;
    const folderRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send({ label: folderLabel, type: 'folder' });
    expect(folderRes.statusCode).toEqual(201);
    const folderId = folderRes.body.id;

    const childLabel = `Child Note In Folder API ${Date.now()}`;
    const childData = { label: childLabel, type: 'note', content: '<p>Child note content</p>' };
    const res = await request(app)
      .post(`/api/items/${folderId}`)
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send(childData);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.label).toEqual(childLabel);
  });

  it('should prevent creating duplicate siblings with same name', async () => {
    const folderLabel = `Duplicate Test Folder API ${Date.now()}`;
    const folderRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send({ label: folderLabel, type: 'folder' });
    expect(folderRes.statusCode).toEqual(201);
    const folderId = folderRes.body.id;

    const siblingLabel = `Unique Sibling API ${Date.now()}`;
    await request(app)
      .post(`/api/items/${folderId}`)
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
       .send({ label: siblingLabel, type: 'note', content: '<p>Note content</p>' });

    const res = await request(app)
      .post(`/api/items/${folderId}`)
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send({ label: siblingLabel, type: 'note', content: '<p>Duplicate note</p>' });
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/already exists/);
  });

  it('should update an existing item', async () => {
    if (!testItemIdForUpdateAndDelete) {
      throw new Error("Skipping test: Item for update was not created in beforeEach.");
    }
    const updateData = { label: 'Updated Item API', content: '<p>Updated content API</p>' };
    const res = await request(app)
      .patch(`/api/items/${testItemIdForUpdateAndDelete}`)
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send(updateData);
    expect(res.statusCode).toEqual(200);
    expect(res.body.label).toEqual('Updated Item API');
    expect(res.body.content).toEqual('&lt;p>Updated content API&lt;/p>');
  });

  it('should return original item if update does not change data (label only)', async () => {
    if (!testItemIdForUpdateAndDelete) {
      throw new Error("Skipping test: Item for no-change update test was not created in beforeEach.");
    }
    
    const currentItemRes = await request(app)
      .get(`/api/items/${testItemIdForUpdateAndDelete}`)
      .set('Authorization', `Bearer ${itemsUserAuthToken}`);
    expect(currentItemRes.statusCode).toEqual(200);
    const originalLabel = currentItemRes.body.label;

    const res = await request(app)
      .patch(`/api/items/${testItemIdForUpdateAndDelete}`)
       .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send({ label: originalLabel });
    expect(res.statusCode).toEqual(200);
    expect(res.body.label).toEqual(originalLabel);
  });

  it('should delete an existing item and be idempotent', async () => {
    if (!testItemIdForUpdateAndDelete) {
      throw new Error("Skipping test: Item for deletion was not created in beforeEach.");
    }
    let res = await request(app)
      .delete(`/api/items/${testItemIdForUpdateAndDelete}`)
      .set('Authorization', `Bearer ${itemsUserAuthToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('message', 'Item deleted successfully.');

    const deletedItemId = testItemIdForUpdateAndDelete;
    testItemIdForUpdateAndDelete = null;

    res = await request(app)
      .delete(`/api/items/${deletedItemId}`)
       .set('Authorization', `Bearer ${itemsUserAuthToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toMatch(/not found or already deleted/);
  });

  it('should replace the entire tree', async () => {
    const newTree = [
      { label: `Folder A API ${Date.now()}`, type: 'folder', children: [{ label: `Note A1 API ${Date.now()}`, type: 'note', content: '<p>Content A1</p>' }] },
      { label: `Note B API ${Date.now()}`, type: 'note', content: '<p>Content B</p>' }
    ];
    const res = await request(app)
      .put('/api/items/tree')
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send({ newTree });
    expect(res.statusCode).toEqual(200);
     expect(res.body).toHaveProperty('message', 'Tree replaced successfully.');
    expect(Array.isArray(res.body.notesTree)).toBe(true);
    expect(res.body.notesTree.length).toBe(2);
    expect(res.body.notesTree[0].label).toBe(newTree[0].label);
  });

  it('should fail to replace tree when JSON structure is invalid (missing label)', async () => {
    const invalidTree = [{ type: 'note', content: '<p>No label provided API</p>' }];
    const res = await request(app)
      .put('/api/items/tree')
      .set('Authorization', `Bearer ${itemsUserAuthToken}`)
      .send({ newTree: invalidTree });
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/Each item in newTree must have a non-empty label/);
  });
});

// IMAGE UPLOAD ENDPOINT
describe('Image Upload Endpoint', () => {
  let imageUserAuthToken = '';
  const fixturesDir = path.join(__dirname, 'fixtures');
  const imagePath = path.join(fixturesDir, 'test-image.png');
  const invalidImagePath = path.join(fixturesDir, 'test.txt');

  beforeAll(async () => {
    const imageUserEmail = `imageuser-${Date.now()}@e2e.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ email: imageUserEmail, password: testUserPassword });
    
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: imageUserEmail, password: testUserPassword });
    imageUserAuthToken = loginRes.body.accessToken;
    expect(imageUserAuthToken).not.toBe('');

    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    
    await sharp({
        create: {
            width: 1,
            height: 1,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .png()
    .toFile(imagePath);

    fs.writeFileSync(invalidImagePath, 'This is not an image');
  });

  it('should successfully upload a valid image', async () => {
    const res = await request(app)
      .post('/api/images/upload')
      .set('Authorization', `Bearer ${imageUserAuthToken}`)
      .attach('image', imagePath);

    if (res.statusCode !== 201) {
      console.error("Image upload failed. Status:", res.statusCode);
      console.error("Response body:", res.body);
      console.error("Response text:", res.text);
    }
    
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('url');
    expect(res.body.url).toMatch(/\/uploads\/images\//);
    expect(res.body).toHaveProperty('metadata');
  });

  it('should reject uploads with an invalid file type (e.g., .txt)', async () => {
    const res = await request(app)
      .post('/api/images/upload')
      .set('Authorization', `Bearer ${imageUserAuthToken}`)
      .attach('image', invalidImagePath);
      
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/Invalid file type/);
  });
});

// UTILITY FUNCTIONS (backendTreeUtils)
describe('Utility Functions (backendTreeUtils)', () => {
  const dateNow = new Date().toISOString();
  const sampleItems = [
    { id: '1', label: 'Alpha', type: 'note', content: 'First note', createdAt: dateNow, updatedAt: dateNow },
    {
      id: '2', label: 'Beta', type: 'folder', createdAt: dateNow, updatedAt: 'dateNow', children: [
        { id: '3', label: 'Gamma', type: 'note', content: 'Nested note', createdAt: dateNow, updatedAt: dateNow }
      ]
    },
    { id: '4', label: 'Delta', type: 'task', content: 'Task content', completed: false, createdAt: dateNow, updatedAt: dateNow }
  ];

  it('should sort items correctly (folders first, then notes, then tasks, then alphabetically)', () => {
    const unsorted = [
      { id: 'a', label: 'Zeta Note', type: 'note', createdAt: "1", updatedAt: "1" },
      { id: 'b', label: 'Alpha Folder', type: 'folder', children: [], createdAt: "1", updatedAt: "1" },
      { id: 'c', label: 'Theta Task', type: 'task', completed: false, createdAt: "1", updatedAt: "1" }
    ];
    const sorted = sortItems(unsorted);
    expect(sorted[0].type).toEqual('folder');
    expect(sorted[1].type).toEqual('note');
    expect(sorted[2].type).toEqual('task');
  });

  it('should find an item recursively', () => {
    const result = findItemRecursive(sampleItems, '3');
    expect(result).not.toBeNull();
    expect(result.item.label).toEqual('Gamma');
  });

  it('should detect sibling name conflicts correctly (case-insensitive)', () => {
    const siblings = [
      { id: 'a1', label: 'Note A', type: 'note', createdAt: "1", updatedAt: "1" },
      { id: 'a2', label: 'Note B', type: 'note', createdAt: "1", updatedAt: "1" }
    ];
    expect(hasSiblingWithName(siblings, 'note a')).toBe(true);
    expect(hasSiblingWithName(siblings, 'Note B', 'a1')).toBe(true);
    expect(hasSiblingWithName(siblings, 'note c')).toBe(false);
  });

  it('should update an item in tree', () => {
    const updates = { label: 'Updated Alpha', content: 'Updated content' };
    const originalItemTimestamp = sampleItems.find(i => i.id === '1').updatedAt;
    const newTree = updateItemInTree(sampleItems, '1', updates);
    const result = findItemRecursive(newTree, '1');
    expect(result.item.label).toEqual('Updated Alpha');
    expect(result.item.content).toEqual('Updated content');
    expect(result.item.updatedAt).not.toEqual(originalItemTimestamp);
  });
});