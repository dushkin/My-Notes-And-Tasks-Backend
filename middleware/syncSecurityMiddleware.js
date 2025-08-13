import logger from '../config/logger.js';
import { AppError } from './errorHandlerMiddleware.js';

/**
 * Enhanced security middleware specifically for sync operations
 */

/**
 * Validate sync request size to prevent DoS attacks
 */
export const validateSyncRequestSize = (maxSizeBytes = 10 * 1024 * 1024) => { // 10MB default
  return (req, res, next) => {
    const contentLength = parseInt(req.get('Content-Length') || '0');
    
    if (contentLength > maxSizeBytes) {
      logger.warn('Sync request too large', {
        userId: req.user?.id,
        contentLength,
        maxAllowed: maxSizeBytes,
        endpoint: req.originalUrl
      });
      
      return res.status(413).json({
        success: false,
        message: 'Request payload too large for sync operation',
        errors: [{
          field: 'payload',
          message: `Maximum allowed size is ${Math.floor(maxSizeBytes / (1024 * 1024))}MB`
        }]
      });
    }
    
    next();
  };
};

/**
 * Validate sync data structure to prevent malformed payloads
 */
export const validateSyncDataStructure = (req, res, next) => {
  const { body } = req;
  
  // Check for common sync payload issues
  if (body && typeof body === 'object') {
    // Prevent excessively deep nested objects
    const maxDepth = 10;
    const currentDepth = getObjectDepth(body);
    
    if (currentDepth > maxDepth) {
      logger.warn('Sync payload too deeply nested', {
        userId: req.user?.id,
        depth: currentDepth,
        maxAllowed: maxDepth
      });
      
      return res.status(400).json({
        success: false,
        message: 'Sync data structure too complex',
        errors: [{
          field: 'structure',
          message: `Maximum nesting depth is ${maxDepth} levels`
        }]
      });
    }
    
    // Prevent excessive array sizes
    const maxArraySize = 1000;
    const arrayViolation = checkArraySizes(body, maxArraySize);
    
    if (arrayViolation) {
      logger.warn('Sync payload contains oversized array', {
        userId: req.user?.id,
        arraySize: arrayViolation.size,
        path: arrayViolation.path,
        maxAllowed: maxArraySize
      });
      
      return res.status(400).json({
        success: false,
        message: 'Sync data contains oversized arrays',
        errors: [{
          field: 'arrays',
          message: `Maximum array size is ${maxArraySize} items`,
          path: arrayViolation.path
        }]
      });
    }
  }
  
  next();
};

/**
 * Validate sync metadata and timestamps
 */
export const validateSyncMetadata = (req, res, next) => {
  const { lastSyncTime, syncVersion, deviceTimestamp } = req.body;
  
  if (lastSyncTime && !isValidTimestamp(lastSyncTime)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid sync timestamp',
      errors: [{
        field: 'lastSyncTime',
        message: 'Must be a valid ISO 8601 timestamp'
      }]
    });
  }
  
  if (syncVersion && typeof syncVersion !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Invalid sync version',
      errors: [{
        field: 'syncVersion',
        message: 'Must be a string'
      }]
    });
  }
  
  if (deviceTimestamp && !isValidTimestamp(deviceTimestamp)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid device timestamp',
      errors: [{
        field: 'deviceTimestamp',
        message: 'Must be a valid ISO 8601 timestamp'
      }]
    });
  }
  
  // Check for reasonable timestamp ranges (not too far in past/future)
  const now = Date.now();
  const maxPastDays = 365 * 2; // 2 years
  const maxFutureDays = 1; // 1 day
  
  const timestamps = [lastSyncTime, deviceTimestamp].filter(Boolean);
  
  for (const timestamp of timestamps) {
    const ts = new Date(timestamp).getTime();
    const daysDiff = Math.abs(now - ts) / (1000 * 60 * 60 * 24);
    
    if (ts < now && daysDiff > maxPastDays) {
      return res.status(400).json({
        success: false,
        message: 'Timestamp too far in the past',
        errors: [{
          field: 'timestamp',
          message: `Cannot be more than ${maxPastDays} days ago`
        }]
      });
    }
    
    if (ts > now && daysDiff > maxFutureDays) {
      return res.status(400).json({
        success: false,
        message: 'Timestamp too far in the future',
        errors: [{
          field: 'timestamp',
          message: `Cannot be more than ${maxFutureDays} day in the future`
        }]
      });
    }
  }
  
  next();
};

/**
 * Validate user permissions for sync operations
 */
export const validateSyncPermissions = (req, res, next) => {
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      errors: [{
        field: 'auth',
        message: 'Valid user session required for sync operations'
      }]
    });
  }
  
  // Check if user account is active
  if (!user.isVerified) {
    logger.warn('Unverified user attempting sync', {
      userId: user.id,
      email: user.email
    });
    
    return res.status(403).json({
      success: false,
      message: 'Account verification required',
      errors: [{
        field: 'verification',
        message: 'Please verify your account before using sync features'
      }]
    });
  }
  
  // Check subscription status if required
  const requiresSubscription = process.env.SYNC_REQUIRES_SUBSCRIPTION === 'true';
  if (requiresSubscription && user.subscriptionStatus !== 'active') {
    return res.status(403).json({
      success: false,
      message: 'Active subscription required',
      errors: [{
        field: 'subscription',
        message: 'Sync features require an active subscription'
      }]
    });
  }
  
  next();
};

/**
 * Rate limiting for sync operations (per user)
 */
export const syncRateLimit = (maxRequests = 60, windowMinutes = 15) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const userId = req.user?.id;
    if (!userId) return next();
    
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = now - windowMs;
    
    // Clean up old entries
    if (Math.random() < 0.1) { // Cleanup 10% of requests
      for (const [key, data] of requests.entries()) {
        if (data.resetTime < now) {
          requests.delete(key);
        }
      }
    }
    
    const userKey = `sync_${userId}`;
    const userRequests = requests.get(userKey);
    
    if (!userRequests) {
      requests.set(userKey, {
        count: 1,
        resetTime: now + windowMs
      });
      return next();
    }
    
    if (userRequests.resetTime < now) {
      // Reset window
      userRequests.count = 1;
      userRequests.resetTime = now + windowMs;
      return next();
    }
    
    if (userRequests.count >= maxRequests) {
      const resetInMinutes = Math.ceil((userRequests.resetTime - now) / 60000);
      
      logger.warn('Sync rate limit exceeded', {
        userId,
        requestCount: userRequests.count,
        maxRequests,
        resetInMinutes
      });
      
      return res.status(429).json({
        success: false,
        message: 'Sync rate limit exceeded',
        errors: [{
          field: 'rateLimit',
          message: `Too many sync requests. Try again in ${resetInMinutes} minutes`,
          resetInMinutes
        }]
      });
    }
    
    userRequests.count++;
    next();
  };
};

/**
 * Security headers for sync endpoints
 */
export const setSyncSecurityHeaders = (req, res, next) => {
  // Prevent caching of sync data
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  next();
};

// Utility functions
function getObjectDepth(obj, currentDepth = 0) {
  if (typeof obj !== 'object' || obj === null || currentDepth > 15) {
    return currentDepth;
  }
  
  let maxDepth = currentDepth;
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const depth = getObjectDepth(obj[key], currentDepth + 1);
      maxDepth = Math.max(maxDepth, depth);
    }
  }
  
  return maxDepth;
}

function checkArraySizes(obj, maxSize, path = '') {
  if (Array.isArray(obj)) {
    if (obj.length > maxSize) {
      return { size: obj.length, path };
    }
    
    for (let i = 0; i < Math.min(obj.length, 100); i++) { // Check first 100 items
      const violation = checkArraySizes(obj[i], maxSize, `${path}[${i}]`);
      if (violation) return violation;
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const violation = checkArraySizes(value, maxSize, path ? `${path}.${key}` : key);
      if (violation) return violation;
    }
  }
  
  return null;
}

function isValidTimestamp(timestamp) {
  if (typeof timestamp !== 'string') return false;
  const date = new Date(timestamp);
  return !isNaN(date.getTime()) && timestamp.includes('T'); // Basic ISO check
}

export default {
  validateSyncRequestSize,
  validateSyncDataStructure,
  validateSyncMetadata,
  validateSyncPermissions,
  syncRateLimit,
  setSyncSecurityHeaders
};