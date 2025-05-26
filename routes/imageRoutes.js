const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises; // Using promises version of fs
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/authMiddleware');
const FileType = require('file-type'); // Correct way to import for v16.x

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'images');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!require('fs').existsSync(UPLOAD_DIR)) {
            require('fs').mkdirSync(UPLOAD_DIR, { recursive: true });
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
        cb(new Error('File is not an image based on mimetype.'), false);
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
    upload.single('image')(req, res, async (err) => {
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

const ALLOWED_IMAGE_MIMETYPES_MAGIC = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff'
];

router.post('/upload',
    authMiddleware,
    imageUploadLimiter,
    (req, res, next) => {
        res.set('Connection', 'keep-alive');
        res.set('Keep-Alive', 'timeout=5, max=100');
        next();
    },
    multerErrorHandler,
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file uploaded or file type not allowed by initial filter.' });
        }

        let fileHandle;
        try {
            // Read a chunk of the file for magic number detection
            const bytesToRead = 4100; // Common number of bytes for magic number detection
            const buffer = Buffer.alloc(bytesToRead);
            fileHandle = await fs.open(req.file.path, 'r');
            const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, 0);
            // No need to close fileHandle in a finally here if an error in read() or open() would throw out

            const bufferForDetection = bytesRead < bytesToRead ? buffer.subarray(0, bytesRead) : buffer;
            const detectedType = await FileType.fromBuffer(bufferForDetection);

            if (fileHandle) {
                await fileHandle.close(); // Close the file handle once done with it
            }

            if (!detectedType || !ALLOWED_IMAGE_MIMETYPES_MAGIC.includes(detectedType.mime)) {
                await fs.unlink(req.file.path);
                return res.status(400).json({ message: 'Invalid file type. Only specific image types are allowed after deep check.' });
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

        } catch (error) {
            console.error('[imageRoutes.js] Error during magic number validation or URL generation:', error);
            if (fileHandle) { // Ensure file handle is closed if it was opened
                try {
                    await fileHandle.close();
                } catch (fhCloseError) {
                    console.error('[imageRoutes.js] Error closing file handle:', fhCloseError);
                }
            }
            if (req.file && req.file.path) {
                try {
                    await fs.unlink(req.file.path);
                } catch (cleanupError) {
                    console.error('[imageRoutes.js] Error cleaning up file after validation error:', cleanupError);
                }
            }
            res.status(500).json({ message: 'Server error during file processing.' });
        }
    }
);

module.exports = router;