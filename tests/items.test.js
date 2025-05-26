// tests/items.test.js
const request = require('supertest');
const path = require('path');
const fs = require('fs').promises;
const app = require('../server');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const { cleanupOrphanedImages } = require('../services/orphanedFileCleanupService');

const UPLOAD_DIR_FOR_TESTS = path.join(__dirname, '..', 'public', 'uploads', 'images');
const TEST_IMAGE_PATH_FOR_ITEMS_TEST = path.join(__dirname, 'test-image.png');

describe('Items API Endpoints', () => {
    let userToken; // This will now be the accessToken
    let userId;
    let userEmail;

    beforeAll(async () => {
        try {
            await fs.access(TEST_IMAGE_PATH_FOR_ITEMS_TEST);
        } catch (error) {
            await fs.writeFile(
                TEST_IMAGE_PATH_FOR_ITEMS_TEST,
                Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
                    'base64'
                )
            );
        }

        try {
            await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });
            const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    await fs.unlink(path.join(UPLOAD_DIR_FOR_TESTS, file));
                }
            }
        } catch (err) {
            // console.error("Error preparing uploads directory for item tests:", err);
        }
    });

    beforeEach(async () => {
        userEmail = `items-user-${Date.now()}@test.example.com`;
        const registerRes = await request(app)
            .post('/api/auth/register')
            .send({ email: userEmail, password: 'password123' });

        if (!registerRes.body.accessToken || !registerRes.body.user?._id) { // Changed from .token to .accessToken
            throw new Error("User registration failed in items test setup.");
        }
        userToken = registerRes.body.accessToken; // Changed from .token to .accessToken
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
        await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
        try {
            const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    await fs.unlink(path.join(UPLOAD_DIR_FOR_TESTS, file));
                }
            }
        } catch (err) {
            // console.warn("Warning: Could not clean up all test image files:", err.message);
        }
        try {
            await fs.unlink(TEST_IMAGE_PATH_FOR_ITEMS_TEST);
        } catch (error) {
            // console.warn("Could not delete items.test.js test-image.png", error.message)
        }
    });

    const isValidISODateString = (dateString) => {
        if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z/.test(dateString)) return false;
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

    describe('POST /api/items (create root item)', () => {
        it('should create a new root folder', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Root Folder', type: 'folder' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Root Folder');
            expect(res.body.type).toBe('folder');
            expect(isValidISODateString(res.body.createdAt)).toBe(true);
            expect(isValidISODateString(res.body.updatedAt)).toBe(true);
        });
        it('should create a new root note', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Root Note', type: 'note', content: '<p>Hello</p>' });
            expect(res.statusCode).toEqual(201);
            expect(res.body.label).toBe('Root Note');
            expect(res.body.content).toBe('<p>Hello</p>');
        });

        it('should return 400 for missing label', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ type: 'folder' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Label is required., Label must be between 1 and 255 characters.');
        });
        it('should return 400 for empty label string', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: '  ', type: 'folder' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Label is required., Label must be between 1 and 255 characters.');
        });
        it('should return 400 for missing or invalid type', async () => {
            let res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Test' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Invalid item type. Must be folder, note, or task.');

            res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Test', type: 'invalidtype' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Invalid item type. Must be folder, note, or task.');
        });
        it('should return 400 if content is not a string when provided', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Note with bad content', type: 'note', content: 123 });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Content must be a string.');
        });
        it('should return 400 if completed is not a boolean when provided', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Task with bad completed', type: 'task', completed: 'true_string' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Completed status must be a boolean.');
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
        it('should return 404 if parent folder does not exist (controller logic)', async () => {
            const res = await request(app).post(`/api/items/nonexistentfolderid`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Note', type: 'note', content: '' });
            expect(res.statusCode).toEqual(404);
            expect(res.body.error).toBe('Parent folder not found or item is not a folder.');
        });
        it('should return 400 if parentId in path is invalid format (e.g. empty string submitted as space)', async () => {
            const res = await request(app)
                .post('/api/items/%20')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Child Note', type: 'note', content: '' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Parent ID path parameter is required.');
        });
        it('should return 400 if child item with same name exists in parent', async () => {
            await request(app).post(`/api/items/${rootFolderIdBeforeChildTest}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Item', type: 'note', content: '' });
            const res = await request(app).post(`/api/items/${rootFolderIdBeforeChildTest}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Item', type: 'task', content: '' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists in folder');
        });
    });

    describe('PATCH /api/items/:itemId', () => {
        let noteIdToPatch;
        let originalTimestamps;

        beforeEach(async () => {
            const initialItemRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Original Note To Patch', type: 'note', content: 'Original content' });

            noteIdToPatch = initialItemRes.body.id;
            originalTimestamps = { createdAt: initialItemRes.body.createdAt, updatedAt: initialItemRes.body.updatedAt };
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        it('should update an item label', async () => {
            const res = await request(app).patch(`/api/items/${noteIdToPatch}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Updated Note Label Patch' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.label).toBe('Updated Note Label Patch');
            expect(res.body.createdAt).toBe(originalTimestamps.createdAt);
            expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(new Date(originalTimestamps.updatedAt).getTime());
        });
        it('should update item content', async () => {
            const res = await request(app).patch(`/api/items/${noteIdToPatch}`).set('Authorization', `Bearer ${userToken}`).send({ content: '<p>Updated content Patch</p>' });
            expect(res.statusCode).toEqual(200);
            expect(res.body.content).toBe('<p>Updated content Patch</p>');
            expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(new Date(originalTimestamps.updatedAt).getTime());
        });
        it('should update task completion status', async () => {
            const taskRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Task to complete Patch', type: 'task', completed: false, content: '' });
            const taskId = taskRes.body.id;
            const taskOriginalUpdatedAt = taskRes.body.updatedAt;
            await new Promise(resolve => setTimeout(resolve, 20));

            const res = await request(app).patch(`/api/items/${taskId}`).set('Authorization', `Bearer ${userToken}`).send({ completed: true });
            expect(res.statusCode).toEqual(200);
            expect(res.body.completed).toBe(true);
            expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(new Date(taskOriginalUpdatedAt).getTime());
        });
        it('should return 400 if itemId is invalid format', async () => {
            const res = await request(app)
                .patch('/api/items/%20')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Updated Label' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Item ID path parameter is required.');
        });
        it('should return 404 if item to update is not found', async () => {
            const res = await request(app).patch(`/api/items/nonexistentitemid-${uuidv4()}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Does not matter' });
            expect(res.statusCode).toEqual(404);
        });
        it('should return 400 if no update data is provided', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteIdToPatch}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({});
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('No update data provided.');
        });
        it('should return 400 for invalid label in update (e.g., empty after trim)', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteIdToPatch}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: '   ' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Label cannot be empty if provided., Label must be between 1 and 255 characters.');
        });
        it('should return 400 for invalid content type in update', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteIdToPatch}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ content: 123 });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Content must be a string if provided.');
        });
        it('should allow explicitly setting content to empty string', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteIdToPatch}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ content: "" });
            expect(res.statusCode).toEqual(200);
            expect(res.body.content).toBe("");
        });
        it('should return 400 for unknown fields in update request', async () => {
            const res = await request(app)
                .patch(`/api/items/${noteIdToPatch}`)
                .set('Authorization', `Bearer ${userToken}`)
                .send({ label: "New Label", unknownField: "someValue" });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('Unknown field(s) in update request: unknownField');
        });
        it('should return 400 if trying to rename to an existing sibling name', async () => {
            await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`)
                .send({ label: 'Sibling A', type: 'note', content: '' });

            const res = await request(app).patch(`/api/items/${noteIdToPatch}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Sibling A' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toContain('already exists in this location');
        });
    });

    describe('DELETE /api/items/:itemId', () => {
        let folderIdToDelete;
        beforeEach(async () => {
            const folderRes = await request(app).post('/api/items').set('Authorization', `Bearer ${userToken}`).send({ label: 'Folder to Delete', type: 'folder' });
            folderIdToDelete = folderRes.body.id;
            await request(app).post(`/api/items/${folderIdToDelete}`).set('Authorization', `Bearer ${userToken}`).send({ label: 'Child Note in Delete', type: 'note', content: '' });
        });

        it('should delete an item (and its children if folder)', async () => {
            const res = await request(app).delete(`/api/items/${folderIdToDelete}`).set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toEqual(200);
            expect(res.body.message).toBe('Item deleted successfully.');
            const user = await User.findById(userId);
            expect(user.notesTree.find(item => item.id === folderIdToDelete)).toBeUndefined();
        });
        it('should return 400 if itemId is invalid format for delete', async () => {
            const res = await request(app)
                .delete('/api/items/%20')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Item ID path parameter is required.');
        });
        it('should return 200 with message if item to delete is not found (controller logic)', async () => {
            const res = await request(app).delete(`/api/items/nonexistentitemid-${uuidv4()}`).set('Authorization', `Bearer ${userToken}`);
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
            expect(res.body.notesTree[0].id).not.toBe('client-f1');
            expect(res.body.notesTree[0].id).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
        });
        it('should replace the entire user tree and keep existing valid server-generated IDs', async () => {
            const existingServerId = uuidv4();
            const newTree = [{ id: existingServerId, type: 'folder', label: 'Folder with Server ID', children: [] }];
            const res = await request(app).put('/api/items/tree').set('Authorization', `Bearer ${userToken}`).send({ newTree });
            expect(res.statusCode).toEqual(200);
            expect(res.body.notesTree.length).toBe(1);
            expect(res.body.notesTree[0].id).toBe(existingServerId);
        });
        it('should return 400 if newTree is not an array', async () => {
            const res = await request(app).put('/api/items/tree').set('Authorization', `Bearer ${userToken}`).send({ newTree: { id: 'not-an-array' } });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Invalid tree data: newTree must be an array.');
        });
        it('should return 400 if an item in newTree is malformed (e.g., missing label)', async () => {
            const newTree = [{ type: 'folder' }];
            const res = await request(app)
                .put('/api/items/tree')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ newTree });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Each item in newTree must have a non-empty label.');
        });
        it('should return 400 if an item in newTree has invalid type', async () => {
            const newTree = [{ label: 'Bad Type Item', type: 'invalid' }];
            const res = await request(app)
                .put('/api/items/tree')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ newTree });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Each item in newTree must have a valid type (folder, note, task).');
        });
    });

    describe('POST /api/images/upload', () => {
        it('should upload an image successfully', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', TEST_IMAGE_PATH_FOR_ITEMS_TEST);

            expect(res.statusCode).toEqual(201);
            expect(res.body).toHaveProperty('url');
            expect(res.body.url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d{4,5}\/uploads\/images\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.png$/);

            const filename = path.basename(new URL(res.body.url).pathname);
            const filePath = path.join(UPLOAD_DIR_FOR_TESTS, filename);
            await expect(fs.access(filePath)).resolves.toBeUndefined();
        });

        it('should return 400 if no image file is provided', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .send({});
            expect(res.statusCode).toEqual(400);
            expect(res.body.message).toBe('No image file uploaded or file type not allowed by initial filter.');
        });

        it('should return 400 if the uploaded file is not an image', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', Buffer.from('this is not an image'), 'test.txt');
            expect(res.statusCode).toEqual(400);
            expect(res.body.message).toBe('File is not an image based on mimetype.');
        });

        it('should return 413 if image is too large', async () => {
            const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 'a');
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', largeBuffer, 'large-image.png');
            expect(res.statusCode).toEqual(413);
            expect(res.body.message).toContain('Image file is too large. Max 10MB allowed.');
        });
    });

    describe('Orphaned File Cleanup Service', () => {
        it('should run without throwing an error and attempt cleanup', async () => {
            await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });

            const orphanedImageName = 'orphaned-test-image.png';
            const orphanedImagePath = path.join(UPLOAD_DIR_FOR_TESTS, orphanedImageName);
            await fs.writeFile(orphanedImagePath, 'dummy content');

            const imageUploadRes = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', TEST_IMAGE_PATH_FOR_ITEMS_TEST);

            expect(imageUploadRes.statusCode).toBe(201);
            const usedImageUrl = imageUploadRes.body.url;

            const noteCreationRes = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    label: 'Note with Image',
                    type: 'note',
                    content: `<p>Test</p><img src="${usedImageUrl}" />`
                });
            expect(noteCreationRes.statusCode).toBe(201);

            await cleanupOrphanedImages();

            await expect(fs.access(orphanedImagePath)).rejects.toThrow(/ENOENT/);

            const usedImageFilename = path.basename(new URL(usedImageUrl).pathname);
            await expect(fs.access(path.join(UPLOAD_DIR_FOR_TESTS, usedImageFilename))).resolves.toBeUndefined();
        });
    });
});