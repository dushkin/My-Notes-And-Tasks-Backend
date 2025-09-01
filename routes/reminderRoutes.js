import express from "express";
import { body, param, validationResult } from 'express-validator';
import Reminder from "../models/Reminder.js";
import Task from "../models/Task.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import logger from '../config/logger.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msgs = errors.array().map(err => err.msg);
    logger.warn('Validation error in reminderRoutes', {
      errors: msgs,
      path: req.path,
      ip: req.ip,
      userId: req.user?.id,
    });
    return next(new AppError(msgs.join(', '), 400));
  }
  next();
};

// Get all reminders for the authenticated user
router.get('/', catchAsync(async (req, res) => {
  const { activeOnly = 'true' } = req.query;
  const reminders = await Reminder.findUserReminders(
    req.user.id, 
    activeOnly === 'true'
  );
  
  res.json({
    success: true,
    reminders: reminders.map(reminder => ({
      itemId: reminder.itemId,
      itemTitle: reminder.itemTitle,
      timestamp: reminder.timestamp,
      repeatOptions: reminder.repeatOptions,
      snoozedUntil: reminder.snoozedUntil,
      enabled: reminder.enabled,
      deviceId: reminder.deviceId,
      lastTriggered: reminder.lastTriggered,
      triggerCount: reminder.triggerCount,
      createdAt: reminder.createdAt,
      updatedAt: reminder.updatedAt
    }))
  });
}));

// Get reminders that are currently due
router.get('/due', catchAsync(async (req, res) => {
  const dueReminders = await Reminder.findDueReminders(req.user.id);
  
  res.json({
    success: true,
    reminders: dueReminders.map(reminder => ({
      itemId: reminder.itemId,
      itemTitle: reminder.itemTitle,
      timestamp: reminder.timestamp,
      repeatOptions: reminder.repeatOptions,
      snoozedUntil: reminder.snoozedUntil,
      enabled: reminder.enabled,
      deviceId: reminder.deviceId,
      lastTriggered: reminder.lastTriggered,
      triggerCount: reminder.triggerCount
    }))
  });
}));

// Set or update reminder for any item
router.put('/:itemId', [
  param('itemId').isString().withMessage('Item ID must be a string.'),
  body('timestamp').isISO8601().withMessage('Timestamp must be a valid ISO date.'),
  body('itemTitle').isString().withMessage('Item title must be a string.'),
  body('repeatOptions').optional().isObject().withMessage('Repeat options must be an object.'),
  body('deviceId').optional().isString().withMessage('Device ID must be a string.'),
  validate,
], catchAsync(async (req, res) => {
  const { itemId } = req.params;
  const { 
    timestamp, 
    itemTitle, 
    repeatOptions = null,
    deviceId = null
  } = req.body;

  // Validate timestamp is in the future
  if (new Date(timestamp) <= new Date()) {
    return res.status(400).json({
      success: false,
      error: 'Reminder timestamp must be in the future'
    });
  }

  // Find existing reminder or create new one
  let reminder = await Reminder.findByUserAndItem(req.user.id, itemId);
  
  if (reminder) {
    // Update existing reminder
    reminder.timestamp = new Date(timestamp);
    reminder.itemTitle = itemTitle;
    reminder.repeatOptions = repeatOptions;
    reminder.snoozedUntil = null; // Clear any existing snooze
    reminder.enabled = true;
    reminder.deviceId = deviceId;
    await reminder.save();
  } else {
    // Create new reminder
    reminder = new Reminder({
      userId: req.user.id,
      itemId,
      itemTitle,
      timestamp: new Date(timestamp),
      repeatOptions,
      deviceId,
      enabled: true
    });
    await reminder.save();
  }

  logger.info('Reminder set', {
    userId: req.user.id,
    itemId,
    timestamp,
    hasRepeat: !!repeatOptions
  });

  res.json({
    success: true,
    reminder: {
      itemId: reminder.itemId,
      itemTitle: reminder.itemTitle,
      timestamp: reminder.timestamp,
      repeatOptions: reminder.repeatOptions,
      enabled: reminder.enabled,
      deviceId: reminder.deviceId
    }
  });

  // Emit socket event for real-time sync
  if (req.io) {
    req.io.to(req.user.id).emit('reminder:set', {
      itemId: reminder.itemId,
      itemTitle: reminder.itemTitle,
      timestamp: reminder.timestamp,
      repeatOptions: reminder.repeatOptions
    });
  }
}));

// Get specific reminder
router.get('/:itemId', [
  param('itemId').isString().withMessage('Item ID must be a string.'),
  validate,
], catchAsync(async (req, res) => {
  const { itemId } = req.params;
  
  const reminder = await Reminder.findByUserAndItem(req.user.id, itemId);
  
  if (!reminder) {
    return res.status(404).json({
      success: false,
      error: 'Reminder not found'
    });
  }

  res.json({
    success: true,
    reminder: {
      itemId: reminder.itemId,
      itemTitle: reminder.itemTitle,
      timestamp: reminder.timestamp,
      repeatOptions: reminder.repeatOptions,
      snoozedUntil: reminder.snoozedUntil,
      enabled: reminder.enabled,
      deviceId: reminder.deviceId,
      lastTriggered: reminder.lastTriggered,
      triggerCount: reminder.triggerCount,
      createdAt: reminder.createdAt,
      updatedAt: reminder.updatedAt
    }
  });
}));

// Snooze a reminder
router.post('/:itemId/snooze', [
  param('itemId').isString().withMessage('Item ID must be a string.'),
  body('minutes').isInt({ min: 1, max: 10080 }).withMessage('Minutes must be between 1 and 10080 (1 week).'),
  validate,
], catchAsync(async (req, res) => {
  const { itemId } = req.params;
  const { minutes } = req.body;
  
  const reminder = await Reminder.findByUserAndItem(req.user.id, itemId);
  
  if (!reminder) {
    return res.status(404).json({
      success: false,
      error: 'Reminder not found'
    });
  }

  await reminder.snooze(minutes);

  logger.info('Reminder snoozed', {
    userId: req.user.id,
    itemId,
    minutes,
    snoozedUntil: reminder.snoozedUntil
  });

  res.json({
    success: true,
    reminder: {
      itemId: reminder.itemId,
      snoozedUntil: reminder.snoozedUntil,
      timestamp: reminder.timestamp
    }
  });

  // Emit socket event for real-time sync
  if (req.io) {
    req.io.to(req.user.id).emit('reminder:update', {
      itemId: reminder.itemId,
      snoozedUntil: reminder.snoozedUntil,
      timestamp: reminder.timestamp
    });
  }
}));

// Mark reminder as triggered (used by notification system)
router.post('/:itemId/trigger', [
  param('itemId').isString().withMessage('Item ID must be a string.'),
  validate,
], catchAsync(async (req, res) => {
  const { itemId } = req.params;
  
  const reminder = await Reminder.findByUserAndItem(req.user.id, itemId);
  
  if (!reminder) {
    return res.status(404).json({
      success: false,
      error: 'Reminder not found'
    });
  }

  await reminder.markTriggered();

  logger.info('Reminder triggered', {
    userId: req.user.id,
    itemId,
    triggerCount: reminder.triggerCount,
    nextOccurrence: reminder.enabled ? reminder.timestamp : null
  });

  res.json({
    success: true,
    reminder: {
      itemId: reminder.itemId,
      enabled: reminder.enabled,
      timestamp: reminder.timestamp,
      triggerCount: reminder.triggerCount,
      lastTriggered: reminder.lastTriggered
    }
  });

  // Emit socket event for real-time sync
  if (req.io) {
    req.io.to(req.user.id).emit('reminder:triggered', {
      itemId: reminder.itemId,
      enabled: reminder.enabled,
      timestamp: reminder.timestamp
    });
  }
}));

// Clear/delete a reminder
router.delete('/:itemId', [
  param('itemId').isString().withMessage('Item ID must be a string.'),
  validate,
], catchAsync(async (req, res) => {
  const { itemId } = req.params;
  
  const result = await Reminder.deleteByUserAndItem(req.user.id, itemId);
  
  if (result.deletedCount === 0) {
    return res.status(404).json({
      success: false,
      error: 'Reminder not found'
    });
  }

  logger.info('Reminder deleted', {
    userId: req.user.id,
    itemId
  });

  res.json({
    success: true,
    message: 'Reminder deleted successfully'
  });

  // Emit socket event for real-time sync
  if (req.io) {
    req.io.to(req.user.id).emit('reminder:clear', { itemId });
  }
}));

// Bulk import reminders (for migration from localStorage)
router.post('/bulk-import', [
  body('reminders').isArray().withMessage('Reminders must be an array.'),
  body('reminders.*.itemId').isString().withMessage('Each reminder must have an itemId.'),
  body('reminders.*.timestamp').isISO8601().withMessage('Each reminder must have a valid timestamp.'),
  body('reminders.*.itemTitle').isString().withMessage('Each reminder must have an itemTitle.'),
  validate,
], catchAsync(async (req, res) => {
  const { reminders } = req.body;
  
  const importResults = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };

  for (const reminderData of reminders) {
    try {
      const { itemId, timestamp, itemTitle, repeatOptions = null } = reminderData;
      
      // Skip reminders in the past
      if (new Date(timestamp) <= new Date()) {
        importResults.skipped++;
        continue;
      }

      // Check if reminder already exists
      let reminder = await Reminder.findByUserAndItem(req.user.id, itemId);
      
      if (reminder) {
        // Update existing reminder
        reminder.timestamp = new Date(timestamp);
        reminder.itemTitle = itemTitle;
        reminder.repeatOptions = repeatOptions;
        reminder.enabled = true;
        await reminder.save();
        importResults.updated++;
      } else {
        // Create new reminder
        reminder = new Reminder({
          userId: req.user.id,
          itemId,
          itemTitle,
          timestamp: new Date(timestamp),
          repeatOptions,
          enabled: true
        });
        await reminder.save();
        importResults.created++;
      }
    } catch (error) {
      importResults.errors.push({
        itemId: reminderData.itemId,
        error: error.message
      });
    }
  }

  logger.info('Bulk reminder import completed', {
    userId: req.user.id,
    ...importResults
  });

  res.json({
    success: true,
    results: importResults
  });

  // Emit socket event to refresh reminders on all devices
  if (req.io) {
    req.io.to(req.user.id).emit('reminders:bulk_updated');
  }
}));

// LEGACY ROUTES: Maintain compatibility with existing task-based reminder system
// Set or update reminder for a task (legacy)
router.patch("/:taskId/reminder", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { dateTime, repeat, snoozedUntil, enabled } = req.body;

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        reminder: { dateTime, repeat, snoozedUntil, enabled },
      },
      { new: true }
    );

    if (!updatedTask) return res.status(404).send("Task not found");
    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear reminder (legacy)
router.delete("/:taskId/reminder", async (req, res) => {
  try {
    const { taskId } = req.params;

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      { $unset: { reminder: "" } },
      { new: true }
    );

    if (!updatedTask) return res.status(404).send("Task not found");
    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;