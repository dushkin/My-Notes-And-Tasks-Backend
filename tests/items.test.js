// tests/items.test.js
const request = require('supertest');
const path = require('path');
const fs = require('fs').promises;
const app = require('../server');
const User = require('../models/User');
const { cleanupOrphanedImages } = require('../services/orphanedFileCleanupService');

// Define the UPLOAD_DIR consistent with imageRoutes.js and orphanedFileCleanupService.js
// Assuming tests run from project root, and 'public' is at the root.
const UPLOAD_DIR_FOR_TESTS = path.join(__dirname, '..', 'public', 'uploads', 'images');


describe('Items API Endpoints', () => {
    let userToken;
    let userId;
    let userEmail;

    beforeAll(async () => {
        // Ensure upload directory exists for tests, clear it before all tests in this suite
        try {
            await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });
            const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
            for (const file of files) {
                if (file !== '.gitkeep') { // Don't delete .gitkeep if you use one
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
    });

    afterAll(async () => {
        // Clean up any created test users
        await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
        // Clean up any test image files
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
        let rootFolderId;
        beforeEach(async () => {
            const folderRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Parent Folder', type: 'folder' });
            rootFolderId = folderRes.body.id;
        });
        it('should create a child note in a folder', async () => {
            const res = await request(app).post(`/api/items/${rootFolderId}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Note', type: 'note', content: 'content' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Child Note');
        });
        it('should return 404 if parent folder does not exist', async () => {
            const res = await request(app).post(`/api/items/nonexistentfolderid`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Note', type: 'note' });
            expect(res.statusCode).toEqual(404);
        });
        it('should return 400 if child item with same name exists in parent', async () => {
            await request(app).post(`/api/items/${rootFolderId}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Item', type: 'note' });
            const res = await request(app).post(`/api/items/${rootFolderId}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Item', type: 'task' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists in folder');
        });
    });

    describe('PATCH /api/items/:itemId', () => {
        let noteId;
        beforeEach(async () => {
            // Ensure each test starts with a fresh item to update
            const user = await User.findById(userId);
            user.notesTree = [{ id: "note-to-update", label: 'Original Note', type: 'note', content: 'Original content' }];
            await user.save();
            noteId = "note-to-update"; // Use a predictable ID for this specific test setup if needed

            // Or, create dynamically if that's preferred, ensuring ID is captured
            // const noteRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Original Note', type: 'note', content: 'Original content' });
            // noteId = noteRes.body.id;
        });

        it('should update an item label', async () => {
            const res = await request(app).patch(`/api/items/${noteId}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Updated Note Label' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.label).toBe('Updated Note Label');
        });
        it('should update item content', async () => {
            const res = await request(app).patch(`/api/items/${noteId}`).set('Authorization', `Bearer ${userToken}`).send({ content: '<p>Updated content</p>' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.content).toBe('<p>Updated content</p>');
        });
        it('should update task completion status', async () => {
            const taskRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Task to complete', type: 'task', completed: false, content: '' });
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
            await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Sibling A', type: 'note' });
            // The item to rename (noteId) already exists from beforeEach
            // const itemToRenameRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Sibling B', type: 'note' });
            // const itemToRenameId = itemToRenameRes.body.id;
            const res = await request(app).patch(`/api/items/${noteId}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Sibling A' });
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
            expect(res.statusCode).toBe(200); // Changed from 404 to 200 based on common practice for idempotent deletes or your controller logic
            expect(res.body.message).toBe('Item not found or already deleted.');
        });
    });

    describe('PUT /api/items/tree (replace tree)', () => {
        it('should replace the entire user tree and regenerate IDs', async () => {
            const newTree = [{ id: 'client-f1', type: 'folder', label: 'Imported Folder', children: [{ id: 'client-n1', type: 'note', label: 'Imported Note', content: 'imported' }] }, { id: 'client-t1', type: 'task', label: 'Imported Task', completed: true, content: '' }];
            const res = await request(app).put('/api/items/tree').set('Authorization', `Bearer ${userToken}`).send({ newTree });
            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toBe('Tree replaced successfully.');
            expect(res.body.notesTree.length).toBe(2);
            expect(res.body.notesTree[0].id).not.toBe('client-f1');
            expect(res.body.notesTree[0].id).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
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
            await expect(fs.access(filePath)).resolves.toBeUndefined(); // Check if file exists
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
            const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 'a'); // 11MB file
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
            await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true }); // Ensure directory exists

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