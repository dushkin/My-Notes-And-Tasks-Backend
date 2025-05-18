// tests/items.test.js
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');

describe('Items API Endpoints', () => {
    let userToken;
    let userId;
    let userEmail;

    beforeEach(async () => {
        // Global beforeEach in setupTests.js should clear users matching a pattern
        // Create a fresh user for each item test to ensure isolation for item manipulations
        userEmail = `itemsuser-${Date.now()}@test.example.com`;
        const registerRes = await request(app)
            .post('/api/auth/register')
            .send({ email: userEmail, password: 'password123' });

        if (!registerRes.body.token || !registerRes.body.user?._id) {
            console.error("Items test beforeEach: Failed to register user or get token/userId", registerRes.body);
            throw new Error("User registration failed in items test setup, cannot proceed.");
        }
        userToken = registerRes.body.token;
        userId = registerRes.body.user._id;

        // Ensure the user's notesTree is empty before each specific item test scenario
        const user = await User.findById(userId);
        if (user) {
            user.notesTree = [];
            await user.save();
        } else {
            throw new Error(`User ${userId} not found after registration in beforeEach of items.test.js`);
        }
    });

    describe('GET /api/items/tree', () => {
        it('should get an empty tree for a new user', async () => {
            const res = await request(app)
                .get('/api/items/tree')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('notesTree');
            expect(res.body.notesTree).toEqual([]);
        });

        it('should return 401 if no token is provided', async () => {
            const res = await request(app).get('/api/items/tree');
            expect(res.statusCode).toEqual(401);
        });
    });

    describe('POST /api/items (create root item)', () => {
        it('should create a new root folder', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Root Folder', type: 'folder' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Root Folder');
            expect(res.body.type).toBe('folder');
            expect(res.body).toHaveProperty('id');
            expect(res.body.children).toEqual([]);

            const user = await User.findById(userId);
            expect(user.notesTree.length).toBe(1);
            expect(user.notesTree[0].label).toBe('Root Folder');
        });

        it('should create a new root note', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Root Note', type: 'note', content: '<p>Hello</p>' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Root Note');
            expect(res.body.type).toBe('note');
            expect(res.body.content).toBe('<p>Hello</p>');
        });

        it('should return 400 for missing label or type', async () => {
            let res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ type: 'folder' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Label is required.');

            res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Test' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Invalid item type.');
        });

        it('should return 400 if root item with same name exists', async () => {
            await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Unique Root', type: 'folder' });

            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Unique Root', type: 'note' });

            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists at the root level');
        });
    });

    describe('POST /api/items/:parentId (create child item)', () => {
        let rootFolderId;
        beforeEach(async () => {
            const folderRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Parent Folder', type: 'folder' });
            rootFolderId = folderRes.body.id;
        });

        it('should create a child note in a folder', async () => {
            const res = await request(app)
                .post(`/api/items/${rootFolderId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Child Note', type: 'note', content: 'content' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Child Note');

            const user = await User.findById(userId);
            const parentFolder = user.notesTree.find(i => i.id === rootFolderId);
            expect(parentFolder.children.length).toBe(1);
            expect(parentFolder.children[0].label).toBe('Child Note');
        });

        it('should return 404 if parent folder does not exist', async () => {
            const res = await request(app)
                .post(`/api/items/nonexistentfolderid`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Child Note', type: 'note' });
            expect(res.statusCode).toEqual(404);
        });

        it('should return 400 if child item with same name exists in parent', async () => {
            await request(app)
                .post(`/api/items/${rootFolderId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Child Item', type: 'note' });

            const res = await request(app)
                .post(`/api/items/${rootFolderId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Child Item', type: 'task' });

            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists in folder');
        });
    });

    describe('PATCH /api/items/:itemId', () => {
        let noteId;
        beforeEach(async () => {
            const noteRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Original Note', type: 'note', content: 'Original content' });
            noteId = noteRes.body.id;
        });

        it('should update an item label', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Updated Note Label' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.id).toBe(noteId);
            expect(res.body.label).toBe('Updated Note Label');
            expect(res.body.content).toBe('Original content');
        });

        it('should update item content', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ content: '<p>Updated content</p>' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.id).toBe(noteId);
            expect(res.body.content).toBe('<p>Updated content</p>');
            expect(res.body.label).toBe('Original Note');
        });

        it('should update task completion status', async () => {
            const taskRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Task to complete', type: 'task', completed: false, content: '' });
            const taskId = taskRes.body.id;

            const res = await request(app)
                .patch(`/api/items/${taskId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ completed: true });
            expect(res.statusCode).toEqual(200);
            expect(res.body.id).toBe(taskId);
            expect(res.body.completed).toBe(true);
        });

        it('should return 404 if item to update is not found', async () => {
            const res = await request(app)
                .patch(`/api/items/nonexistentitemid`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Does not matter' });
            expect(res.statusCode).toEqual(404);
        });

        it('should return 400 if trying to rename to an existing sibling name', async () => {
            await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Sibling A', type: 'note' });

            const itemToRenameRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Sibling B', type: 'note' });
            const itemToRenameId = itemToRenameRes.body.id;

            const res = await request(app)
                .patch(`/api/items/${itemToRenameId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Sibling A' });

            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists in this location');
        });
    });

    describe('DELETE /api/items/:itemId', () => {
        let folderIdToDelete;
        beforeEach(async () => {
            const folderRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Folder to Delete', type: 'folder' });
            folderIdToDelete = folderRes.body.id;

            await request(app)
                .post(`/api/items/${folderIdToDelete}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Child Note in Delete', type: 'note' });
        });

        it('should delete an item (and its children if folder)', async () => {
            const res = await request(app)
                .delete(`/api/items/${folderIdToDelete}`)
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toBe('Item deleted successfully.');

            const user = await User.findById(userId);
            expect(user.notesTree.find(item => item.id === folderIdToDelete)).toBeUndefined();
        });

        it('should return 200 with message if item to delete is not found', async () => {
            const res = await request(app)
                .delete(`/api/items/nonexistentitemid`)
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toBe('Item not found or already deleted.');
        });
    });

    describe('PUT /api/items/tree (replace tree)', () => {
        it('should replace the entire user tree and regenerate IDs', async () => {
            const newTree = [
                {
                    id: 'client-f1', type: 'folder', label: 'Imported Folder', children: [
                        { id: 'client-n1', type: 'note', label: 'Imported Note', content: 'imported' }
                    ]
                },
                { id: 'client-t1', type: 'task', label: 'Imported Task', completed: true, content: '' }
            ];

            const res = await request(app)
                .put('/api/items/tree')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ newTree });

            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toBe('Tree replaced successfully.');
            expect(res.body.notesTree).toBeDefined();
            expect(res.body.notesTree.length).toBe(2);
            expect(res.body.notesTree[0].label).toBe('Imported Folder');
            expect(res.body.notesTree[0].children[0].label).toBe('Imported Note');

            expect(res.body.notesTree[0].id).not.toBe('client-f1');
            expect(res.body.notesTree[0].id).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
            expect(res.body.notesTree[0].children[0].id).not.toBe('client-n1');
            expect(res.body.notesTree[0].children[0].id).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
            expect(res.body.notesTree[1].id).not.toBe('client-t1');
            expect(res.body.notesTree[1].id).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

            const user = await User.findById(userId);
            expect(user.notesTree.length).toBe(2);
            expect(user.notesTree[0].id).toEqual(res.body.notesTree[0].id);
            expect(user.notesTree[0].label).toBe('Imported Folder');
        });

        it('should return 400 if newTree is not an array', async () => {
            const res = await request(app)
                .put('/api/items/tree')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ newTree: { id: 'not-an-array' } });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Invalid tree data: Must be an array.');
        });
    });
});