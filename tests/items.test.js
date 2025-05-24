// tests/items.test.js
const request = require('supertest');
const path = require('path');
const fs = require('fs').promises;
const app = require('../server');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const { cleanupOrphanedImages } = require('../services/orphanedFileCleanupService');

const UPLOAD_DIR_FOR_TESTS = path.join(__dirname, '..', 'public', 'uploads', 'images');


describe('Items API Endpoints', () => {
    let userToken;
    let userId;
    let userEmail;
    let fixedISOTime;

    beforeAll(async () => {
        try {
            await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });
            const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    await fs.unlink(path.join(UPLOAD_DIR_FOR_TESTS, file));
                }
            }
        } catch (err) {
            console.error("Error preparing uploads directory for item tests:", err);
        }
    });

    beforeEach(async () => {
        userEmail = `items-user-${Date.now()}@test.example.com`;
        const registerRes = await request(app)
            .post('/api/auth/register')
            .send({ email: userEmail, password: 'password123' });

        if (!registerRes.body.token || !registerRes.body.user?._id) {
            console.error("Items test beforeEach: Failed to register user or get token/userId", registerRes.body);
            throw new Error("User registration failed in items test setup.");
        }
        userToken = registerRes.body.token;
        userId = registerRes.body.user._id;

        const user = await User.findById(userId);
        if (user) {
            user.notesTree = [];
            await user.save();
        } else {
            throw new Error(`User ${userId} not found after registration.`);
        }
        fixedISOTime = new Date().toISOString();
    });

    afterAll(async () => {
        await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
        try {
            const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    await fs.unlink(path.join(UPLOAD_DIR_FOR_TESTS, file));
                }
            }
        } catch (err) {
            console.warn("Warning: Could not clean up all test image files:", err.message);
        }
    });

    const isValidISODateString = (dateString) => {
        if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/.test(dateString)) return false;
        const d = new Date(dateString);
        return d instanceof Date && !isNaN(d) && d.toISOString() === dateString;
    };

    describe('GET /api/items/tree', () => {
        it('should get an empty tree for a new user, with items having default timestamps if added by controller logic', async () => {
            const testUser = await User.findById(userId);
            const itemWithoutTimestamps = { id: "old-item-1", type: "note", label: "Old Note", content: "content" };
            testUser.notesTree = [itemWithoutTimestamps];
            testUser.markModified('notesTree');
            await testUser.save();

            const res = await request(app)
                .get('/api/items/tree')
                .set('Authorization', `Bearer ${userToken}`);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('notesTree');
            expect(Array.isArray(res.body.notesTree)).toBe(true);

            if (res.body.notesTree.length > 0) {
                const itemFromServer = res.body.notesTree[0];
                expect(itemFromServer).toHaveProperty('createdAt');
                expect(itemFromServer).toHaveProperty('updatedAt');
                expect(isValidISODateString(itemFromServer.createdAt)).toBe(true);
                expect(isValidISODateString(itemFromServer.updatedAt)).toBe(true);
            }
        });
        it('should return 401 if no token is provided', async () => {
            const res = await request(app).get('/api/items/tree');
            expect(res.statusCode).toEqual(401);
        });
    });

    describe('POST /api/items (create root item) with Timestamps', () => {
        it('should create a new root folder with createdAt and updatedAt timestamps', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Root Folder TS', type: 'folder' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Root Folder TS');
            expect(res.body.type).toBe('folder');
            expect(res.body).toHaveProperty('createdAt');
            expect(res.body).toHaveProperty('updatedAt');
            expect(isValidISODateString(res.body.createdAt)).toBe(true);
            expect(isValidISODateString(res.body.updatedAt)).toBe(true);
            expect(res.body.createdAt).toEqual(res.body.updatedAt);
        });

        it('should create a new root note with createdAt and updatedAt timestamps', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Root Note TS', type: 'note', content: '<p>Hello</p>' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Root Note TS');
            expect(res.body).toHaveProperty('createdAt');
            expect(res.body).toHaveProperty('updatedAt');
            expect(isValidISODateString(res.body.createdAt)).toBe(true);
            expect(isValidISODateString(res.body.updatedAt)).toBe(true);
        });
    });

    describe('POST /api/items/:parentId (create child item) with Timestamps', () => {
        let rootFolderId;
        let rootFolderCreatedAt;
        beforeEach(async () => {
            const folderRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Parent Folder TS', type: 'folder' });
            rootFolderId = folderRes.body.id;
            rootFolderCreatedAt = folderRes.body.createdAt;
        });

        it('should create a child note with createdAt and updatedAt timestamps', async () => {
            const res = await request(app)
                .post(`/api/items/${rootFolderId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Child Note TS', type: 'note', content: 'content' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Child Note TS');
            expect(res.body).toHaveProperty('createdAt');
            expect(res.body).toHaveProperty('updatedAt');
            expect(isValidISODateString(res.body.createdAt)).toBe(true);
            expect(isValidISODateString(res.body.updatedAt)).toBe(true);
            expect(new Date(res.body.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(rootFolderCreatedAt).getTime());
        });
    });

    describe('PATCH /api/items/:itemId with Timestamps', () => {
        let noteId;
        let noteCreatedAt;
        let noteInitialUpdatedAt;

        beforeEach(async () => {
            const noteRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Original Note Patch TS', type: 'note', content: 'Original content' });
            noteId = noteRes.body.id;
            noteCreatedAt = noteRes.body.createdAt;
            noteInitialUpdatedAt = noteRes.body.updatedAt;
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        it('should update an item label and its updatedAt timestamp, createdAt remains unchanged', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Updated Note Label TS' });

            expect(res.statusCode).toEqual(200);
            expect(res.body.label).toBe('Updated Note Label TS');
            expect(res.body.createdAt).toBe(noteCreatedAt);
            expect(res.body.updatedAt).not.toBe(noteInitialUpdatedAt);
            expect(isValidISODateString(res.body.updatedAt)).toBe(true);
            expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(new Date(noteInitialUpdatedAt).getTime());
        });

        it('should update item content and its updatedAt timestamp', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ content: '<p>Updated content TS</p>' });

            expect(res.statusCode).toEqual(200);
            expect(res.body.content).toBe('<p>Updated content TS</p>');
            expect(res.body.createdAt).toBe(noteCreatedAt);
            expect(res.body.updatedAt).not.toBe(noteInitialUpdatedAt);
            expect(isValidISODateString(res.body.updatedAt)).toBe(true);
        });

        it('should update task completion status and its updatedAt timestamp', async () => {
            const taskRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Task to complete TS', type: 'task', completed: false, content: '' });
            const taskId = taskRes.body.id;
            const taskCreatedAt = taskRes.body.createdAt;
            const taskInitialUpdatedAt = taskRes.body.updatedAt;

            await new Promise(resolve => setTimeout(resolve, 50));

            const res = await request(app)
                .patch(`/api/items/${taskId}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ completed: true });

            expect(res.statusCode).toEqual(200);
            expect(res.body.completed).toBe(true);
            expect(res.body.createdAt).toBe(taskCreatedAt);
            expect(res.body.updatedAt).not.toBe(taskInitialUpdatedAt);
            expect(isValidISODateString(res.body.updatedAt)).toBe(true);
        });
    });

    describe('PUT /api/items/tree (replace tree) with Timestamps', () => {
        it('should replace tree, ensuring items have createdAt and new updatedAt timestamps', async () => {
            const oldTimestamp = new Date(Date.now() - 1000000).toISOString();
            const newTreeData = [
                {
                    id: 'client-f1', type: 'folder', label: 'Imported Folder TS', children: [
                        { id: 'client-n1', type: 'note', label: 'Imported Note TS', content: 'imported', createdAt: oldTimestamp, updatedAt: oldTimestamp }
                    ]
                },
                { id: 'client-t1', type: 'task', label: 'Imported Task TS', completed: true, content: '' }
            ];

            const res = await request(app)
                .put('/api/items/tree')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ newTree: newTreeData });

            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toBe('Tree replaced successfully.');
            expect(res.body.notesTree.length).toBe(2);

            const importedFolder = res.body.notesTree.find(item => item.label === 'Imported Folder TS');
            const importedNote = importedFolder.children[0];
            const importedTask = res.body.notesTree.find(item => item.label === 'Imported Task TS');

            expect(importedFolder).toHaveProperty('createdAt');
            expect(isValidISODateString(importedFolder.createdAt)).toBe(true);
            expect(importedFolder).toHaveProperty('updatedAt');
            expect(isValidISODateString(importedFolder.updatedAt)).toBe(true);
            expect(new Date(importedFolder.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(importedFolder.createdAt).getTime());

            expect(importedNote.createdAt).toBe(oldTimestamp);
            expect(importedNote.updatedAt).not.toBe(oldTimestamp);
            expect(isValidISODateString(importedNote.updatedAt)).toBe(true);
            expect(new Date(importedNote.updatedAt).getTime()).toBeGreaterThan(new Date(oldTimestamp).getTime());

            expect(importedTask).toHaveProperty('createdAt');
            expect(isValidISODateString(importedTask.createdAt)).toBe(true);
            expect(importedTask).toHaveProperty('updatedAt');
            expect(isValidISODateString(importedTask.updatedAt)).toBe(true);
            expect(importedTask.updatedAt).toEqual(importedTask.createdAt);
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
        });
        it('should create a new root note', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Root Note', type: 'note', content: '<p>Hello</p>' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Root Note');
        });
        it('should return 400 for missing label or type', async () => {
            let res = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ type: 'folder' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Label is required.');
            res = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Test' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Invalid item type.');
        });
        it('should return 400 if root item with same name exists', async () => {
            await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Unique Root', type: 'folder' });
            const res = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Unique Root', type: 'note' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists at the root level');
        });
    });

    describe('POST /api/items/:parentId (create child item)', () => {
        let rootFolderIdBeforeChildTest;
        beforeEach(async () => {
            const folderRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Parent Folder For Child', type: 'folder' });
            rootFolderIdBeforeChildTest = folderRes.body.id;
        });
        it('should create a child note in a folder', async () => {
            const res = await request(app).post(`/api/items/${rootFolderIdBeforeChildTest}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Note', type: 'note', content: 'content' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Child Note');
        });
        it('should return 404 if parent folder does not exist', async () => {
            const res = await request(app).post(`/api/items/nonexistentfolderid`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Note', type: 'note' });
            expect(res.statusCode).toEqual(404);
        });
        it('should return 400 if child item with same name exists in parent', async () => {
            await request(app).post(`/api/items/${rootFolderIdBeforeChildTest}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Item', type: 'note' });
            const res = await request(app).post(`/api/items/${rootFolderIdBeforeChildTest}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Item', type: 'task' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists in folder');
        });
    });

    describe('PATCH /api/items/:itemId', () => {
        let noteIdToPatch;
        beforeEach(async () => {
            const user = await User.findById(userId);
            const now = new Date().toISOString();
            user.notesTree = [{ id: "note-to-patch-id", label: 'Original Note To Patch', type: 'note', content: 'Original content', createdAt: now, updatedAt: now }];
            await user.save();
            noteIdToPatch = "note-to-patch-id";
        });

        it('should update an item label', async () => {
            const res = await request(app).patch(`/api/items/${noteIdToPatch}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Updated Note Label Patch' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.label).toBe('Updated Note Label Patch');
        });
        it('should update item content', async () => {
            const res = await request(app).patch(`/api/items/${noteIdToPatch}`).set('Authorization', `Bearer ${userToken}`).send({ content: '<p>Updated content Patch</p>' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.content).toBe('<p>Updated content Patch</p>');
        });
        it('should update task completion status', async () => {
            const taskRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Task to complete Patch', type: 'task', completed: false, content: '' });
            const taskId = taskRes.body.id;
            const res = await request(app).patch(`/api/items/${taskId}`).set('Authorization', `Bearer ${userToken}`).send({ completed: true });
            expect(res.statusCode).toEqual(200);
            expect(res.body.completed).toBe(true);
        });
        it('should return 404 if item to update is not found', async () => {
            const res = await request(app).patch(`/api/items/nonexistentitemid`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Does not matter' });
            expect(res.statusCode).toEqual(404);
        });
        it('should return 400 if trying to rename to an existing sibling name', async () => {
            // Ensure the user's tree is clean or set up specifically for this test
            const user = await User.findById(userId);
            const now = new Date().toISOString();
            user.notesTree = [
                { id: "sibling-A", label: 'Sibling A', type: 'note', createdAt: now, updatedAt: now },
                { id: "item-to-rename-for-conflict", label: 'Original Name For Conflict', type: 'note', createdAt: now, updatedAt: now }
            ];
            await user.save();

            const res = await request(app).patch(`/api/items/item-to-rename-for-conflict`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Sibling A' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists in this location');
        });
    });

    describe('DELETE /api/items/:itemId', () => {
        let folderIdToDelete;
        beforeEach(async () => {
            const folderRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Folder to Delete', type: 'folder' });
            folderIdToDelete = folderRes.body.id;
            await request(app).post(`/api/items/${folderIdToDelete}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Note in Delete', type: 'note' });
        });
        it('should delete an item (and its children if folder)', async () => {
            const res = await request(app).delete(`/api/items/${folderIdToDelete}`).set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toBe('Item deleted successfully.');
            const user = await User.findById(userId);
            expect(user.notesTree.find(item => item.id === folderIdToDelete)).toBeUndefined();
        });
        it('should return 200 with message if item to delete is not found', async () => {
            const res = await request(app).delete(`/api/items/nonexistentitemid`).set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toBe('Item not found or already deleted.');
        });
    });

    describe('PUT /api/items/tree (replace tree)', () => {
        it('should replace the entire user tree and regenerate IDs if client IDs are sent', async () => {
            const newTree = [{ id: 'client-f1', type: 'folder', label: 'Imported Folder', children: [{ id: 'client-n1', type: 'note', label: 'Imported Note', content: 'imported' }] }, { id: 'client-t1', type: 'task', label: 'Imported Task', completed: true, content: '' }];
            const res = await request(app).put('/api/items/tree').set('Authorization', `Bearer ${userToken}`).send({ newTree });
            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toBe('Tree replaced successfully.');
            expect(res.body.notesTree.length).toBe(2);
            expect(res.body.notesTree[0].id).not.toBe('client-f1'); // Server should generate new IDs
            expect(res.body.notesTree[0].id).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
        });
        it('should replace the entire user tree and keep existing valid IDs', async () => {
            const existingServerId = uuidv4(); // Generate a valid UUID like the server would
            const newTree = [{ id: existingServerId, type: 'folder', label: 'Folder with Server ID', children: [] }];
            const res = await request(app).put('/api/items/tree').set('Authorization', `Bearer ${userToken}`).send({ newTree });
            expect(res.statusCode).toEqual(200);
            expect(res.body.notesTree.length).toBe(1);
            expect(res.body.notesTree[0].id).toBe(existingServerId); // Server should keep this valid ID
        });
        it('should return 400 if newTree is not an array', async () => {
            const res = await request(app).put('/api/items/tree').set('Authorization', `Bearer ${userToken}`).send({ newTree: { id: 'not-an-array' } });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Invalid tree data: Must be an array.');
        });
    });

    describe('POST /api/images/upload', () => {
        it('should upload an image successfully', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', path.join(__dirname, 'test-image.png'));

            expect(res.statusCode).toEqual(201);
            expect(res.body).toHaveProperty('url');
            expect(res.body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d{4,5}\/uploads\/images\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.png$/);

            const filename = path.basename(res.body.url);
            const filePath = path.join(UPLOAD_DIR_FOR_TESTS, filename);
            await expect(fs.access(filePath)).resolves.toBeUndefined();
        });

        it('should return 400 if no image file is provided', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .send({});
            expect(res.statusCode).toEqual(400);
            expect(res.body.message).toContain('No image file uploaded');
        });

        it('should return 400 if the uploaded file is not an image', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', Buffer.from('this is not an image'), 'test.txt');
            expect(res.statusCode).toEqual(400);
            expect(res.body.message).toBe('File is not an image.');
        });

        it('should return 413 if image is too large', async () => {
            const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 'a');
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', largeBuffer, 'large-image.png');
            expect(res.statusCode).toEqual(413);
            expect(res.body.message).toContain('Image file is too large');
        });
    });

    describe('Orphaned File Cleanup Service', () => {
        it('should run without throwing an error and attempt cleanup', async () => {
            await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });

            const orphanedImageName = 'orphaned-test-image.png';
            const orphanedImagePath = path.join(UPLOAD_DIR_FOR_TESTS, orphanedImageName);
            await fs.writeFile(orphanedImagePath, 'dummy content');

            const usedImageRes = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', path.join(__dirname, 'test-image.png'));
            const usedImageUrl = usedImageRes.body.url;

            const noteRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    label: 'Note with Image',
                    type: 'note',
                    content: `<p>Test</p><img src="${usedImageUrl}" />`
                });
            expect(noteRes.statusCode).toEqual(201);

            await cleanupOrphanedImages();

            await expect(fs.access(orphanedImagePath)).rejects.toThrow();

            const usedImageFilename = path.basename(usedImageUrl);
            await expect(fs.access(path.join(UPLOAD_DIR_FOR_TESTS, usedImageFilename))).resolves.toBeUndefined();
        });
    });
});