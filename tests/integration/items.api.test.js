// tests/integration/items.api.test.js
import request from 'supertest';
import app from '../../server.js';
import { 
  cleanupTestData, 
  createTestUser, 
  makeAuthenticatedRequest, 
  mockData,
  assertions 
} from '../helpers/testHelpers.js';

describe('Integration Tests - Items API', () => {
  let authToken;
  let userId;
  let authRequest;

  beforeEach(async () => {
    const { user, token } = await createTestUser(`itemsuser-${Date.now()}@test.com`);
    authToken = token;
    userId = user._id;
    authRequest = makeAuthenticatedRequest(app, authToken);
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('GET /api/items', () => {
    it('should get empty tree for new user', async () => {
      const res = await authRequest.get('/api/items');

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('notesTree');
      expect(Array.isArray(res.body.notesTree)).toBe(true);
      expect(res.body.notesTree).toHaveLength(0);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/api/items');
      assertions.expectErrorResponse(res, 401);
    });

    it('should return populated tree with items', async () => {
      // Create some test items
      await authRequest.post('/api/items')
        .send(mockData.item({ label: 'Test Note' }));
      await authRequest.post('/api/items')
        .send(mockData.folder({ label: 'Test Folder' }));

      const res = await authRequest.get('/api/items');

      expect(res.statusCode).toEqual(200);
      expect(res.body.notesTree).toHaveLength(2);
      expect(res.body.notesTree[0].type).toBe('folder'); // Should be sorted
      expect(res.body.notesTree[1].type).toBe('note');
    });
  });

  describe('POST /api/items', () => {
    it('should create a new root-level note', async () => {
      const itemData = { label: 'Test Root Note', type: 'note', content: '<p>Test content</p>' };
      const res = await authRequest.post('/api/items').send(itemData);

      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.label).toEqual(itemData.label);
      expect(res.body.type).toEqual(itemData.type);
      expect(res.body.content).toBeDefined();
    });

    it('should create a new folder', async () => {
      const folderData = { label: 'Test Folder', type: 'folder' };
      const res = await authRequest.post('/api/items').send(folderData);

      expect(res.statusCode).toEqual(201);
      expect(res.body.type).toEqual('folder');
      expect(res.body.children).toEqual([]);
    });

    it('should create a new task', async () => {
      const taskData = { label: 'Test Task', type: 'task', completed: false };
      const res = await authRequest.post('/api/items').send(taskData);

      expect(res.statusCode).toEqual(201);
      expect(res.body.type).toEqual('task');
      expect(res.body.completed).toBe(false);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/items')
        .send(mockData.item());
      assertions.expectErrorResponse(res, 401);
    });

    it('should validate required fields', async () => {
      // Missing label
      let res = await authRequest.post('/api/items')
        .send({ type: 'note', content: '<p>content</p>' });
      assertions.expectErrorResponse(res, 400);

      // Missing type
      res = await authRequest.post('/api/items')
        .send({ label: 'Test', content: '<p>content</p>' });
      assertions.expectErrorResponse(res, 400);
    });

    it('should validate item type', async () => {
      const res = await authRequest.post('/api/items')
        .send({ label: 'Test', type: 'invalid-type' });
      assertions.expectErrorResponse(res, 400);
    });

    it('should handle XSS prevention in content', async () => {
      const maliciousContent = '<script>alert("xss")</script><p>Safe content</p>';
      const res = await authRequest.post('/api/items')
        .send({ label: 'Test Item', type: 'note', content: maliciousContent });

      expect(res.statusCode).toEqual(201);
      // Content should be sanitized
      expect(res.body.content).not.toContain('<script>');
      expect(res.body.content).toContain('Safe content');
    });
  });

  describe('POST /api/items/:parentId', () => {
    let parentId;

    beforeEach(async () => {
      const folderRes = await authRequest.post('/api/items')
        .send({ label: 'Parent Folder', type: 'folder' });
      parentId = folderRes.body.id;
    });

    it('should create a child item inside a folder', async () => {
      const childData = { label: 'Child Note', type: 'note' };
      const res = await authRequest.post(`/api/items/${parentId}`)
        .send(childData);

      expect(res.statusCode).toEqual(201);
      expect(res.body.label).toEqual(childData.label);
      
      // Verify tree structure
      const treeRes = await authRequest.get('/api/items');
      const folder = treeRes.body.notesTree.find(item => item.id === parentId);
      expect(folder.children).toHaveLength(1);
      expect(folder.children[0].id).toBe(res.body.id);
    });

    it('should prevent creating duplicate siblings with same name', async () => {
      const siblingData = mockData.item({ label: 'Unique Sibling' });
      
      // Create first child
      await authRequest.post(`/api/items/${parentId}`).send(siblingData);
      
      // Attempt to create duplicate
      const res = await authRequest.post(`/api/items/${parentId}`)
        .send(siblingData);

      assertions.expectErrorResponse(res, 400);
      expect(res.body.error).toMatch(/already exists/i);
    });

    it('should handle case-insensitive duplicate detection', async () => {
      await authRequest.post(`/api/items/${parentId}`)
        .send(mockData.item({ label: 'Test Item' }));
      
      const res = await authRequest.post(`/api/items/${parentId}`)
        .send(mockData.item({ label: 'TEST ITEM' }));

      assertions.expectErrorResponse(res, 400);
    });

    it('should fail with non-existent parent', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await authRequest.post(`/api/items/${fakeId}`)
        .send({ label: 'Test Item', type: 'note' });

      assertions.expectErrorResponse(res, 404); // API returns 404 for parent not found
    });

    it('should fail with invalid parent ID format', async () => {
      const res = await authRequest.post('/api/items/invalid-id')
        .send({ label: 'Test Item', type: 'note' });

      assertions.expectErrorResponse(res, 404);
    });
  });

  describe('GET /api/items/:id', () => {
    let itemId;

    beforeEach(async () => {
      const itemRes = await authRequest.post('/api/items')
        .send(mockData.item({ label: 'Test Item' }));
      itemId = itemRes.body.id;
    });

    it('should get an existing item', async () => {
      const res = await authRequest.get(`/api/items/${itemId}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.id).toBe(itemId);
      expect(res.body.label).toBe('Test Item');
      assertions.expectValidItem(res.body);
    });

    it('should fail with non-existent item', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await authRequest.get(`/api/items/${fakeId}`);

      assertions.expectErrorResponse(res, 404);
    });

    it('should require authentication', async () => {
      const res = await request(app).get(`/api/items/${itemId}`);
      assertions.expectErrorResponse(res, 401);
    });

    it('should not allow access to other users items', async () => {
      // Create another user
      const { token: otherToken } = await createTestUser(`other-${Date.now()}@test.com`);
      const otherAuthRequest = makeAuthenticatedRequest(app, otherToken);

      const res = await otherAuthRequest.get(`/api/items/${itemId}`);
      assertions.expectErrorResponse(res, 404);
    });
  });

  describe('PATCH /api/items/:id', () => {
    let itemId;

    beforeEach(async () => {
      const itemRes = await authRequest.post('/api/items')
        .send(mockData.item({ label: 'Original Item' }));
      itemId = itemRes.body.id;
    });

    it('should update an existing item', async () => {
      const updateData = { 
        label: 'Updated Item', 
        content: '<p>Updated content</p>' 
      };
      const res = await authRequest.patch(`/api/items/${itemId}`)
        .send(updateData);

      expect(res.statusCode).toEqual(200);
      expect(res.body.label).toEqual('Updated Item');
      expect(res.body.content).toContain('Updated content');
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(res.body.createdAt).getTime()
      );
    });

    it('should return original item if no changes made', async () => {
      const originalRes = await authRequest.get(`/api/items/${itemId}`);
      const originalUpdatedAt = originalRes.body.updatedAt;

      const res = await authRequest.patch(`/api/items/${itemId}`)
        .send({ label: originalRes.body.label });

      expect(res.statusCode).toEqual(200);
      expect(res.body.updatedAt).toBe(originalUpdatedAt);
    });

    it('should validate update data', async () => {
      const res = await authRequest.patch(`/api/items/${itemId}`)
        .send({ type: 'invalid-type' });

      assertions.expectErrorResponse(res, 400);
    });

    it('should handle partial updates', async () => {
      const res = await authRequest.patch(`/api/items/${itemId}`)
        .send({ label: 'Only Label Updated' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.label).toBe('Only Label Updated');
      expect(res.body.content).toBe('&lt;p&gt;Mock content&lt;/p&gt;'); // Original content preserved (HTML encoded)
    });

    it('should prevent XSS in updates', async () => {
      const maliciousUpdate = { content: '<script>alert("xss")</script><p>Clean</p>' };
      const res = await authRequest.patch(`/api/items/${itemId}`)
        .send(maliciousUpdate);

      expect(res.statusCode).toEqual(200);
      expect(res.body.content).not.toContain('<script>');
      expect(res.body.content).toContain('Clean');
    });

    it('should fail with non-existent item', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await authRequest.patch(`/api/items/${fakeId}`)
        .send({ label: 'Update' });

      assertions.expectErrorResponse(res, 404);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .patch(`/api/items/${itemId}`)
        .send({ label: 'Update' });
      assertions.expectErrorResponse(res, 401);
    });
  });

  describe('DELETE /api/items/:id', () => {
    let itemId;

    beforeEach(async () => {
      const itemRes = await authRequest.post('/api/items')
        .send(mockData.item({ label: 'Item to Delete' }));
      itemId = itemRes.body.id;
    });

    it('should delete an existing item', async () => {
      const res = await authRequest.delete(`/api/items/${itemId}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('message', 'Item deleted successfully.');

      // Verify item is deleted
      const getRes = await authRequest.get(`/api/items/${itemId}`);
      assertions.expectErrorResponse(getRes, 404);
    });

    it('should be idempotent (delete non-existent item)', async () => {
      // Delete once
      await authRequest.delete(`/api/items/${itemId}`);

      // Delete again
      const res = await authRequest.delete(`/api/items/${itemId}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toMatch(/not found or already deleted/i);
    });

    it('should delete folder with all children', async () => {
      // Create folder with child
      const folderRes = await authRequest.post('/api/items')
        .send(mockData.folder({ label: 'Folder to Delete' }));
      const folderId = folderRes.body.id;

      const childRes = await authRequest.post(`/api/items/${folderId}`)
        .send(mockData.item({ label: 'Child Item' }));
      const childId = childRes.body.id;

      // Delete folder
      const res = await authRequest.delete(`/api/items/${folderId}`);
      expect(res.statusCode).toEqual(200);

      // Verify both folder and child are deleted
      const folderGetRes = await authRequest.get(`/api/items/${folderId}`);
      const childGetRes = await authRequest.get(`/api/items/${childId}`);
      assertions.expectErrorResponse(folderGetRes, 404);
      assertions.expectErrorResponse(childGetRes, 404);
    });

    it('should require authentication', async () => {
      const res = await request(app).delete(`/api/items/${itemId}`);
      assertions.expectErrorResponse(res, 401);
    });

    it('should not allow deleting other users items', async () => {
      const { token: otherToken } = await createTestUser(`other-${Date.now()}@test.com`);
      const otherAuthRequest = makeAuthenticatedRequest(app, otherToken);

      const res = await otherAuthRequest.delete(`/api/items/${itemId}`);
      // Should return 200 (idempotent) to prevent information leakage
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toMatch(/not found or already deleted/i);
    });
  });

  describe('PUT /api/items/tree', () => {
    it('should replace the entire tree', async () => {
      const newTree = [
        mockData.folder({ 
          label: 'Folder A', 
          children: [mockData.item({ label: 'Note A1' })] 
        }),
        mockData.item({ label: 'Note B' })
      ];

      console.log('TEST: Sending newTree:', JSON.stringify(newTree, null, 2));

      const res = await authRequest.put('/api/items/tree')
        .send({ newTree });

      console.log('TEST: Response body:', JSON.stringify(res.body, null, 2));

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('message', 'Tree replaced successfully.');
      expect(Array.isArray(res.body.notesTree)).toBe(true);
      expect(res.body.notesTree).toHaveLength(2);
      expect(res.body.notesTree[0].label).toBe('Folder A');
    });

    it('should validate tree structure', async () => {
      const invalidTree = [{ type: 'note', content: '<p>Missing label</p>' }];
      const res = await authRequest.put('/api/items/tree')
        .send({ newTree: invalidTree });

      assertions.expectErrorResponse(res, 400);
      expect(res.body.error).toMatch(/must have a non-empty label/i);
    });

    it('should handle empty tree replacement', async () => {
      const res = await authRequest.put('/api/items/tree')
        .send({ newTree: [] });

      expect(res.statusCode).toEqual(200);
      expect(res.body.notesTree).toHaveLength(0);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .put('/api/items/tree')
        .send({ newTree: [] });
      assertions.expectErrorResponse(res, 401);
    });

    it('should preserve user isolation', async () => {
      // User 1 creates items
      await authRequest.post('/api/items')
        .send(mockData.item({ label: 'User 1 Item' }));

      // User 2 replaces their tree
      const { token: user2Token } = await createTestUser(`user2-${Date.now()}@test.com`);
      const user2Request = makeAuthenticatedRequest(app, user2Token);
      
      const newTree = [mockData.item({ label: 'User 2 Item' })];
      await user2Request.put('/api/items/tree').send({ newTree });

      // User 1's items should still exist
      const user1Tree = await authRequest.get('/api/items');
      expect(user1Tree.body.notesTree).toHaveLength(1);
      expect(user1Tree.body.notesTree[0].label).toBe('User 1 Item');
    });
  });
});