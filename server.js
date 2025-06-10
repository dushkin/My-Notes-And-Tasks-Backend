// server.js
import 'dotenv/config';

import {
    globalErrorHandler,
    notFoundHandler,
    handleUnhandledRejection,
    handleUncaughtException
} from './middleware/errorHandlerMiddleware.js';

handleUncaughtException();

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';

import xssCleanModule from 'xss-clean';
const xss = typeof xssCleanModule === 'function' ? xssCleanModule : xssCleanModule.default;

import hpp from 'hpp';
import compression from 'compression';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

import { generalLimiter } from './middleware/rateLimiterMiddleware.js';

import imageCorsMiddleware from './middleware/imageCorsMiddleware.js';

import logger from './config/logger.js';

// Import scheduled tasks service
import scheduledTasksService from './services/scheduledTasksService.js';

import authRoutes from './routes/authRoutes.js';
import itemsRoutes from './routes/itemsRoutes.js';
import imageRoutes from './routes/imageRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION DETAILS:');
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION DETAILS:');
    console.error('Error:', err);
    process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let isGracefullyClosing = false;
const app = express();

logger.info('Application starting...', { node_env: process.env.NODE_ENV });
logger.debug('Environment Variables Check', {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? 'Set' : 'Not Set',
    FRONTEND_URL: process.env.FRONTEND_URL ? 'Set' : 'Not Set',
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL ? 'Set' : 'Not Set',
    BACKEND_URL: process.env.BACKEND_URL ? 'Set' : 'Not Set',
    MONGODB_URI: process.env.MONGODB_URI ? 'Set' : 'Not Set',
    PORT: process.env.PORT ? process.env.PORT : 'Not Set',
    // Scheduled tasks environment variables
    ENABLE_SCHEDULED_TASKS: process.env.ENABLE_SCHEDULED_TASKS ? 'Set' : 'Not Set (default: true)',
    ORPHANED_IMAGE_CLEANUP_SCHEDULE: process.env.ORPHANED_IMAGE_CLEANUP_SCHEDULE ? 'Set' : 'Not Set (default: 0 2 * * *)',
    EXPIRED_TOKEN_CLEANUP_SCHEDULE: process.env.EXPIRED_TOKEN_CLEANUP_SCHEDULE ? 'Set' : 'Not Set (default: 0 */6 * * *)',
    CRON_TIMEZONE: process.env.CRON_TIMEZONE ? 'Set' : 'Not Set (default: UTC)'
});

const isTestEnv = process.env.NODE_ENV === 'test';
const MONGODB_URI = process.env.MONGODB_URI;

if (!isTestEnv && !MONGODB_URI) {
    logger.error('FATAL ERROR: MONGODB_URI is not defined. Exiting.');
    process.exit(1);
}

if (!isTestEnv) {
    logger.info('Connecting to MongoDB...', { mongoUriPreview: MONGODB_URI.substring(0, 20) + '...' });
    mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
        .then(() => {
            logger.info('Successfully connected to MongoDB.');
            // Initialize scheduled tasks after successful DB connection
            initializeScheduledTasks();
        })
        .catch((err) => {
            logger.error('Initial MongoDB connection error. Exiting.', { message: err.message, stack: err.stack });
            process.exit(1);
        });

    mongoose.connection.on('error', (err) =>
        logger.error('MongoDB connection error after initial connection:', { message: err.message })
    );
    mongoose.connection.on('disconnected', () => {
        if (!isGracefullyClosing) logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected.'));
} else {
    logger.info('Test environment detected. Skipping direct Mongoose connection in server.js.');
}

/**
 * Initialize scheduled tasks
 */
function initializeScheduledTasks() {
    // Check if scheduled tasks are enabled (default: true)
    const enableScheduledTasks = process.env.ENABLE_SCHEDULED_TASKS !== 'false';

    if (!enableScheduledTasks) {
        logger.info('Scheduled tasks disabled via ENABLE_SCHEDULED_TASKS environment variable');
        return;
    }

    if (isTestEnv) {
        logger.info('Test environment detected. Skipping scheduled tasks initialization.');
        return;
    }

    try {
        scheduledTasksService.init();
        logger.info('Scheduled tasks service initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize scheduled tasks service', {
            error: error.message,
            stack: error.stack
        });
        // Don't exit the process, but continue without scheduled tasks
        logger.warn('Continuing without scheduled tasks due to initialization error');
    }
}

// --- Apply tightened HTTP headers early ---------------------------------------
app.use(helmet({
    contentSecurityPolicy: false,  // Disable CSP for now
    crossOriginEmbedderPolicy: false
}));

const allowedOriginsStr = process.env.ALLOWED_ORIGINS || '';
const allowedOriginsList = allowedOriginsStr ? allowedOriginsStr.split(',').map(origin => origin.trim()) : '*';
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or direct URL access)
        if (!origin) return callback(null, true);

        if (allowedOriginsList === '*' || allowedOriginsList.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            logger.warn('CORS: Origin not allowed', { origin, allowedOriginsList });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
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

if (typeof xss === 'function') {
    app.use(xss());
} else {
    logger.error('xss-clean module was not imported as a function. XSS middleware not applied.');
}

app.use(hpp({ whitelist: ['sort', 'fields', 'page', 'limit'] }));
app.use(compression());
app.use('/api/', generalLimiter);

const publicUploadsPath = path.join(__dirname, 'public', 'uploads');

app.use('/uploads', imageCorsMiddleware);

// Serve static files
app.use('/uploads', express.static(publicUploadsPath, {
    maxAge: '1y', // Cache for 1 year
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
        // Additional headers for image files
        if (path.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        }
    }
}));

logger.info('Static file serving configured for /uploads', {
    path: publicUploadsPath,
    corsEnabled: true
});

try {
    logger.debug('Registering routes...');
    app.get('/api/health', (req, res) => {
        if (process.env.NODE_ENV === 'test') {
            logger.info('/api/health accessed in test mode, reporting UP.');
            res.status(200).json({ status: 'UP', message: 'API is running (test mode - DB check bypassed for this endpoint).' });
        } else if (mongoose.connection.readyState === 1) {
            logger.info('/api/health accessed, DB connected, reporting UP.');
            res.status(200).json({
                status: 'UP',
                message: 'API is healthy, DB connected.',
                scheduledTasks: {
                    enabled: process.env.ENABLE_SCHEDULED_TASKS !== 'false',
                    status: process.env.ENABLE_SCHEDULED_TASKS !== 'false' ? 'running' : 'disabled'
                }
            });
        } else {
            logger.warn('/api/health: API is up but DB is not connected or in unexpected state.', { dbState: mongoose.connection.readyState });
            res.status(503).json({ status: 'DEGRADED', message: 'Database not ready.' });
        }
    });

    app.use('/api/auth', authRoutes);
    logger.debug('authRoutes registered.');
    app.use('/api/items', itemsRoutes);
    logger.debug('itemsRoutes registered.');
    app.use('/api/images', imageRoutes);
    logger.debug('imageRoutes registered.');

    // Register admin routes (optional - only if you want admin functionality)
    if (process.env.ENABLE_ADMIN_ROUTES !== 'false') {
        app.use('/api/admin', adminRoutes);
        logger.debug('adminRoutes registered.');
    } else {
        logger.info('Admin routes disabled via ENABLE_ADMIN_ROUTES environment variable');
    }
} catch (err) {
    logger.error('Error registering routes:', { message: err.message, stack: err.stack });
    throw err;
}

app.get('/', (req, res) => res.send('API is operational.'));
app.all('*', notFoundHandler);
app.use(globalErrorHandler);

let serverInstance;
const mainScriptPath = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === mainScriptPath || (typeof require !== 'undefined' && require.main === module && require.main.filename === mainScriptPath);

if (isMainModule) {
    const PORT = process.env.PORT || 5001;
    const startServer = () => {
        serverInstance = app.listen(PORT, () => {
            logger.info(`Server running on port ${PORT} and ready to accept connections.`, { environment: process.env.NODE_ENV });
        });
        handleUnhandledRejection(serverInstance);
    };

    if (!isTestEnv && mongoose.connection.readyState !== 1) {
        // If not in test env, and DB not yet connected, wait for connected event
        logger.info("Server not started yet, waiting for MongoDB connection...");
        mongoose.connection.once('open', () => {
            logger.info("MongoDB connected (event 'open'), starting server.");
            startServer();
        });
        // Also handle error during this wait, though initial connect has its own exit
        mongoose.connection.once('error', (err) => {
            logger.error("MongoDB connection error before server start, process will likely exit from connect .catch", { message: err.message });
            // process.exit(1) // Already handled in initial connect .catch
        });
    } else {
        // If test env (DB handled by Jest setup) or DB already connected
        logger.info(isTestEnv ? "Test environment: Starting server immediately." : "MongoDB already connected or connection attempt in progress. Starting server.");
        startServer();
    }
}

const shutdown = async (signal) => {
    isGracefullyClosing = true;
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    // Shutdown scheduled tasks service first
    try {
        await scheduledTasksService.shutdown();
    } catch (error) {
        logger.error('Error shutting down scheduled tasks service:', {
            message: error.message,
            stack: error.stack
        });
    }

    if (serverInstance) {
        serverInstance.close(async () => {
            logger.info('HTTP server closed.');
            try {
                if (mongoose.connection.readyState === 1) {
                    await mongoose.connection.close();
                    logger.info('MongoDB connection closed.');
                } else {
                    logger.info('MongoDB connection already closed or not established at shutdown.');
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
            try {
                await mongoose.connection.close();
                logger.info('MongoDB connection closed during direct exit.');
            } catch (e) {
                logger.error('Error closing MongoDB on direct exit.', { message: e.message });
            }
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