// routes/adminRoutes.js
import express from 'express';
import { param, body, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';
import scheduledTasksService from '../services/scheduledTasksService.js';
import logger from '../config/logger.js';

const router = express.Router();

// Apply auth middleware to all admin routes
router.use(authMiddleware);

// Additional admin authorization check (optional - implement based on your user model)
const requireAdminRole = (req, res, next) => {
    // Example: Check if user has admin role
    // Modify this based on your user model structure
    if (req.user.role !== 'admin' && process.env.NODE_ENV === 'production') {
        logger.warn('Non-admin user attempted to access admin endpoint', {
            userId: req.user.id,
            email: req.user.email,
            path: req.path
        });
        return next(new AppError('Admin access required', 403));
    }
    next();
};

// Apply admin role check if needed
if (process.env.REQUIRE_ADMIN_ROLE === 'true') {
    router.use(requireAdminRole);
}

// Validation middleware
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(err => err.msg);
        return next(new AppError(errorMessages.join(', '), 400));
    }
    next();
};

/**
 * @openapi
 * /admin/tasks:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get status of all scheduled tasks
 *     description: Returns the status, schedule, and configuration of all scheduled tasks.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Task status retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tasks:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       schedule:
 *                         type: string
 *                         example: "0 2 * * *"
 *                       description:
 *                         type: string
 *                         example: "Clean up orphaned image files"
 *                       enabled:
 *                         type: boolean
 *                       running:
 *                         type: boolean
 *                       lastRun:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         description: Admin access required
 */
router.get('/tasks', catchAsync(async (req, res) => {
    const tasks = scheduledTasksService.getTasksStatus();
    
    logger.info('Admin tasks status requested', {
        userId: req.user.id,
        taskCount: Object.keys(tasks).length
    });
    
    res.status(200).json({ tasks });
}));

/**
 * @openapi
 * /admin/tasks/{taskName}/run:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Manually trigger a scheduled task
 *     description: Immediately runs a specified scheduled task outside of its normal schedule.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskName
 *         required: true
 *         schema:
 *           type: string
 *           enum: [orphaned-image-cleanup, expired-token-cleanup, system-health-check]
 *         description: Name of the task to run
 *     responses:
 *       '200':
 *         description: Task executed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Task executed successfully"
 *                 taskName:
 *                   type: string
 *                 result:
 *                   type: object
 *                   description: Task-specific result data
 *       '400':
 *         description: Invalid task name
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         description: Admin access required
 *       '500':
 *         description: Task execution failed
 */
router.post('/tasks/:taskName/run', [
    param('taskName')
        .isIn(['orphaned-image-cleanup', 'expired-token-cleanup', 'system-health-check'])
        .withMessage('Invalid task name'),
    validate
], catchAsync(async (req, res) => {
    const { taskName } = req.params;
    
    logger.info('Manual task execution requested', {
        userId: req.user.id,
        taskName,
        userEmail: req.user.email
    });
    
    try {
        const result = await scheduledTasksService.runTaskNow(taskName);
        
        logger.info('Manual task execution completed', {
            userId: req.user.id,
            taskName,
            result: typeof result === 'object' ? JSON.stringify(result) : result
        });
        
        res.status(200).json({
            message: 'Task executed successfully',
            taskName,
            result,
            executedAt: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Manual task execution failed', {
            userId: req.user.id,
            taskName,
            error: error.message,
            stack: error.stack
        });
        
        throw new AppError(`Task execution failed: ${error.message}`, 500);
    }
}));

/**
 * @openapi
 * /admin/tasks/{taskName}/enable:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Enable a scheduled task
 *     description: Enables a disabled scheduled task to run on its normal schedule.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the task to enable
 *     responses:
 *       '200':
 *         description: Task enabled successfully
 *       '400':
 *         description: Invalid task name
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         description: Admin access required
 */
router.post('/tasks/:taskName/enable', [
    param('taskName').notEmpty().withMessage('Task name is required'),
    validate
], catchAsync(async (req, res) => {
    const { taskName } = req.params;
    
    logger.info('Task enable requested', {
        userId: req.user.id,
        taskName,
        userEmail: req.user.email
    });
    
    try {
        scheduledTasksService.enableTask(taskName);
        res.status(200).json({
            message: `Task '${taskName}' enabled successfully`,
            taskName,
            enabledAt: new Date().toISOString()
        });
    } catch (error) {
        throw new AppError(error.message, 400);
    }
}));

/**
 * @openapi
 * /admin/tasks/{taskName}/disable:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Disable a scheduled task
 *     description: Disables a scheduled task to prevent it from running on its normal schedule.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the task to disable
 *     responses:
 *       '200':
 *         description: Task disabled successfully
 *       '400':
 *         description: Invalid task name
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         description: Admin access required
 */
router.post('/tasks/:taskName/disable', [
    param('taskName').notEmpty().withMessage('Task name is required'),
    validate
], catchAsync(async (req, res) => {
    const { taskName } = req.params;
    
    logger.info('Task disable requested', {
        userId: req.user.id,
        taskName,
        userEmail: req.user.email
    });
    
    try {
        scheduledTasksService.disableTask(taskName);
        res.status(200).json({
            message: `Task '${taskName}' disabled successfully`,
            taskName,
            disabledAt: new Date().toISOString()
        });
    } catch (error) {
        throw new AppError(error.message, 400);
    }
}));

/**
 * @openapi
 * /admin/system/health:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get detailed system health information
 *     description: Returns comprehensive system health metrics including memory usage, database status, and uptime.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: System health information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 health:
 *                   type: object
 *                   properties:
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     memory:
 *                       type: object
 *                     uptime:
 *                       type: number
 *                     nodeVersion:
 *                       type: string
 *                     environment:
 *                       type: string
 *                     mongodb:
 *                       type: object
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         description: Admin access required
 */
router.get('/system/health', catchAsync(async (req, res) => {
    const health = await scheduledTasksService.runTaskNow('system-health-check');
    
    logger.info('System health check requested', {
        userId: req.user.id,
        userEmail: req.user.email
    });
    
    res.status(200).json({ health });
}));

/**
 * @openapi
 * /admin/validate-cron:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Validate cron schedule format
 *     description: Validates if a cron schedule string is in the correct format.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - schedule
 *             properties:
 *               schedule:
 *                 type: string
 *                 example: "0 2 * * *"
 *                 description: Cron schedule string to validate
 *     responses:
 *       '200':
 *         description: Cron schedule validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 schedule:
 *                   type: string
 *                 message:
 *                   type: string
 *       '400':
 *         description: Invalid request body
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         description: Admin access required
 */
router.post('/validate-cron', [
    body('schedule').notEmpty().withMessage('Schedule is required'),
    validate
], catchAsync(async (req, res) => {
    const { schedule } = req.body;
    
    try {
        const isValid = scheduledTasksService.constructor.validateCronSchedule(schedule);
        
        res.status(200).json({
            valid: isValid,
            schedule,
            message: isValid ? 'Valid cron schedule' : 'Invalid cron schedule format'
        });
    } catch (error) {
        res.status(200).json({
            valid: false,
            schedule,
            message: `Invalid cron schedule: ${error.message}`
        });
    }
}));

export default router;