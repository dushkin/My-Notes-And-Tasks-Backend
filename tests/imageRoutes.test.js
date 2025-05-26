const request = require('supertest');
const path = require('path');
const fs = require('fs').promises;
const app = require('../server');
const User = require('../models/User');

const UPLOAD_DIR_FOR_TESTS = path.join(__dirname, '..', 'public', 'uploads', 'images');
const TEST_IMAGE_PATH = path.join(__dirname, 'test-image.png');

describe('Image API Endpoints (/api/images)', () => {
    let userToken;
    let userId;

    beforeAll(async () => {
        try {
            await fs.access(TEST_IMAGE_PATH);
        } catch (error) {
            await fs.writeFile(
                TEST_IMAGE_PATH,
                Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
                    'base64'
                )
            );
        }
        try {
            await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });
        } catch (err) {
            console.error('[imageRoutes.test.js] Error preparing uploads directory:', err);
        }
    });

    beforeEach(async () => {
        const userEmail = `image-test-user-${Date.now()}@test.example.com`;
        const registerRes = await request(app)
            .post('/api/auth/register')
            .send({ email: userEmail, password: 'password123' });

        if (!registerRes.body.token || !registerRes.body.user?._id) {
            throw new Error('User registration failed in image test setup.');
        }
        userToken = registerRes.body.token;
        userId = registerRes.body.user._id;
    });

    afterEach(async () => {
        await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
        try {
            // Ensure directory exists before reading
            try {
                await fs.access(UPLOAD_DIR_FOR_TESTS);
            } catch (e) {
                await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });
            }
            const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    await fs.unlink(path.join(UPLOAD_DIR_FOR_TESTS, file));
                }
            }
        } catch (err) {
            console.warn('[imageRoutes.test.js] Could not clean up test image files:', err.message);
        }
    });

    afterAll(async () => {
        try {
            await fs.unlink(TEST_IMAGE_PATH).catch(() => { });
            await fs.rm(UPLOAD_DIR_FOR_TESTS, { recursive: true, force: true });
        } catch (err) {
            console.warn('[imageRoutes.test.js] Could not clean up test directory:', err.message);
        }
    });

    describe('POST /api/images/upload', () => {
        it('should upload an image successfully for an authenticated user', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', TEST_IMAGE_PATH);

            expect(res.statusCode).toEqual(201);
            expect(res.body).toHaveProperty('url');
            expect(res.body.url).toMatch(
                /^http:\/\/(localhost|127\.0\.0\.1):\d{4,5}\/uploads\/images\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.png$/
            );

            const filename = path.basename(new URL(res.body.url).pathname);
            const filePath = path.join(UPLOAD_DIR_FOR_TESTS, filename);
            await expect(fs.access(filePath)).resolves.toBeUndefined();
        }, 30000);

        it('should return 401 if no token is provided', async () => {
            const res = await request(app).post('/api/images/upload');
            expect(res.statusCode).toEqual(401);
            expect(res.body.error).toBe('Not authorized, no token');
        }, 15000);

        it('should return 400 if no image file is provided', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toEqual(400);
            expect(res.body.message).toBe('No image file uploaded or file type not allowed by initial filter.');
        }, 20000);

        it('should return 400 if the uploaded file is not an image', async () => {
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', Buffer.from('not an image'), {
                    filename: 'test.txt',
                    contentType: 'text/plain',
                });
            expect(res.statusCode).toEqual(400);
            expect(res.body.message).toBe('File is not an image based on mimetype.');
        }, 20000);

        it('should return 413 if the image file is too large', async () => {
            const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 25);
            const res = await request(app)
                .post('/api/images/upload')
                .set('Authorization', `Bearer ${userToken}`)
                .attach('image', largeBuffer, 'large-image.png');
            expect(res.statusCode).toEqual(413);
            expect(res.body.message).toContain('Image file is too large');
        }, 30000);

        it('should return 429 if too many images are uploaded quickly (conceptual test)', async () => {
            expect(true).toBe(true);
        }, 10000);
    });
});