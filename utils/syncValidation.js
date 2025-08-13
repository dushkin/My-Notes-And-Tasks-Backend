import { body, param, validationResult } from 'express-validator';
import logger from '../config/logger.js';

/**
 * Device validation schemas
 */
export const deviceValidationRules = {
  register: [
    body('id')
      .exists({ checkFalsy: true })
      .withMessage('Device ID is required')
      .isString()
      .withMessage('Device ID must be a string')
      .isLength({ min: 1, max: 128 })
      .withMessage('Device ID must be between 1-128 characters')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Device ID can only contain letters, numbers, hyphens, and underscores'),
    
    body('name')
      .exists({ checkFalsy: true })
      .withMessage('Device name is required')
      .isString()
      .withMessage('Device name must be a string')
      .isLength({ min: 1, max: 100 })
      .withMessage('Device name must be between 1-100 characters')
      .trim()
      .escape(),
    
    body('type')
      .exists({ checkFalsy: true })
      .withMessage('Device type is required')
      .isIn(['iOS', 'Android', 'macOS', 'Windows', 'Linux', 'Unknown'])
      .withMessage('Invalid device type'),
    
    body('platform')
      .optional()
      .isString()
      .withMessage('Platform must be a string')
      .isLength({ max: 50 })
      .withMessage('Platform cannot exceed 50 characters')
      .trim(),
    
    body('userAgent')
      .optional()
      .isString()
      .withMessage('User agent must be a string')
      .isLength({ max: 500 })
      .withMessage('User agent cannot exceed 500 characters')
      .trim(),
    
    body('capabilities')
      .optional()
      .isObject()
      .withMessage('Capabilities must be an object'),
    
    body('capabilities.pushNotifications')
      .optional()
      .isBoolean()
      .withMessage('Push notifications capability must be boolean'),
    
    body('capabilities.backgroundSync')
      .optional()
      .isBoolean()
      .withMessage('Background sync capability must be boolean'),
    
    body('capabilities.indexedDB')
      .optional()
      .isBoolean()
      .withMessage('IndexedDB capability must be boolean'),
    
    body('capabilities.serviceWorker')
      .optional()
      .isBoolean()
      .withMessage('Service worker capability must be boolean'),
    
    body('capabilities.offlineSupport')
      .optional()
      .isBoolean()
      .withMessage('Offline support capability must be boolean')
  ],

  updateActivity: [
    body('deviceId')
      .exists({ checkFalsy: true })
      .withMessage('Device ID is required')
      .isString()
      .withMessage('Device ID must be a string')
      .isLength({ min: 1, max: 128 })
      .withMessage('Device ID must be between 1-128 characters')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Device ID can only contain letters, numbers, hyphens, and underscores')
  ]
};

/**
 * Sync operation validation schemas
 */
export const syncValidationRules = {
  trigger: [
    body('deviceId')
      .optional()
      .isString()
      .withMessage('Device ID must be a string')
      .isLength({ min: 1, max: 128 })
      .withMessage('Device ID must be between 1-128 characters')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Device ID can only contain letters, numbers, hyphens, and underscores'),
    
    body('dataType')
      .optional()
      .isIn(['all', 'notes', 'settings', 'reminders'])
      .withMessage('Invalid data type for sync')
  ]
};

/**
 * Push notification validation schemas
 */
export const pushNotificationValidationRules = {
  subscribe: [
    body('endpoint')
      .exists({ checkFalsy: true })
      .withMessage('Push endpoint is required')
      .isURL({ require_protocol: true, protocols: ['https'] })
      .withMessage('Push endpoint must be a valid HTTPS URL')
      .isLength({ max: 1000 })
      .withMessage('Push endpoint cannot exceed 1000 characters'),
    
    body('keys')
      .exists()
      .withMessage('Push keys are required')
      .isObject()
      .withMessage('Push keys must be an object'),
    
    body('keys.p256dh')
      .exists({ checkFalsy: true })
      .withMessage('P256DH key is required')
      .isString()
      .withMessage('P256DH key must be a string')
      .isLength({ min: 1, max: 200 })
      .withMessage('P256DH key must be between 1-200 characters'),
    
    body('keys.auth')
      .exists({ checkFalsy: true })
      .withMessage('Auth key is required')
      .isString()
      .withMessage('Auth key must be a string')
      .isLength({ min: 1, max: 200 })
      .withMessage('Auth key must be between 1-200 characters')
  ],

  testNotification: [
    body('message')
      .optional()
      .isString()
      .withMessage('Message must be a string')
      .isLength({ max: 500 })
      .withMessage('Message cannot exceed 500 characters')
      .trim()
  ]
};

/**
 * Generic validation middleware to handle validation results
 */
export const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const validationErrors = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg,
      value: err.value
    }));

    logger.warn('Sync endpoint validation failed', {
      userId: req.user?.id,
      endpoint: req.originalUrl,
      method: req.method,
      errors: validationErrors,
      requestId: req.requestId
    });

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validationErrors
    });
  }

  next();
};

/**
 * Custom validation for device capabilities
 */
export const validateDeviceCapabilities = (req, res, next) => {
  const { capabilities } = req.body;
  
  if (capabilities) {
    const allowedCapabilities = [
      'pushNotifications',
      'backgroundSync', 
      'indexedDB',
      'serviceWorker',
      'offlineSupport'
    ];
    
    const invalidCapabilities = Object.keys(capabilities).filter(
      cap => !allowedCapabilities.includes(cap)
    );
    
    if (invalidCapabilities.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid device capabilities',
        errors: [{
          field: 'capabilities',
          message: `Unknown capabilities: ${invalidCapabilities.join(', ')}`,
          allowedCapabilities
        }]
      });
    }
    
    // Validate capability values are booleans
    for (const [key, value] of Object.entries(capabilities)) {
      if (typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'Invalid capability value',
          errors: [{
            field: `capabilities.${key}`,
            message: 'Capability values must be boolean',
            value
          }]
        });
      }
    }
  }
  
  next();
};

/**
 * Rate limiting validation - ensures requests are not too frequent
 */
export const validateSyncFrequency = (req, res, next) => {
  const userId = req.user.id;
  const now = Date.now();
  
  // Initialize user sync tracking if it doesn't exist
  if (!req.app.locals.syncTracking) {
    req.app.locals.syncTracking = new Map();
  }
  
  const userTracking = req.app.locals.syncTracking.get(userId);
  const minInterval = 30000; // 30 seconds minimum between sync requests
  
  if (userTracking && (now - userTracking.lastSync) < minInterval) {
    const remainingTime = Math.ceil((minInterval - (now - userTracking.lastSync)) / 1000);
    
    logger.warn('Sync request too frequent', {
      userId,
      timeSinceLastSync: now - userTracking.lastSync,
      minInterval,
      remainingTime
    });
    
    return res.status(429).json({
      success: false,
      message: 'Sync requests too frequent',
      errors: [{
        field: 'sync',
        message: `Please wait ${remainingTime} seconds before syncing again`,
        remainingTime
      }]
    });
  }
  
  // Update tracking
  req.app.locals.syncTracking.set(userId, {
    lastSync: now,
    requestCount: (userTracking?.requestCount || 0) + 1
  });
  
  next();
};

/**
 * Sanitize device information to prevent XSS and injection attacks
 */
export const sanitizeDeviceInfo = (req, res, next) => {
  if (req.body.name) {
    // Remove HTML tags and dangerous characters
    req.body.name = req.body.name
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[<>'"&]/g, '') // Remove dangerous characters
      .trim();
  }
  
  if (req.body.platform) {
    req.body.platform = req.body.platform
      .replace(/<[^>]*>/g, '')
      .replace(/[<>'"&]/g, '')
      .trim();
  }
  
  if (req.body.userAgent) {
    req.body.userAgent = req.body.userAgent
      .replace(/<[^>]*>/g, '')
      .trim();
  }
  
  next();
};

/**
 * Validate that the authenticated user matches the sync context
 */
export const validateUserContext = (req, res, next) => {
  const userId = req.user?.id;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      errors: [{
        field: 'auth',
        message: 'Valid authentication token required for sync operations'
      }]
    });
  }
  
  // Add user ID to request for logging
  req.syncUserId = userId;
  next();
};

/**
 * Complete validation middleware chains for different sync endpoints
 */
export const syncValidationChains = {
  deviceRegister: [
    validateUserContext,
    ...deviceValidationRules.register,
    validateDeviceCapabilities,
    sanitizeDeviceInfo,
    handleValidation
  ],
  
  deviceActivity: [
    validateUserContext,
    ...deviceValidationRules.updateActivity,
    handleValidation
  ],
  
  syncTrigger: [
    validateUserContext,
    validateSyncFrequency,
    ...syncValidationRules.trigger,
    handleValidation
  ],
  
  pushSubscribe: [
    validateUserContext,
    ...pushNotificationValidationRules.subscribe,
    handleValidation
  ],
  
  pushTest: [
    validateUserContext,
    ...pushNotificationValidationRules.testNotification,
    handleValidation
  ]
};