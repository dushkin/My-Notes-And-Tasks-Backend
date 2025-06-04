// middleware/errorHandlerMiddleware.js
import logger from '../config/logger.js';

class AppError extends Error {
    constructor(message, statusCode, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        Error.captureStackTrace(this, this.constructor);
    }
}

const handleCastErrorDB = (err) => {
    const message = `Invalid ${err.path}: ${err.value}`;
    return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
    const valueMatch = err.errmsg?.match(/(["'])(\\?.)*?\1/);
    const value = valueMatch ? valueMatch[0] : (err.keyValue ? JSON.stringify(err.keyValue) : 'unknown');
    const message = `Duplicate field value: ${value}. Please use another value!`;
    return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
    const errors = Object.values(err.errors).map(el => el.message);
    const message = `Invalid input data. ${errors.join('. ')}`;
    return new AppError(message, 400);
};

const handleJWTError = () => new AppError('Invalid token. Please log in again!', 401);
const handleJWTExpiredError = () => new AppError('Your token has expired! Please log in again.', 401);

const handleMulterError = (err) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return new AppError('File too large. Maximum size is 10MB.', 413);
    }
    return new AppError(err.message || 'File upload error.', 400);
};

const sendErrorDev = (err, req, res) => {
    if (req.originalUrl.startsWith('/api')) {
        return res.status(err.statusCode).json({
            status: err.status,
            error: err.message,
            message: err.message,
            stack: err.stack,
            err
        });
    }
    logger.error('DEVELOPMENT ERROR (Non-API)', {
        errorMessage: err.message,
        errorStack: err.stack,
        errorStatus: err.status,
        errorStatusCode: err.statusCode,
        isOperational: err.isOperational,
        url: req.originalUrl
    });
    return res.status(err.statusCode).json({ error: 'Something went very wrong!' });
};

const sendErrorProd = (err, req, res) => {
    if (req.originalUrl.startsWith('/api')) {
        if (err.isOperational) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        logger.error('PRODUCTION API ERROR (Non-Operational)', {
            errorMessage: err.message,
            // stack: err.stack, // Optionally omit stack in prod log for non-operational if too verbose
            url: req.originalUrl,
            method: req.method,
            ip: req.ip,
            requestId: req.requestId
        });
        return res.status(500).json({ error: 'Something went wrong on the server. Please try again later.' });
    }
    if (err.isOperational) {
        return res.status(err.statusCode).json({ error: err.message });
    }
    logger.error('PRODUCTION ERROR (Non-API, Non-Operational)', {
         errorMessage: err.message,
         // stack: err.stack,
         url: req.originalUrl,
         requestId: req.requestId
    });
    return res.status(500).json({ error: 'Something went very wrong!' });
};

const globalErrorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    logger.error('Error caught by globalErrorHandler', {
        errorMessage: err.message,
        errorName: err.name,
        statusCode: err.statusCode,
        status: err.status,
        stack: err.stack,
        isOperational: err.isOperational,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userId: req.user?.id || 'anonymous',
        requestId: req.requestId
    });

    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        sendErrorDev(err, req, res);
    } else {
        let error = { ...err, message: err.message };

        if (err.name === 'CastError') error = handleCastErrorDB(err);
        else if (err.code === 11000) error = handleDuplicateFieldsDB(err);
        else if (err.name === 'ValidationError') error = handleValidationErrorDB(err);
        else if (err.name === 'JsonWebTokenError') error = handleJWTError();
        else if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
        else if (err.name === 'MulterError') error = handleMulterError(err);

        sendErrorProd(error, req, res);
    }
};

const catchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(err => next(err));
    };
};

const notFoundHandler = (req, res, next) => {
    const message = `Can't find ${req.originalUrl} on this server!`;
    logger.warn('404 Not Found', { url: req.originalUrl, ip: req.ip, method: req.method, requestId: req.requestId });
    const err = new AppError(message, 404);
    next(err);
};

const handleUnhandledRejection = (serverInstance) => {
    process.on('unhandledRejection', (err) => {
        // Use logger.error for critical errors, as fatal is not standard in Winston default levels
        logger.error('UNHANDLED PROMISE REJECTION! 💥 Shutting down...', {
            errorName: err.name,
            errorMessage: err.message,
            errorStack: err.stack,
            errorObject: err
        });
        if (serverInstance) {
            serverInstance.close(() => {
                process.exit(1);
            });
        } else {
            process.exit(1);
        }
    });
};

const handleUncaughtException = () => {
    process.on('uncaughtException', (err) => {
        // Use logger.error for critical errors
        logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', {
            errorName: err.name,
            errorMessage: err.message,
            errorStack: err.stack,
            errorObject: err
        });
        process.exit(1);
    });
};

export {
    AppError,
    globalErrorHandler,
    catchAsync,
    notFoundHandler,
    handleUnhandledRejection,
    handleUncaughtException
};