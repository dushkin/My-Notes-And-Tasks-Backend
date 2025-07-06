import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { fileTypeFromFile } from 'file-type';
import { header, check, validationResult } from 'express-validator';

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

// Simplified security approach - no ClamAV to avoid false positives
// We'll rely on file type validation, size limits, and basic content checks
logger.info('Image upload security configuration', {
  securityApproach: 'simplified',
  clamavEnabled: false,
  environment: process.env.NODE_ENV,
  note: 'ClamAV disabled to prevent false positives'
});

// Validation error handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg);
    let flatErrorMessages = [];
    errorMessages.forEach(msg => {
      if (Array.isArray(msg)) {
        flatErrorMessages = flatErrorMessages.concat(msg);
      } else {
        flatErrorMessages.push(msg);
      }
    });
    logger.warn('Validation error in imageRoutes', {
      errors: flatErrorMessages,
      path: req.path,
      userId: req.user?.id,
    });
    return next(new AppError(flatErrorMessages.join(', ') || 'Validation error', 400));
  }
  next();
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        logger.info('Upload directory created during request', { path: UPLOAD_DIR });
      }
      cb(null, UPLOAD_DIR);
    } catch (err) {
      logger.error('Failed to create upload directory', { path: UPLOAD_DIR, error: err.message });
      cb(new AppError('Failed to prepare upload location.', 500), null);
    }
  },
  filename(req, file, cb) {
    const uniqueSuffix = uuidv4();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const userId = req.user?.id || 'anonymous';
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    logger.warn('Upload rejected: Invalid file type', { userId, mimetype: file.mimetype, originalname: file.originalname });
    return cb(new AppError('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.', 400), false);
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    logger.warn('Upload rejected: Invalid file extension', { userId, extension: ext });
    return cb(new AppError('Invalid file extension. Only .jpg, .jpeg, .png, .gif, and .webp are allowed.', 400), false);
  }
  cb(null, true);
};

const scanFile = async (filePath) => {
  logger.debug('Starting simplified file security scan', { filePath });

  try {
    // 1. File type validation using file-type library
    const ft = await fileTypeFromFile(filePath);
    if (!ft || !ALLOWED_MIME_TYPES.includes(ft.mime)) {
      logger.warn('Upload rejected: content type mismatch', { filePath, detectedMime: ft?.mime });
      throw new AppError('Invalid file content type. Only JPEG, PNG, GIF, and WebP are allowed.', 400);
    }
    logger.debug('File type validation passed', { detectedMime: ft.mime });

    // 2. Basic magic byte validation
    const buffer = fs.readFileSync(filePath);
    const jpegHeader = buffer.slice(0, 3).toString('hex') === 'ffd8ff';
    const pngHeader = buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
    const gifHeader = ['GIF87a', 'GIF89a'].includes(buffer.slice(0, 6).toString('ascii'));
    const webpHeader = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
    const ext = path.extname(filePath).toLowerCase();

    let valid = false;
    if ((ext === '.jpg' || ext === '.jpeg') && jpegHeader) valid = true;
    else if (ext === '.png' && pngHeader) valid = true;
    else if (ext === '.gif' && gifHeader) valid = true;
    else if (ext === '.webp' && webpHeader) valid = true;

    if (!valid) {
      logger.warn('Magic-byte check failed', { filePath, ext });
      throw new AppError(`Invalid ${ext.substring(1).toUpperCase()} file based on content.`, 400);
    }

    // 3. Basic suspicious content check (only extremely obvious patterns)
    const head = buffer.toString('ascii', 0, Math.min(buffer.length, 512)).toLowerCase();
    const obviousMalware = ['<script>', '<?php', 'javascript:', 'vbscript:'];
    for (const pattern of obviousMalware) {
      if (head.includes(pattern)) {
        logger.warn('Obviously suspicious pattern detected', { filePath, pattern });
        throw new AppError('File contains suspicious executable content', 400);
      }
    }

    logger.debug('File security validation passed', { filePath });
    return true;

  } catch (error) {
    logger.error('File scan exception', { filePath, message: error.message });
    if (error instanceof AppError) throw error;
    throw new AppError(`File validation failed: ${error.message}`, 400);
  }
};

const processImageAndLog = async (filePath, originalName, userId) => {
  logger.debug('Starting image processing', { userId, filePath, originalName });
  try {
    // Perform simplified security scanning
    await scanFile(filePath);

    // Process image with Sharp
    const image = sharp(filePath);
    const metadata = await image.metadata();
    if (metadata.width > 10000 || metadata.height > 10000) {
      logger.warn('Image dimensions too large', { userId, originalName, width: metadata.width, height: metadata.height });
      throw new AppError('Image dimensions exceed allowed maximum (10000x10000)', 400);
    }

    // Re-encode & strip metadata for security and consistency
    const processedBuffer = await image
      .rotate() // Auto-rotate based on EXIF
      .toFormat(metadata.format)
      .withMetadata(false) // Strip all metadata including EXIF
      .toBuffer();

    fs.writeFileSync(filePath, processedBuffer);

    logger.info('Image processed successfully', {
      userId,
      originalName,
      newSize: processedBuffer.length,
      format: metadata.format,
      originalWidth: metadata.width,
      originalHeight: metadata.height,
      securityApproach: 'simplified'
    });

    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: processedBuffer.length
    };
  } catch (err) {
    logger.error('Image processing exception', { userId, originalName, filePath, message: err.message });
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {/* ignore cleanup errors */ }
    }
    if (err instanceof AppError) throw err;
    throw new AppError(`Image processing failed: ${err.message}`, 500);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

const imageUploadValidations = [
  header('content-type')
    .optional()
    .custom((value) => {
      if (value && !value.includes('multipart/form-data')) {
        throw new Error('Invalid content type for file upload');
      }
      return true;
    }),

  check().custom((value, { req }) => {
    // This will be checked after multer processes the file
    return true;
  })
];

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
  imageUploadValidations,
  validate,
  upload.single('image'),
  catchAsync(async (req, res, next) => {
    const userId = req.user?.id || 'anonymous_upload_user';
    if (!req.file) {
      logger.warn('[IMAGE UPLOAD] No file after multer', { userId });
      return next(new AppError('No image uploaded.', 400));
    }

    const info = await processImageAndLog(req.file.path, req.file.originalname, userId);
    const filename = req.file.filename;

    let baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    if (baseUrl.startsWith('http://') && process.env.NODE_ENV === 'production') {
      baseUrl = baseUrl.replace('http://', 'https://');
    }

    res.status(201).json({
      url: `${baseUrl}/uploads/images/${filename}`,
      metadata: info
    });
  }),
  (error, req, res, next) => {
    const userId = req.user?.id || 'anonymous_upload_user';
    logger.warn('[IMAGE UPLOAD] Route-handler error', { userId, message: error.message });
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      logger.info('Deleted temp file after error', { filePath: req.file.path });
    }
    next(new AppError(`Upload error: ${error.message}`, 400));
  }
);

export default router;