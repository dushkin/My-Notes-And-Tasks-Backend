const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadLimiter } = require('../middleware/rateLimiterMiddleware');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'images');

const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp'
];

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = uuidv4();
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return cb(new Error('Invalid file extension. Only .jpg, .jpeg, .png, .gif, and .webp files are allowed.'), false);
    }

    cb(null, true);
};

const scanFile = async (filePath) => {
    try {
        const buffer = fs.readFileSync(filePath);

        const jpegHeader = buffer.slice(0, 3).toString('hex') === 'ffd8ff';
        const pngHeader = buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
        const gifHeader = buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a';
        const webpHeader = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';

        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.jpg' || ext === '.jpeg') {
            if (!jpegHeader) throw new Error('Invalid JPEG file');
        } else if (ext === '.png') {
            if (!pngHeader) throw new Error('Invalid PNG file');
        } else if (ext === '.gif') {
            if (!gifHeader) throw new Error('Invalid GIF file');
        } else if (ext === '.webp') {
            if (!webpHeader) throw new Error('Invalid WebP file');
        }

        const suspicious = [
            'script',
            'javascript',
            'vbscript',
            'onload',
            'onerror',
            '<?php',
            '<%',
            '<script'
        ];

        const fileContent = buffer.toString('ascii').toLowerCase();
        for (const pattern of suspicious) {
            if (fileContent.includes(pattern)) {
                throw new Error('Suspicious content detected');
            }
        }

        return true;
    } catch (error) {
        throw new Error(`File scan failed: ${error.message}`);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1
    }
});

const processImage = async (filePath, originalName) => {
    try {
        await scanFile(filePath);

        const image = sharp(filePath);
        const metadata = await image.metadata();

        if (metadata.width > 10000 || metadata.height > 10000) {
            throw new Error('Image dimensions too large');
        }

        const processedBuffer = await image
            .rotate()
            .withMetadata(false)
            .toBuffer();

        fs.writeFileSync(filePath, processedBuffer);

        return {
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            size: processedBuffer.length
        };
    } catch (error) {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        throw error;
    }
};

/**
 * @openapi
 * /images/upload:
 *   post:
 *     tags:
 *       - Items
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
router.post('/upload',
    authMiddleware,
    uploadLimiter,
    upload.single('image'),
    async (req, res) => {
        console.log('[IMAGE UPLOAD] Request received');
        console.log('[IMAGE UPLOAD] Authenticated user:', req.user?.email);
        console.log('[IMAGE UPLOAD] File info:', req.file ? {
            filename: req.file.filename,
            size: req.file.size,
            mimetype: req.file.mimetype
        } : 'No file received');

        if (!req.file) {
            console.log('[IMAGE UPLOAD] Error: No file uploaded');
            return res.status(400).json({ message: 'No image file uploaded or file type not allowed.' });
        }

        try {
            const imageInfo = await processImage(req.file.path, req.file.originalname);

            const filename = req.file.filename;
            let baseUrl = process.env.RENDER_EXTERNAL_URL;

            if (!baseUrl) {
                baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
                if (process.env.NODE_ENV === 'development' && !process.env.BACKEND_URL) {
                    const port = process.env.PORT || 5001;
                    baseUrl = `http://localhost:${port}`;
                }
            }

            if (baseUrl.endsWith('/')) {
                baseUrl = baseUrl.slice(0, -1);
            }
            const relativeImagePath = `/uploads/images/${filename}`;
            const absoluteImageUrl = `${baseUrl}${relativeImagePath}`;

            console.log(`[IMAGE UPLOAD] Success: Image URL: ${absoluteImageUrl}`);
            res.status(201).json({
                url: absoluteImageUrl,
                metadata: {
                    width: imageInfo.width,
                    height: imageInfo.height,
                    format: imageInfo.format,
                    size: imageInfo.size
                }
            });
        } catch (error) {
            console.error('[IMAGE UPLOAD] Processing error:', error);
            return res.status(400).json({
                message: `Image processing failed: ${error.message}`
            });
        }
    },
    (error, req, res, next) => {
        console.error('[IMAGE UPLOAD] Error:', error);

        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    message: `Image file is too large. Max ${upload.limits.fileSize / (1024 * 1024)}MB allowed.`
                });
            }
            if (error.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({
                    message: 'Only one file allowed per upload.'
                });
            }
            return res.status(400).json({
                message: `Upload error: ${error.message}`
            });
        } else if (error) {
            return res.status(400).json({
                message: error.message || 'Image upload failed due to an unknown error.'
            });
        }
        next();
    }
);

module.exports = router;