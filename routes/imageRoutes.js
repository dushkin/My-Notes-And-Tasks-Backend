// routes/imageRoutes.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

import authMiddleware from '../middleware/authMiddleware.js';
import { uploadLimiter } from '../middleware/rateLimiterMiddleware.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import logger from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'images');
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        logger.info('Upload directory created during request', { path: UPLOAD_DIR });
      }
      cb(null, UPLOAD_DIR);
    } catch (err) {
      logger.error('Failed to create upload directory during request', {
        path: UPLOAD_DIR,
        error: err.message
      });
      cb(new AppError('Failed to prepare upload location.', 500), null);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = uuidv4();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const userId = req.user?.id || 'anonymous';
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    logger.warn('Upload rejected: Invalid file type', {
      userId,
      mimetype: file.mimetype,
      originalname: file.originalname
    });
    return cb(
      new AppError('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.', 400),
      false
    );
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    logger.warn('Upload rejected: Invalid file extension', {
      userId,
      extension: ext,
      originalname: file.originalname
    });
    return cb(
      new AppError(
        'Invalid file extension. Only .jpg, .jpeg, .png, .gif, and .webp files are allowed.',
        400
      ),
      false
    );
  }

  cb(null, true);
};

const scanFile = async (filePath) => {
  logger.debug('Scanning file (basic check)', { filePath });
  try {
    const buffer = fs.readFileSync(filePath);
    const jpegHeader = buffer.slice(0, 3).toString('hex') === 'ffd8ff';
    const pngHeader = buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
    const gifHeader =
      buffer.slice(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.slice(0, 6).toString('ascii') === 'GIF89a';
    const webpHeader =
      buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
      buffer.slice(8, 12).toString('ascii') === 'WEBP';
    const ext = path.extname(filePath).toLowerCase();
    let isValidType = false;
    if ((ext === '.jpg' || ext === '.jpeg') && jpegHeader) isValidType = true;
    else if (ext === '.png' && pngHeader) isValidType = true;
    else if (ext === '.gif' && gifHeader) isValidType = true;
    else if (ext === '.webp' && webpHeader) isValidType = true;
    if (!isValidType) {
      logger.warn('File scan failed: Invalid magic bytes for extension', { filePath, ext });
      throw new AppError(`Invalid ${ext.substring(1).toUpperCase()} file based on content.`, 400);
    }

    const suspiciousPatterns = ['<script', '<?php', '<%', 'javascript:', 'vbscript:', 'onload=', 'onerror='];
    const fileContentAscii = buffer.toString('ascii', 0, Math.min(buffer.length, 1024)).toLowerCase();

    for (const pattern of suspiciousPatterns) {
      if (fileContentAscii.includes(pattern)) {
        logger.warn('File scan failed: Suspicious pattern detected', { filePath, pattern });
        throw new AppError('Suspicious content detected in file', 400);
      }
    }

    return true;
  } catch (error) {
    logger.error('File scan exception', { filePath, message: error.message });
    if (error instanceof AppError) throw error;
    throw new AppError(`File scan failed: ${error.message}`, 400);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  }
});

const processImageAndLog = async (filePath, originalName, userId) => {
  logger.debug('Starting image processing', { userId, filePath, originalName });
  try {
    await scanFile(filePath);
    const image = sharp(filePath);
    const metadata = await image.metadata();
    if (metadata.width > 10000 || metadata.height > 10000) {
      logger.warn('Image dimensions too large during processing', {
        userId,
        originalName,
        width: metadata.width,
        height: metadata.height
      });
      throw new AppError('Image dimensions too large', 400);
    }

    const processedBuffer = await image.rotate().toBuffer();

    fs.writeFileSync(filePath, processedBuffer);
    logger.info('Image processed successfully', {
      userId,
      originalName,
      newSize: processedBuffer.length,
      format: metadata.format,
      originalWidth: metadata.width,
      originalHeight: metadata.height
    });
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: processedBuffer.length
    };
  } catch (error) {
    logger.error('Image processing failed', {
      userId,
      filePath,
      originalName,
      message: error.message,
      stack: error.stack
    });
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        logger.warn('Failed to delete temp file after processing error', {
          filePath,
          error: e.message
        });
      }
    }
    if (error instanceof AppError) throw error;
    throw new AppError(`Image processing failed: ${error.message}`, 500);
  }
};

/**
 * @openapi
 * /images/upload:
 *   post:
 *     tags:
 *       - Images
 *     summary: Upload an image
 *     description: Uploads an image file, processes it, and returns the image URL and metadata.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: The image file to upload (JPEG, PNG, GIF, or WebP, max 10MB).
 *     responses:
 *       '201':
 *         description: Image uploaded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   description: URL of the uploaded image.
 *                   example: http://localhost:5001/uploads/images/123e4567-e89b-12d3-a456-426614174000.jpg
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     width:
 *                       type: integer
 *                       description: Image width in pixels.
 *                     height:
 *                       type: integer
 *                       description: Image height in pixels.
 *                     format:
 *                       type: string
 *                       description: Image format (jpeg, png, gif, webp).
 *                     size:
 *                       type: integer
 *                       description: File size in bytes.
 *       '400':
 *         description: Invalid file type, extension, or processing error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '413':
 *         description: File too large (max 10MB).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */

router.post(
  '/upload',
  authMiddleware,
  uploadLimiter,
  upload.single('image'),
  catchAsync(async (req, res, next) => {
    const userId = req.user?.id || 'anonymous_upload_user';

    logger.info('[IMAGE UPLOAD] Request received by handler', {
      userId,
      fileInfo: req.file
        ? {
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            filename: req.file.filename
          }
        : 'No file in req'
    });

    if (!req.file) {
      logger.warn('[IMAGE UPLOAD] No file available in request after multer processing', { userId });
      return next(new AppError('No image file uploaded or file processing failed earlier.', 400));
    }

    const imageInfo = await processImageAndLog(req.file.path, req.file.originalname, userId);
    const filename = req.file.filename;

    let baseUrl = process.env.RENDER_EXTERNAL_URL;
    if (!baseUrl) {
      baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
      if (process.env.NODE_ENV === 'development' && !process.env.BACKEND_URL) {
        const port = process.env.PORT || 5001;
        baseUrl = `http://localhost:${port}`;
      }
    }
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    const relativeImagePath = `/uploads/images/${filename}`;
    const absoluteImageUrl = `${baseUrl}${relativeImagePath}`;

    logger.info(`[IMAGE UPLOAD] Success. Image URL: ${absoluteImageUrl}`, {
      userId,
      filename: req.file.filename
    });
    res.status(201).json({
      url: absoluteImageUrl,
      metadata: {
        width: imageInfo.width,
        height: imageInfo.height,
        format: imageInfo.format,
        size: imageInfo.size
      }
    });
  }),
  (error, req, res, next) => {
    const userId = req.user?.id || 'anonymous_upload_user';
    logger.warn('[IMAGE UPLOAD] Error caught by route-specific error handler', {
      userId,
      message: error.message,
      code: error.code,
      name: error.name,
      stack: error.stack
    });
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        logger.info('Temporary uploaded file deleted after error', {
          userId,
          filePath: req.file.path
        });
      } catch (e) {
        logger.warn('Failed to delete temporary file after error', {
          userId,
          filePath: req.file.path,
          error: e.message
        });
      }
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            `Image file is too large. Max ${upload.limits.fileSize / (1024 * 1024)}MB allowed.`,
            413
          )
        );
      }
      return next(new AppError(`Upload error: ${error.message}`, 400));
    }

    next(error);
  }
);

export default router;
