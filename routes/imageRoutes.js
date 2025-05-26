const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'images');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = uuidv4();
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('File is not an image.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

const imageUploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 50,
    message: { error: 'Too many images uploaded from this IP, please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
});

const multerErrorHandler = (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err) {
            console.error('[imageRoutes.js] Multer Error:', {
                message: err.message,
                stack: err.stack,
                code: err.code
            });
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ message: `Image file is too large. Max ${upload.limits.fileSize / (1024 * 1024)}MB allowed.` });
                }
                return res.status(400).json({ message: `Multer error: ${err.message}` });
            }
            return res.status(400).json({ message: err.message || 'Image upload failed.' });
        }
        next();
    });
};

router.post('/upload',
    authMiddleware,
    imageUploadLimiter,
    (req, res, next) => {
        // Set keep-alive headers to prevent ECONNRESET
        res.set('Connection', 'keep-alive');
        res.set('Keep-Alive', 'timeout=5, max=100');
        next();
    },
    multerErrorHandler,
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file uploaded or file type not allowed.' });
        }

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

        res.status(201).json({ url: absoluteImageUrl });
    }
);

module.exports = router;