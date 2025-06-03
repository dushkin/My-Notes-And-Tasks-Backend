// middleware/errorHandlerMiddleware.js

class AppError extends Error {
    constructor(message, statusCode, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        
        Error.captureStackTrace(this, this.constructor);
    }
}

// MongoDB/Mongoose error handlers
const handleCastErrorDB = (err) => {
    const message = `Invalid ${err.path}: ${err.value}`;
    return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
    const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
    const message = `Duplicate field value: ${value}. Please use another value!`;
    return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
    const errors = Object.values(err.errors).map(el => el.message);
    const message = `Invalid input data. ${errors.join('. ')}`;
    return new AppError(message, 400);
};

const handleJWTError = () => 
    new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = () =>
    new AppError('Your token has expired! Please log in again.', 401);

// Multer error handlers
const handleMulterError = (err) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return new AppError('File too large. Maximum size is 10MB.', 413);
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return new AppError('Too many files uploaded.', 400);
    }
    if (err.code === 'LIMIT_FIELD_COUNT') {
        return new AppError('Too many fields.', 400);
    }
    return new AppError('File upload error.', 400);
};

// Send error response in development
const sendErrorDev = (err, req, res) => {
    // API errors
    if (req.originalUrl.startsWith('/api')) {
        return res.status(err.statusCode).json({
            status: err.status,
            error: err.message,
            message: err.message,
            stack: err.stack,
            err: err // Full error object for debugging
        });
    }
    
    // Non-API errors (if you have any server-rendered pages)
    console.error('ERROR 💥', err);
    return res.status(err.statusCode).json({
        error: 'Something went wrong!'
    });
};

// Send error response in production
const sendErrorProd = (err, req, res) => {
    // API errors
    if (req.originalUrl.startsWith('/api')) {
        // Operational, trusted error: send message to client
        if (err.isOperational) {
            return res.status(err.statusCode).json({
                error: err.message
            });
        }
        
        // Programming or other unknown error: don't leak error details
        console.error('ERROR 💥', err);
        
        // Send generic message
        return res.status(500).json({
            error: 'Something went wrong on the server'
        });
    }
    
    // Non-API errors
    if (err.isOperational) {
        return res.status(err.statusCode).json({
            error: err.message
        });
    }
    
    // Programming or other unknown error
    console.error('ERROR 💥', err);
    return res.status(500).json({
        error: 'Something went wrong!'
    });
};

// Main error handling middleware
const globalErrorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';
    
    // Log error details for monitoring
    console.error('[Error Handler]', {
        message: err.message,
        statusCode: err.statusCode,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        user: req.user?.email || 'anonymous'
    });
    
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        sendErrorDev(err, req, res);
    } else {
        let error = { ...err };
        error.message = err.message;
        
        // Handle specific error types
        if (err.name === 'CastError') error = handleCastErrorDB(error);
        if (err.code === 11000) error = handleDuplicateFieldsDB(error);
        if (err.name === 'ValidationError') error = handleValidationErrorDB(error);
        if (err.name === 'JsonWebTokenError') error = handleJWTError();
        if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
        if (err.name === 'MulterError') error = handleMulterError(error);
        
        sendErrorProd(error, req, res);
    }
};

// Async error wrapper - wraps async route handlers to catch errors
const catchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};

// 404 handler middleware
const notFoundHandler = (req, res, next) => {
    const err = new AppError(`Can't find ${req.originalUrl} on this server!`, 404);
    next(err);
};

// Unhandled rejection handler
const handleUnhandledRejection = (server) => {
    process.on('unhandledRejection', (err) => {
        console.error('UNHANDLED REJECTION! 💥 Shutting down...');
        console.error(err.name, err.message);
        if (server) {
            server.close(() => {
                process.exit(1);
            });
        } else {
            process.exit(1);
        }
    });
};

// Uncaught exception handler
const handleUncaughtException = () => {
    process.on('uncaughtException', (err) => {
        console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
        console.error(err.name, err.message);
        process.exit(1);
    });
};

module.exports = {
    AppError,
    globalErrorHandler,
    catchAsync,
    notFoundHandler,
    handleUnhandledRejection,
    handleUncaughtException
};