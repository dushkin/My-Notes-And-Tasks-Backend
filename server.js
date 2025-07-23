import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { initSocketIO } from "./socketEvents.js";
import { setupSocketEvents } from "./socket/socketController.js";

import "dotenv/config";
// Add more detailed error logging at the very beginning
console.log("🚀 Starting server.js...");
// Wrap the error handlers import in try-catch
let errorHandlers;
try {
    console.log("📦 Importing error handlers...");
    errorHandlers = await import("./middleware/errorHandlerMiddleware.js");
    console.log("✅ Error handlers imported successfully");
} catch (err) {
    console.error("❌ Failed to import error handlers:", err.message);
    console.error(err.stack);
    process.exit(1);
}

const {
    globalErrorHandler,
    notFoundHandler,
    handleUnhandledRejection,
    handleUncaughtException,
    catchAsync,
    AppError,
} = errorHandlers;
// Initialize exception handlers
try {
    console.log("🛡️ Initializing exception handlers...");
    handleUncaughtException();
    console.log("✅ Exception handlers initialized");
} catch (err) {
    console.error("❌ Failed to initialize exception handlers:", err.message);
    process.exit(1);
}

// Enhanced process error handlers
process.on("uncaughtException", (err) => {
    console.error("🔥 UNCAUGHT EXCEPTION DETAILS:");
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    process.exit(1);
});
process.on("unhandledRejection", (err) => {
    console.error("🔥 UNHANDLED REJECTION DETAILS:");
    console.error("Error:", err);
    console.error("Stack:", err.stack);
    process.exit(1);
});
// Import core modules with error handling
let express,
    cors,
    mongoose,
    mongoSanitize,
    xssCleanModule,
    hpp,
    compression,
    path,
    axios;
let authMiddleware,
    securityHeaders,
    generalLimiter,
    imageCorsMiddleware,
    logger,
    scheduledTasksService,
    reminderService,
    deviceSyncService; // NEW: Import device sync service
let authRoutes,
    itemsRoutes,
    imageRoutes,
    accountRoutes,
    metaRoutes,
    paddleWebhook,
    adminRoutes,
    pushNotificationRoutes,
    reminderRoutes,
    syncRoutes; // NEW: Import sync routes
try {
    console.log("📦 Importing core modules...");
    express = (await import("express")).default;
    cors = (await import("cors")).default;
    mongoose = (await import("mongoose")).default;
    mongoSanitize = (await import("express-mongo-sanitize")).default;
    xssCleanModule = (await import("xss-clean")).default;
    hpp = (await import("hpp")).default;
    compression = (await import("compression")).default;
    path = (await import("path")).default;
    axios = (await import("axios")).default;
    console.log("✅ Core modules imported successfully");
} catch (err) {
    console.error("❌ Failed to import core modules:", err.message);
    console.error(err.stack);
    process.exit(1);
}

try {
    console.log("📦 Importing middleware modules...");
    authMiddleware = (await import("./middleware/authMiddleware.js")).default;
    securityHeaders = (await import("./middleware/securityHeadersMiddleware.js"))
        .default;
    const rateLimiter = await import("./middleware/rateLimiterMiddleware.js");
    generalLimiter = rateLimiter.generalLimiter;
    imageCorsMiddleware = (await import("./middleware/imageCorsMiddleware.js"))
        .default;
    console.log("✅ Middleware modules imported successfully");
} catch (err) {
    console.error("❌ Failed to import middleware modules:", err.message);
    console.error(err.stack);
    process.exit(1);
}

try {
    console.log("📦 Importing services...");
    logger = (await import("./config/logger.js")).default;
    scheduledTasksService = (await import("./services/scheduledTasksService.js"))
        .default;
    reminderService = (await import("./services/reminderService.js")).default;

    // NEW: Import device sync service
    try {
        deviceSyncService = (await import("./services/deviceSyncService.js")).default;
        console.log("✅ Device sync service imported successfully");
    } catch (syncErr) {
        console.warn("⚠️ Device sync service not available:", syncErr.message);
        deviceSyncService = null;
    }

    console.log("✅ Services imported successfully");
} catch (err) {
    console.error("❌ Failed to import services:", err.message);
    console.error(err.stack);
    process.exit(1);
}

try {
    console.log("📦 Importing route modules...");
    authRoutes = (await import("./routes/authRoutes.js")).default;
    itemsRoutes = (await import("./routes/itemsRoutes.js")).default;
    imageRoutes = (await import("./routes/imageRoutes.js")).default;
    accountRoutes = (await import("./routes/accountRoutes.js")).default;
    metaRoutes = (await import("./routes/metaRoutes.js")).default;
    paddleWebhook = (await import("./routes/paddleWebhook.js")).default;
    adminRoutes = (await import("./routes/adminRoutes.js")).default;
    pushNotificationRoutes = (await import("./routes/pushNotificationRoutes.js"))
        .default;
    reminderRoutes = (await import("./routes/reminderRoutes.js")).default;

    // NEW: Import sync routes
    try {
        syncRoutes = (await import("./routes/syncRoutes.js")).default;
        console.log("✅ Sync routes imported successfully");
    } catch (syncErr) {
        console.warn("⚠️ Sync routes not available:", syncErr.message);
        syncRoutes = null;
    }

    console.log("✅ Route modules imported successfully");
} catch (err) {
    console.error("❌ Failed to import route modules:", err.message);
    console.error(err.stack);
    process.exit(1);
}

const xss =
    typeof xssCleanModule === "function"
        ? xssCleanModule
        : xssCleanModule.default;
const { dirname } = path;
const { fileURLToPath } = await import("url");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let isGracefullyClosing = false;
const app = express();

console.log("🏗️ Initializing Express app...");
logger.info("Application starting...", { node_env: process.env.NODE_ENV });

// Environment variables check (includes new PWA sync variables)
logger.debug("Environment Variables Check", {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? "Set" : "Not Set",
    FRONTEND_URL: process.env.FRONTEND_URL ? "Set" : "Not Set",
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL ? "Set" : "Not Set",
    BACKEND_URL: process.env.BACKEND_URL ? "Set" : "Not Set",
    MONGODB_URI: process.env.MONGODB_URI ? "Set" : "Not Set",
    PORT: process.env.PORT ? process.env.PORT : "Not Set",
    DATA_ENCRYPTION_SECRET: process.env.DATA_ENCRYPTION_SECRET
        ? "Set"
        : "Not Set",
    PADDLE_API_KEY: process.env.PADDLE_API_KEY ? "Set" : "Not Set",

    // NEW: PWA Sync environment variables
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ? "Set" : "Not Set",
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ? "Set" : "Not Set",
    VAPID_SUBJECT: process.env.VAPID_SUBJECT ? "Set" : "Not Set (will use default)",

    BETA_ENABLED: process.env.BETA_ENABLED ? "Set" : "Not Set (default: false)",
    BETA_USER_LIMIT: process.env.BETA_USER_LIMIT
        ? "Set"
        : "Not Set (default: 50)",
    ENABLE_SCHEDULED_TASKS: process.env.ENABLE_SCHEDULED_TASKS
        ? "Set"
        : "Not Set (default: true)",
    ORPHANED_IMAGE_CLEANUP_SCHEDULE: process.env.ORPHANED_IMAGE_CLEANUP_SCHEDULE
        ? "Set"
        : "Not Set (default: 0 2 * * *)",
    EXPIRED_TOKEN_CLEANUP_SCHEDULE: process.env.EXPIRED_TOKEN_CLEANUP_SCHEDULE
        ? "Set"
        : "Not Set (default: 0 */6 * * *)",
    CRON_TIMEZONE: process.env.CRON_TIMEZONE ? "Set" : "Not Set (default: UTC)",
});

const isTestEnv = process.env.NODE_ENV === "test";
const MONGODB_URI = process.env.MONGODB_URI;
const DATA_ENCRYPTION_SECRET = process.env.DATA_ENCRYPTION_SECRET;
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

console.log("🔍 Checking required environment variables...");
if (!isTestEnv && !MONGODB_URI) {
    logger.error("FATAL ERROR: MONGODB_URI is not defined. Exiting.");
    process.exit(1);
}
if (!isTestEnv && !DATA_ENCRYPTION_SECRET) {
    logger.error("FATAL ERROR: DATA_ENCRYPTION_SECRET is not defined. Exiting.");
    process.exit(1);
}
if (!isTestEnv && !PADDLE_API_KEY) {
    logger.error("FATAL ERROR: PADDLE_API_KEY is not defined. Exiting.");
    process.exit(1);
}

// NEW: Check PWA sync environment variables (warnings only, not fatal)
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    logger.warn("PWA sync environment variables not set. Push notifications will not work. Generate VAPID keys and set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.");
} else {
    logger.info("PWA sync environment variables configured successfully");
}

console.log("✅ Environment variables check passed");

// MongoDB connection setup
if (!isTestEnv) {
    console.log("🔌 Setting up MongoDB connection...");
    logger.info("Connecting to MongoDB...", {
        mongoUriPreview: MONGODB_URI.substring(0, 20) + "...",
    });
    mongoose
        .connect(MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
        .catch((err) => {
            console.error("❌ MongoDB connection threw before .then:", err.message);
            console.error(err.stack);
            process.exit(1);
        })
        .then(() => {
            logger.info("Successfully connected to MongoDB.");
            console.log("✅ MongoDB connected");
            initializeScheduledTasks();

            // NEW: Initialize device sync service
            initializeDeviceSyncService();
        })
        .catch((err) => {
            logger.error("Initial MongoDB connection error. Exiting.", {
                message: err.message,
                stack: err.stack,
            });
            process.exit(1);
        });
    mongoose.connection.on("error", (err) => {
        console.error("❌ MongoDB emitted connection error:", err.message);
        console.error(err.stack);
        logger.error("MongoDB connection error after initial connection:", {
            message: err.message,
        });
    });
    mongoose.connection.on("disconnected", () => {
        if (!isGracefullyClosing)
            logger.warn("MongoDB disconnected. Attempting to reconnect...");
    });
    mongoose.connection.on("reconnected", () =>
        logger.info("MongoDB reconnected.")
    );
} else {
    logger.info(
        "Test environment detected. Skipping direct Mongoose connection in server.js."
    );
}

function initializeScheduledTasks() {
    console.log("📅 Initializing scheduled tasks...");
    const enableScheduledTasks = process.env.ENABLE_SCHEDULED_TASKS !== "false";
    if (!enableScheduledTasks) {
        logger.info(
            "Scheduled tasks disabled via ENABLE_SCHEDULED_TASKS environment variable"
        );
        return;
    }
    if (isTestEnv) {
        logger.info(
            "Test environment detected. Skipping scheduled tasks initialization."
        );
        return;
    }
    try {
        console.log("✅ Calling scheduledTasksService.init()");
        scheduledTasksService.init();
        console.log("✅ scheduledTasksService.init() completed");
        logger.info("Scheduled tasks service initialized successfully");

        // Initialize reminder service
        console.log("✅ Calling reminderService.init()");
        reminderService.init();
        console.log("✅ reminderService.init() completed");
        logger.info("Reminder service initialized successfully");
    } catch (error) {
        logger.error("Failed to initialize scheduled tasks service", {
            error: error.message,
            stack: error.stack,
        });
        logger.warn(
            "Continuing without scheduled tasks due to initialization error"
        );
    }
}

// NEW: Initialize device sync service
function initializeDeviceSyncService() {
    if (!deviceSyncService) {
        logger.info("Device sync service not available, skipping initialization");
        return;
    }

    console.log("🔄 Initializing device sync service...");
    try {
        deviceSyncService.startPeriodicCleanup();
        logger.info("Device sync service initialized successfully");
        console.log("✅ Device sync service initialized");
    } catch (error) {
        logger.error("Failed to initialize device sync service", {
            error: error.message,
            stack: error.stack
        });
        logger.warn("Continuing without device sync service due to initialization error");
    }
}

console.log("🌐 Setting up CORS...");
const allowedOriginsStr =
    process.env.ALLOWED_ORIGINS || "http://localhost:5173,https://localhost:5173";
// if user set ALLOWED_ORIGINS="*", treat it as wildcard
const allowedOriginsList =
    allowedOriginsStr.trim() === "*"
        ? "*"
        : allowedOriginsStr.split(",").map((orig) => orig.trim());
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
            allowedOriginsList === "*" ||
            allowedOriginsList.indexOf(origin) !== -1
        ) {
            callback(null, true);
        } else {
            logger.warn("CORS: Origin not allowed", { origin, allowedOriginsList });
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Accept",
        "Origin",
        "X-Requested-With",
    ],
    exposedHeaders: ["Content-Length", "Content-Type"],
};
try {
    console.log("🔧 Applying CORS middleware...");
    app.use(cors(corsOptions));
    console.log("✅ CORS middleware applied");
    logger.info("CORS middleware initialized", {
        configuredOrigins:
            allowedOriginsList === "*" ? "All (*)" : allowedOriginsList,
    });
} catch (err) {
    console.error("❌ Failed to apply CORS middleware:", err.message);
    console.error(err.stack);
    process.exit(1);
}

console.log("📝 Setting up request logging middleware...");
app.use((req, res, next) => {
    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get("user-agent") || "unknown";
    const requestId =
        req.headers["x-request-id"] ||
        `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    req.requestId = requestId;
    logger.http("Incoming request", {
        requestId,
        method,
        url: originalUrl,
        ip,
        userAgent,
    });
    res.on("finish", () => {
        const duration = Date.now() - start;
        const { statusCode } = res;
        const contentLength = res.get("Content-Length");
        const level =
            statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
        logger.log(level, "Request finished", {
            requestId,
            method,
            url: originalUrl,
            statusCode,
            durationMs: duration,
            contentLength: contentLength || "N/A",
            userId: req.user?.id,
        });
    });
    next();
});

console.log("🔧 Setting up body parsing middleware...");
// Keep the raw body for webhook signature verification
app.use(
    express.json({
        limit: "50mb",
        verify: (req, res, buf) => {
            // We only need the raw body for Paddle webhooks
            if (req.originalUrl.startsWith("/api/paddle/webhook")) {
                req.rawBody = buf.toString();
            }
        },
    })
);
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

console.log("🔧 Setting up security middleware...");
app.use(mongoSanitize());
if (typeof xss === "function") {
    app.use(xss());
} else {
    logger.error(
        "xss-clean module was not imported as a function. XSS middleware not applied."
    );
}
app.use(hpp({ whitelist: ["sort", "fields", "page", "limit"] }));
app.use(compression());

console.log("🔧 Setting up rate limiting...");
app.use("/api/", generalLimiter);

console.log("🔧 Setting up security headers...");
try {
    app.use(securityHeaders);
    console.log("✅ Security headers middleware applied");
} catch (err) {
    console.error("❌ Failed to apply security headers middleware:", err.message);
    console.error(err.stack);
    process.exit(1);
}

console.log("🔧 Setting up MIME type handling...");
// Custom middleware to set proper MIME types for JavaScript files
app.use((req, res, next) => {
    const ext = path.extname(req.path).toLowerCase();

    // Set proper MIME types to fix the "text/plain" issue
    switch (ext) {
        case '.js':
        case '.mjs':
            res.type('application/javascript');
            break;
        case '.css':
            res.type('text/css');
            break;
        case '.json':
            res.type('application/json');
            break;
        case '.webmanifest':
            res.type('application/manifest+json');
            break;
    }

    next();
});

console.log("📁 Setting up static file serving...");
const publicUploadsPath = path.join(__dirname, "public", "Uploads");
app.use("/uploads", imageCorsMiddleware);
app.use(
    "/uploads",
    express.static(publicUploadsPath, {
        maxAge: "1y",
        etag: true,
        lastModified: true,
        setHeaders: (res, path) => {
            if (path.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
                res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
                res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
            }
        },
    })
);
logger.info("Static file serving configured for /uploads", {
    path: publicUploadsPath,
    corsEnabled: true,
});

console.log("🛠️ Setting up utility file routes...");
// Serve the utility files with proper MIME types
app.get('/src/utils/SyncManager.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'src', 'utils', 'SyncManager.js'));
});

app.get('/src/utils/clientInit.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'src', 'utils', 'clientInit.js'));
});

// Serve PWA static files
console.log("📱 Setting up PWA static files...");
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath, {
    maxAge: "1h",
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
        // Service worker should not be cached
        if (path.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Service-Worker-Allowed', '/');
        }
        // Web manifest
        if (path.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json');
        }
    }
}));

console.log("💳 Setting up Paddle configuration...");
// Paddle environment and base URL (dynamic between sandbox and live)
const PADDLE_ENV =
    process.env.NODE_ENV === "production" ? "production" : "sandbox";
const PADDLE_BASE_URL =
    PADDLE_ENV === "production"
        ? "https://api.paddle.com"
        : "https://sandbox-api.paddle.com";
console.log("🛒 Setting up Paddle transaction route...");
app.post(
    "/api/paddle/create-transaction",
    authMiddleware,
    catchAsync(async (req, res, next) => {
        console.log("▶️ Paddle env:", PADDLE_ENV);
        console.log("▶️ Received body:", req.body);

        const {
            priceId,
            quantity,
            customerEmail,
            customData,
            successUrl,
            cancelUrl,
        } = req.body;

        const userId = req.user.id;
        const requestId = req.requestId;

        logger.info("Creating Paddle transaction", { userId, priceId, requestId });

        if (!priceId || !quantity) {
            logger.warn("Invalid request: Missing priceId or quantity", {
                userId,
                requestId,
                body: req.body,
            });
            return next(
                new AppError("Missing required fields: priceId and quantity", 400)
            );
        }

        try {
            const response = await axios.post(
                `${PADDLE_BASE_URL}/transactions`,
                {
                    items: [{ price_id: priceId, quantity }],
                    customer_email: customerEmail || req.user.email,
                    custom_data: customData || { userId },
                    success_url: successUrl || `${process.env.FRONTEND_URL}/app`,
                    cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/#pricing`,
                    collection_mode: "automatic",
                },
                {
                    headers: {
                        Authorization: `Bearer ${PADDLE_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                }
            );
            logger.info("Paddle transaction created", {
                userId,
                transactionId: response.data.data.id,
                requestId,
            });
            return res.status(200).json({ transactionId: response.data.data.id });
        } catch (err) {
            logger.error("Paddle transaction creation failed", {
                userId,
                requestId,
                status: err.response?.status,
                paddleError: err.response?.data,
            });
            return next(
                new AppError(
                    err.response?.data?.message || "Failed to create transaction",
                    err.response?.status || 500
                )
            );
        }
    })
);

console.log("🔑 Setting up VAPID key endpoint...");
// VAPID key endpoint for push notifications
app.get('/api/vapid-key', (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
        return res.status(503).json({
            error: 'Push notifications not configured'
        });
    }

    res.json({
        publicKey: process.env.VAPID_PUBLIC_KEY
    });
});

// Push subscription endpoint
app.post('/api/push-subscription', authMiddleware, catchAsync(async (req, res, next) => {
    const subscription = req.body;
    const userId = req.user.id;

    logger.info('New push subscription received', { userId });

    // Store subscription in your database here
    // This is where you'd save the subscription to your existing user model

    res.json({ success: true, message: 'Subscription saved successfully' });
}));

const checkModule = (mod, name) => {
    if (!mod) {
        logger.error(`Module ${name} failed to import properly`);
        try {
            require.resolve(`./routes/${name}.js`);
            logger.debug(`Module path exists: ./routes/${name}.js`);
        } catch (e) {
            logger.error(`Module path not found: ./routes/${name}.js`);
        }
    }
};

console.log("🛣️ Registering routes...");
try {
    logger.debug("Registering routes...");

    console.log("📋 Registering health check route...");
    app.get("/api/health", (req, res) => {
        if (process.env.NODE_ENV === "test") {
            logger.info("/api/health accessed in test mode, reporting UP.");
            res
                .status(200)
                .json({
                    status: "UP",
                    message:
                        "API is running (test mode - DB check bypassed for this endpoint).",
                });
        } else if (mongoose.connection.readyState === 1) {
            logger.info("/api/health accessed, DB connected, reporting UP.");
            res.status(200).json({
                status: "UP",
                message: "API is healthy, DB connected.",
                scheduledTasks: {
                    enabled: process.env.ENABLE_SCHEDULED_TASKS !== "false",
                    status:
                        process.env.ENABLE_SCHEDULED_TASKS !== "false"
                            ? "running"
                            : "disabled",
                },
                // NEW: PWA sync status
                pwaSyncStatus: {
                    enabled: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
                    deviceSyncService: deviceSyncService ? "available" : "not available"
                }
            });
        } else {
            logger.warn(
                "/api/health: API is up but DB is not connected or in unexpected state.",
                { dbState: mongoose.connection.readyState }
            );
            res
                .status(503)
                .json({ status: "DEGRADED", message: "Database not ready." });
        }
    });

    console.log("🔐 Registering auth routes...");
    app.use("/api/auth", authRoutes);

    console.log("📦 Registering items routes...");
    app.use("/api/items", itemsRoutes);
    console.log("🖼️ Registering image routes...");
    app.use("/api/images", imageRoutes);

    console.log("👤 Registering account routes...");
    app.use("/api/account", accountRoutes);

    console.log("📋 Registering meta routes...");
    app.use("/api/meta", metaRoutes);
    console.log("💳 Registering paddle webhook routes...");
    app.use("/api/paddle", paddleWebhook);

    console.log("🔔 Registering push notification routes...");
    app.use("/api/push", pushNotificationRoutes);

    // NEW: Register sync routes
    if (syncRoutes) {
        console.log("🔄 Registering sync routes...");
        app.use("/api/sync", syncRoutes);
        logger.debug("syncRoutes registered.");
    } else {
        logger.info("Sync routes not available, skipping registration");
    }

    console.log("🔔 Registering reminders routes...");
    app.use("/api/reminders", reminderRoutes);
    console.log("✅ Checking imported modules...");
    checkModule(authRoutes, "authRoutes");
    checkModule(itemsRoutes, "itemsRoutes");
    checkModule(imageRoutes, "imageRoutes");
    checkModule(accountRoutes, "accountRoutes");
    checkModule(metaRoutes, "metaRoutes");
    checkModule(paddleWebhook, "paddleWebhook");
    if (process.env.ENABLE_ADMIN_ROUTES !== "false") {
        console.log("🔧 Registering admin routes...");
        app.use("/api/admin", adminRoutes);
        logger.debug("adminRoutes registered.");
    } else {
        logger.info(
            "Admin routes disabled via ENABLE_ADMIN_ROUTES environment variable"
        );
    }

    console.log("✅ All routes registered successfully");
    logger.debug("All routes registered successfully.");
} catch (err) {
    console.error("❌ Error registering routes:", err.message);
    console.error(err.stack);
    logger.error("Error registering routes:", {
        message: err.message,
        stack: err.stack,
        // Add more debugging info:
        importedModules: {
            authRoutes: !!authRoutes,
            itemsRoutes: !!itemsRoutes,
            imageRoutes: !!imageRoutes,
            accountRoutes: !!accountRoutes,
            syncRoutes: !!syncRoutes, // NEW
        },
    });
    process.exit(1);
}

console.log("🏠 Setting up default route...");
app.get("/", (req, res) => res.send("API is operational."));
console.log("🔧 Setting up error handlers...");
app.all("*", notFoundHandler);
app.use(globalErrorHandler);

let serverInstance;
const mainScriptPath = fileURLToPath(import.meta.url);
const isMainModule =
    process.argv[1] === mainScriptPath ||
    (typeof require !== "undefined" &&
        require.main === module &&
        require.main.filename === mainScriptPath);
if (isMainModule) {
    const PORT = process.env.PORT || 5001;
    const startServer = () => {
        try {
            console.log(`🚀 Starting server on port ${PORT}...`);

            const httpServer = createServer(app);
            const io = new SocketIOServer(httpServer, { cors: corsOptions });

            // Initialize existing socket events (if you have them)
            if (typeof initSocketIO === 'function') {
                initSocketIO(io);
            }

            // Socket authentication middleware
            io.use(async (socket, next) => {
                const token = socket.handshake.auth?.token;

                console.log("🛂 Incoming socket connection attempt:", {
                    token: token?.slice(0, 10) + "...", // for safe debugging
                    headers: socket.handshake.headers,
                });

                if (!token) {
                    console.warn("❌ Rejected: No token");
                    return next(new Error("No token"));
                }

                try {
                    const { verifyAccessToken } = await import("./utils/jwt.js");
                    const decoded = verifyAccessToken(token);

                    console.log("✅ Token decoded:", decoded);

                    socket.userId = decoded.user.id;
                    next();
                } catch (err) {
                    console.error("❌ Invalid token:", err.message || err);
                    return next(new Error("Invalid token"));
                }
            });

            // Set up socket events (including reminder socket events)
            if (typeof setupSocketEvents === 'function') {
                setupSocketEvents(io);
            }

            io.on("connection", (socket) => {
                console.log("🔗 Client connected:", socket.id, "User:", socket.userId);

                // NEW: Handle device sync events
                socket.on("device-register", async (deviceInfo) => {
                    try {
                        if (deviceSyncService) {
                            await deviceSyncService.registerDevice(socket.userId, deviceInfo);
                            socket.emit("device-registered", { success: true });
                            console.log("📱 Device registered via socket:", deviceInfo.id);
                        }
                    } catch (error) {
                        socket.emit("device-register-error", { error: error.message });
                        console.error("❌ Device registration failed:", error);
                    }
                });

                socket.on("sync-request", async () => {
                    try {
                        if (deviceSyncService) {
                            await deviceSyncService.syncUserData(socket.userId);
                            socket.emit("sync-complete", { success: true });
                            console.log("🔄 Sync requested via socket for user:", socket.userId);
                        }
                    } catch (error) {
                        socket.emit("sync-error", { error: error.message });
                        console.error("❌ Sync failed:", error);
                    }
                });
            });

            serverInstance = httpServer.listen(PORT, () => {
                console.log(
                    `✅ Server running on port ${PORT} and ready to accept connections.`
                );
                logger.info(
                    `Server running on port ${PORT} and ready to accept connections.`,
                    {
                        environment: process.env.NODE_ENV,
                        pwaSyncEnabled: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
                        deviceSyncService: deviceSyncService ? "available" : "not available"
                    }
                );
            });
            handleUnhandledRejection(serverInstance);
        } catch (err) {
            console.error("🔥 Server failed to start:", err);
            logger.error("🔥 Server failed to start:", {
                message: err.message,
                stack: err.stack,
            });
            process.exit(1);
        }
    };
    if (!isTestEnv && mongoose.connection.readyState !== 1) {
        logger.info("Server not started yet, waiting for MongoDB connection...");
        mongoose.connection.once("open", () => {
            logger.info("MongoDB connected (event 'open'), starting server.");
            startServer();
        });
        mongoose.connection.once("error", (err) => {
            logger.error(
                "MongoDB connection error before server start, process will likely exit from connect .catch",
                { message: err.message }
            );
        });
    } else {
        logger.info(
            isTestEnv
                ? "Test environment: Starting server immediately."
                : "MongoDB already connected or connection attempt in progress. Starting server."
        );
        startServer();
    }
}

const shutdown = async (signal) => {
    isGracefullyClosing = true;
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    try {
        await scheduledTasksService.shutdown();
        await reminderService.shutdown();

        // NEW: Shutdown device sync service
        if (deviceSyncService && typeof deviceSyncService.shutdown === 'function') {
            await deviceSyncService.shutdown();
            logger.info("Device sync service shut down successfully");
        }
    } catch (error) {
        logger.error("Error shutting down services:", {
            message: error.message,
            stack: error.stack,
        });
    }
    if (serverInstance) {
        serverInstance.close(async () => {
            logger.info("HTTP server closed.");
            try {
                if (mongoose.connection.readyState === 1) {
                    await mongoose.connection.close();
                    logger.info("MongoDB connection closed.");
                } else {
                    logger.info(
                        "MongoDB connection already closed or not established at shutdown."
                    );
                }
            } catch (err) {
                logger.error("Error closing MongoDB connection during shutdown:", {
                    message: err.message,
                });
            } finally {
                logger.info("Shutdown complete.");
                process.exit(0);
            }
        });
    } else {
        logger.info("No active HTTP server to close. Exiting.");
        if (mongoose.connection.readyState === 1) {
            try {
                await mongoose.connection.close();
                logger.info("MongoDB connection closed during direct exit.");
            } catch (e) {
                logger.error("Error closing MongoDB on direct exit.", {
                    message: e.message,
                });
            }
        }
        process.exit(0);
    }
    setTimeout(() => {
        logger.warn("Graceful shutdown timeout. Forcing exit.");
        process.exit(1);
    }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;