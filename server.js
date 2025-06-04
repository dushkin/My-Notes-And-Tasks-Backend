// server.js
import 'dotenv/config';

import {
    globalErrorHandler,
    notFoundHandler,
    handleUnhandledRejection,
    handleUncaughtException
} from './middleware/errorHandlerMiddleware.js';

handleUncaughtException(); // Set up global error handler for uncaught exceptions

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';

// Import xss-clean and try to get the function correctly
import xssCleanModule from 'xss-clean';
const xss = typeof xssCleanModule === 'function' ? xssCleanModule : xssCleanModule.default;

import hpp from 'hpp';
import compression from 'compression';
import path from 'path'; // Added for robust path joining for static files
import fs from 'fs'; // Added for directory creation
import { fileURLToPath } from 'url'; // For __dirname in ESM

import { generalLimiter } from './middleware/rateLimiterMiddleware.js';
import logger from './config/logger.js';

import authRoutes from './routes/authRoutes.js';
import itemsRoutes from './routes/itemsRoutes.js';
import imageRoutes from './routes/imageRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isGracefullyClosing = false;
const app = express();

logger.info('Application starting...', { node_env: process.env.NODE_ENV });
logger.debug('Environment Variables Check', {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? 'Set' : 'Not Set',
    FRONTEND_URL: process.env.FRONTEND_URL ? 'Set' : 'Not Set',
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL ? 'Set' : 'Not Set',
    BACKEND_URL: process.env.BACKEND_URL ? 'Set' : 'Not Set',
    MONGODB_URI: process.env.MONGODB_URI ? 'Set' : 'Not Set',
    PORT: process.env.PORT
});

const isTestEnv = process.env.NODE_ENV === 'test';
const MONGODB_URI = process.env.MONGODB_URI;

if (!isTestEnv && !MONGODB_URI) {
    logger.error('FATAL ERROR: MONGODB_URI is not defined. Exiting.'); // Changed to error
    process.exit(1);
}

// Ensure upload directories exist
const uploadDir = path.join(__dirname, 'public', 'uploads', 'images');
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
        logger.info('Upload directory created at startup', { path: uploadDir });
    } catch (err) {
        logger.error('Failed to create upload directory at startup', {
            path: uploadDir,
            error: err.message
        });
    }
}

if (!isTestEnv) {
    logger.info('Connecting to MongoDB...', { mongoUriPreview: MONGODB_URI ? MONGODB_URI.substring(0, 20) + '...' : 'N/A' });
    mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
        .then(() => logger.info('Successfully connected to MongoDB.'))
        .catch((err) => {
            logger.error('Initial MongoDB connection error. Exiting.', { message: err.message, stack: err.stack }); // Changed to error
            process.exit(1);
        });

    mongoose.connection.on('error', (err) => logger.error('MongoDB connection error after initial connection:', { message: err.message }));
    mongoose.connection.on('disconnected', () => {
        if (!isGracefullyClosing) logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected.'));
} else {
    logger.info('Test environment detected. Skipping direct Mongoose connection in server.js.');
}

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            // upgradeInsecureRequests is handled below
        }
    },
    crossOriginEmbedderPolicy: false
}));
if (process.env.NODE_ENV === 'production' && app.get('helmet').contentSecurityPolicy) {
    app.get('helmet').contentSecurityPolicy.directives.upgradeInsecureRequests = [];
}


const allowedOriginsStr = process.env.ALLOWED_ORIGINS || '';
const allowedOriginsList = allowedOriginsStr ? allowedOriginsStr.split(',').map(origin => origin.trim()) : '*';

const corsOptions = {
    origin: (origin, callback) => {
        if (allowedOriginsList === '*' || !origin || allowedOriginsList.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            logger.warn('CORS: Origin not allowed', { origin, allowedOriginsList });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
logger.info('CORS middleware initialized', { configuredOrigins: allowedOriginsList === '*' ? 'All (*)' : allowedOriginsList });

app.use((req, res, next) => {
    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || 'unknown';
    const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    req.requestId = requestId;

    logger.http('Incoming request', {
        requestId,
        method,
        url: originalUrl,
        ip,
        userAgent,
    });

    res.on('finish', () => {
        const duration = Date.now() - start;
        const { statusCode } = res;
        const contentLength = res.get('Content-Length');
        const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
        logger.log(level, 'Request finished', {
            requestId,
            method,
            url: originalUrl,
            statusCode,
            durationMs: duration,
            contentLength: contentLength || 'N/A',
            userId: req.user?.id
        });
    });
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(mongoSanitize());

// Use xss-clean in the standard way. Ensure 'xss' is the actual middleware function.
if (typeof xss === 'function') {
    app.use(xss()); // This invokes xss-clean to return its middleware
} else {
    logger.error('xss-clean module was not imported as a function. XSS middleware not applied.');
}

app.use(hpp({ whitelist: ['sort', 'fields', 'page', 'limit'] }));
app.use(compression());
app.use('/api/', generalLimiter);

const publicUploadsPath = path.join(__dirname, 'public', 'uploads');
app.use('/uploads', express.static(publicUploadsPath));
logger.info('Static file serving configured for /uploads', { path: publicUploadsPath });

try {
    logger.debug('Registering routes...');
    app.get('/api/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            mongoState: mongoose.connection.readyState
        });
    });
    app.use('/api/auth', authRoutes);
    logger.debug('authRoutes registered.');
    app.use('/api/items', itemsRoutes);
    logger.debug('itemsRoutes registered.');
    app.use('/api/images', imageRoutes);
    logger.debug('imageRoutes registered.');
} catch (err) {
    logger.error('Error registering routes:', { message: err.message, stack: err.stack }); // Changed to error
    throw err;
}

app.get('/', (req, res) => res.send('API is operational.'));
app.all('*', notFoundHandler);
app.use(globalErrorHandler);

let serverInstance;
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || (typeof require !== 'undefined' && require.main === module)) {
    const PORT = process.env.PORT || 5001;
    serverInstance = app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`, { environment: process.env.NODE_ENV });
    });
    handleUnhandledRejection(serverInstance);
}

const shutdown = async (signal) => {
    isGracefullyClosing = true;
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    if (serverInstance) {
        serverInstance.close(async () => {
            logger.info('HTTP server closed.');
            try {
                if (mongoose.connection.readyState === 1) { // Only close if connected
                    await mongoose.connection.close();
                    logger.info('MongoDB connection closed.');
                } else {
                    logger.info('MongoDB connection already closed or not established.');
                }
            } catch (err) {
                logger.error('Error closing MongoDB connection during shutdown:', { message: err.message });
            } finally {
                logger.info('Shutdown complete.');
                process.exit(0);
            }
        });
    } else {
        logger.info('No active HTTP server to close. Exiting.');
        if (mongoose.connection.readyState === 1) {
            try { await mongoose.connection.close(); logger.info('MongoDB connection closed during direct exit.'); }
            catch (e) { logger.error('Error closing MongoDB on direct exit.', { message: e.message });}
        }
        process.exit(0);
    }
    setTimeout(() => {
        logger.warn('Graceful shutdown timeout. Forcing exit.');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;