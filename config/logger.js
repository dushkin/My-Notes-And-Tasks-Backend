// src/config/logger.js
import winston from 'winston';
import path from 'path';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Define the logs directory at the project root
const logDir = path.join(process.cwd(), 'logs');

// Custom format for console logging
const consoleLogFormat = printf(({ level, message, timestamp, stack, metadata }) => {
  let log = `${timestamp} ${level}: ${message}`;
  if (stack) {
    log = `${log} - Stack: ${stack}`;
  }
  if (metadata && Object.keys(metadata).length) {
    const safeMetadata = {};
    for (const key in metadata) {
      if (Object.prototype.hasOwnProperty.call(metadata, key)) {
        if (typeof metadata[key] === 'object' && metadata[key] !== null) {
          safeMetadata[key] = '[Object]';
        } else {
          safeMetadata[key] = metadata[key];
        }
      }
    }
    log += ` ${JSON.stringify(safeMetadata)}`;
  }
  return log;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info', // Minimum log level
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }), // Log stack traces for errors
    json() // JSON format for file transports
  ),
  transports: [
    // Log errors to a separate file
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    // Log all (from info level up) to a combined file
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
  ],
  exceptionHandlers: [ // Handle uncaught exceptions
    new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })
  ],
  rejectionHandlers: [ // Handle unhandled promise rejections
    new winston.transports.File({ filename: path.join(logDir, 'rejections.log') })
  ]
});

// If not in production, add console transport with a more readable format
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(), // Add colors to console output
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      consoleLogFormat
    ),
    level: 'debug', // Show debug level logs and above in console during development
  }));
}

export default logger;