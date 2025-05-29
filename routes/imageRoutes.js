// routes/imageRoutes.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
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
        fileSize: 10 * 1024 * 1024
    }
});

router.post('/upload', authMiddleware, upload.single('image'), (req, res) => {
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
    res.status(201).json({ url: absoluteImageUrl });
}, (error, req, res, next) => {
    console.error('[IMAGE UPLOAD] Error:', error);
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: `Image file is too large. Max ${upload.limits.fileSize / (1024 * 1024)}MB allowed.` });
        }
        return res.status(400).json({ message: `Multer error: ${error.message}` });
    } else if (error) {
        return res.status(400).json({ message: error.message || 'Image upload failed due to an unknown error.' });
    }
    next();
});

module.exports = router;