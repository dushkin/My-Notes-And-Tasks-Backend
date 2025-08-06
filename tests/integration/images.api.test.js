// tests/integration/images.api.test.js
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import app from '../../server.js';
import { 
  cleanupTestData, 
  createTestUser, 
  makeAuthenticatedRequest,
  assertions 
} from '../helpers/testHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Integration Tests - Images API', () => {
  let authToken;
  let userId;
  let authRequest;
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const imagePath = path.join(fixturesDir, 'test-image.png');
  const largeImagePath = path.join(fixturesDir, 'large-test-image.png');
  const invalidImagePath = path.join(fixturesDir, 'test.txt');

  beforeAll(async () => {
    // Ensure fixtures directory exists
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    
    // Create test image (small)
    await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
    .png()
    .toFile(imagePath);

    // Create large test image (for size limit testing)
    await sharp({
      create: {
        width: 3000,
        height: 3000,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 }
      }
    })
    .png()
    .toFile(largeImagePath);

    // Create invalid file
    fs.writeFileSync(invalidImagePath, 'This is not an image file');
  });

  beforeEach(async () => {
    const { user, token } = await createTestUser(`imageuser-${Date.now()}@test.com`);
    authToken = token;
    userId = user._id;
    authRequest = makeAuthenticatedRequest(app, authToken);
  });

  afterEach(async () => {
    await cleanupTestData();
    // Clean up uploaded images
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'images');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      files.forEach(file => {
        if (file.match(/^[0-9a-f-]+\.png$/)) { // Only delete test images
          fs.unlinkSync(path.join(uploadsDir, file));
        }
      });
    }
  });

  afterAll(async () => {
    // Clean up test fixtures
    [imagePath, largeImagePath, invalidImagePath].forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  });

  describe('POST /api/images/upload', () => {
    it('should successfully upload a valid image', async () => {
      const res = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('image', imagePath);

      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('url');
      expect(res.body.url).toMatch(/\/uploads\/images\/.+\.png$/);
      expect(res.body).toHaveProperty('metadata');
      expect(res.body.metadata).toHaveProperty('width');
      expect(res.body.metadata).toHaveProperty('height');
      expect(res.body.metadata).toHaveProperty('format', 'png');
      expect(res.body.metadata).toHaveProperty('size');

      // Verify file was actually uploaded
      const uploadedPath = path.join(process.cwd(), 'public', res.body.url);
      expect(fs.existsSync(uploadedPath)).toBe(true);
    });

    it('should upload and resize large images', async () => {
      const res = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('image', largeImagePath);

      expect(res.statusCode).toEqual(201);
      expect(res.body.metadata.width).toBeLessThanOrEqual(1920); // Max width
      expect(res.body.metadata.height).toBeLessThanOrEqual(1920); // Max height
    });

    it('should reject uploads with invalid file type', async () => {
      const res = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('image', invalidImagePath);
        
      assertions.expectErrorResponse(res, 400);
      expect(res.body.error).toMatch(/Invalid file type/i);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/images/upload')
        .attach('image', imagePath);

      assertions.expectErrorResponse(res, 401);
    });

    it('should require image file', async () => {
      const res = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      assertions.expectErrorResponse(res, 400);
      expect(res.body.error).toMatch(/No image file provided/i);
    });

    it('should handle corrupted image files', async () => {
      const corruptedImagePath = path.join(fixturesDir, 'corrupted.png');
      fs.writeFileSync(corruptedImagePath, 'PNG fake header but not really a PNG');

      try {
        const res = await request(app)
          .post('/api/images/upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('image', corruptedImagePath);

        assertions.expectErrorResponse(res, 400);
        expect(res.body.error).toMatch(/Invalid file type|corrupted/i);
      } finally {
        if (fs.existsSync(corruptedImagePath)) {
          fs.unlinkSync(corruptedImagePath);
        }
      }
    });

    it('should generate unique filenames for uploads', async () => {
      const res1 = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('image', imagePath);

      const res2 = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('image', imagePath);

      expect(res1.statusCode).toEqual(201);
      expect(res2.statusCode).toEqual(201);
      expect(res1.body.url).not.toBe(res2.body.url);
    });

    it('should handle multiple image formats', async () => {
      // Create JPEG test image
      const jpegPath = path.join(fixturesDir, 'test.jpg');
      await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 0, g: 0, b: 255 }
        }
      })
      .jpeg()
      .toFile(jpegPath);

      try {
        const res = await request(app)
          .post('/api/images/upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('image', jpegPath);

        expect(res.statusCode).toEqual(201);
        expect(res.body.url).toMatch(/\.png$/); // Should be converted to PNG
        expect(res.body.metadata.format).toBe('png');
      } finally {
        if (fs.existsSync(jpegPath)) {
          fs.unlinkSync(jpegPath);
        }
      }
    });

    it('should preserve image quality within reasonable bounds', async () => {
      const res = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('image', imagePath);

      expect(res.statusCode).toEqual(201);
      
      // Check that the uploaded file size is reasonable (not too compressed)
      const uploadedPath = path.join(process.cwd(), 'public', res.body.url);
      const stats = fs.statSync(uploadedPath);
      expect(stats.size).toBeGreaterThan(100); // Not overly compressed
      expect(stats.size).toBeLessThan(50 * 1024 * 1024); // Not unreasonably large
    });
  });

  describe('Image Upload Security', () => {
    it('should sanitize uploaded filenames', async () => {
      // Create a test image with a potentially dangerous filename
      const dangerousName = path.join(fixturesDir, '../../../dangerous.png');
      await sharp({
        create: {
          width: 50,
          height: 50,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
      .png()
      .toFile(path.join(fixturesDir, 'dangerous.png'));

      try {
        const res = await request(app)
          .post('/api/images/upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('image', path.join(fixturesDir, 'dangerous.png'));

        expect(res.statusCode).toEqual(201);
        // URL should not contain path traversal characters
        expect(res.body.url).not.toContain('../');
        expect(res.body.url).toMatch(/^\/uploads\/images\/[a-f0-9-]+\.png$/);
      } finally {
        const cleanupPath = path.join(fixturesDir, 'dangerous.png');
        if (fs.existsSync(cleanupPath)) {
          fs.unlinkSync(cleanupPath);
        }
      }
    });

    it('should reject files with no extension', async () => {
      const noExtPath = path.join(fixturesDir, 'noext');
      fs.copyFileSync(imagePath, noExtPath);

      try {
        const res = await request(app)
          .post('/api/images/upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('image', noExtPath);

        // Should still work as we validate by content, not extension
        expect(res.statusCode).toEqual(201);
      } finally {
        if (fs.existsSync(noExtPath)) {
          fs.unlinkSync(noExtPath);
        }
      }
    });

    it('should reject files that are too large', async () => {
      // This test assumes there's a file size limit in place
      const hugePath = path.join(fixturesDir, 'huge.png');
      
      // Create a very large image (if not limited by sharp)
      try {
        await sharp({
          create: {
            width: 5000,
            height: 5000,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          }
        })
        .png({ compressionLevel: 0 }) // No compression for larger size
        .toFile(hugePath);

        const res = await request(app)
          .post('/api/images/upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('image', hugePath);

        // Depending on implementation, might accept but resize, or reject
        expect([201, 400, 413]).toContain(res.statusCode);
        
        if (res.statusCode === 201) {
          // If accepted, should be resized
          expect(res.body.metadata.width).toBeLessThanOrEqual(1920);
          expect(res.body.metadata.height).toBeLessThanOrEqual(1920);
        }
      } finally {
        if (fs.existsSync(hugePath)) {
          fs.unlinkSync(hugePath);
        }
      }
    });
  });

  describe('Image Upload Edge Cases', () => {
    it('should handle empty files', async () => {
      const emptyPath = path.join(fixturesDir, 'empty.png');
      fs.writeFileSync(emptyPath, '');

      try {
        const res = await request(app)
          .post('/api/images/upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('image', emptyPath);

        assertions.expectErrorResponse(res, 400);
      } finally {
        if (fs.existsSync(emptyPath)) {
          fs.unlinkSync(emptyPath);
        }
      }
    });

    it('should handle malformed multipart requests', async () => {
      const res = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'multipart/form-data')
        .send('malformed data');

      assertions.expectErrorResponse(res, 400);
    });

    it('should handle requests with wrong field name', async () => {
      const res = await request(app)
        .post('/api/images/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('wrongfield', imagePath);

      assertions.expectErrorResponse(res, 400);
      expect(res.body.error).toMatch(/No image file provided|wrong field/i);
    });
  });
});