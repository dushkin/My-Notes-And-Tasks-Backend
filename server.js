// server.js
require('dotenv').config();

// Import error handlers at the top
const {
    globalErrorHandler,
    notFoundHandler,
    handleUnhandledRejection,
    handleUncaughtException
} = require('./middleware/errorHandlerMiddleware');

// Handle uncaught exceptions (must be at the very top)
handleUncaughtException();

// Add these debug lines
console.log('=== ENVIRONMENT VARIABLES DEBUG ===');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'LOADED' : 'NOT LOADED');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('=====================================');

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const compression = require('compression');
const { generalLimiter } = require('./middleware/rateLimiterMiddleware');

const app = express();

console.log('Environment Variables:', {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    FRONTEND_URL: process.env.FRONTEND_URL,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
    BACKEND_URL: process.env.BACKEND_URL,
    MONGODB_URI: process.env.MONGODB_URI ? 'Set' : 'Not set'
});

const isTestEnv = process.env.NODE_ENV === 'test';
const MONGODB_URI = process.env.MONGODB_URI;

// Database connection with better error handling
if (!isTestEnv) {
    console.log('=== MONGOOSE CONNECTION DEBUG ===');
    console.log('Connecting to MongoDB...');
    console.log('===================================');

    mongoose
        .connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 30000,
        })
        .then(() => {
            console.log('Connected to MongoDB');
        })
        .catch((err) => {
            console.error('Initial MongoDB connection error:', err.message);
            process.exit(1);
        });

    // Handle MongoDB connection errors after initial connection
    mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
        console.log('MongoDB reconnected');
    });
} else {
    console.log('Test environment detected. Skipping Mongoose connection in server.js.');
}

// Security middleware (should be early in the middleware stack)
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
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        }
    },
    crossOriginEmbedderPolicy: false
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*';

const corsOptions = {
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
console.log('CORS middleware initialized with origins:', corsOptions.origin);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// MODIFIED: Custom XSS protection that excludes content field for notes/tasks
app.use((req, res, next) => {
    // Only apply XSS protection to non-content fields
    if (req.body && req.body.content && (req.path.includes('/items') || req.path.includes('/notes'))) {
        // Store the original content
        const originalContent = req.body.content;
        
        // Apply XSS to other fields
        const contentBackup = req.body.content;
        delete req.body.content;
        
        // Apply XSS to the rest of the body
        xss()(req, res, () => {
            // Restore the original content without XSS processing
            req.body.content = originalContent;
            next();
        });
    } else {
        // Apply normal XSS protection for non-content requests
        xss()(req, res, next);
    }
});

// Prevent parameter pollution
app.use(hpp({
    whitelist: ['sort', 'fields', 'page', 'limit'] // Add any query params you want to allow duplicates
}));

// Compression middleware
app.use(compression());

// Rate limiting
app.use('/api/', generalLimiter);

// Static files (if you're serving uploaded images)
app.use('/uploads', express.static('public/uploads'));

// API routes with error handling
try {
    console.log('Loading routes...');

    // Health check endpoint
    app.get('/api/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            mongoStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
        });
    });

    // Auth routes
    const authRoutes = require('./routes/authRoutes');
    app.use('/api/auth', authRoutes);
    console.log('authRoutes registered successfully');

    // Items routes
    const itemsRoutes = require('./routes/itemsRoutes');
    app.use('/api/items', itemsRoutes);
    console.log('itemsRoutes registered successfully');

    // Image routes
    const imageRoutes = require('./routes/imageRoutes');
    app.use('/api/images', imageRoutes);
    console.log('imageRoutes registered successfully');

} catch (err) {
    console.error('Error registering routes:', err.stack);
    throw err;
}

// Root endpoint
app.get('/', (req, res) => res.send('API Running'));

// Handle undefined routes (404) - must come after all route definitions
app.all('*', notFoundHandler);

// Global error handling middleware - must be the last middleware
app.use(globalErrorHandler);

// Start server
let server;
if (require.main === module) {
    const PORT = process.env.PORT || 5001;
    server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV}`);
    });

    // Handle unhandled promise rejections
    handleUnhandledRejection(server);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
    if (server) {
        server.close(async () => {
            console.log('💥 HTTP server closed.');
            try {
                await mongoose.connection.close();
                console.log('MongoDB connection closed.');
            } catch (err) {
                console.error('Error closing MongoDB connection:', err);
            } finally {
                process.exit(0);
            }
        });
    } else {
        process.exit(0);
    }
});

module.exports = app;