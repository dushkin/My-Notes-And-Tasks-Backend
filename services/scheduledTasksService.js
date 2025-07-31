import cron from 'node-cron';
import logger from '../config/logger.js';

class ScheduledTasksService {
    constructor() {
        this.tasks = new Map();
        this.isInitialized = false;
        this.isShuttingDown = false;
    }

    /**
     * Initialize scheduled tasks
     */
    init() {
        if (this.isInitialized) {
            logger.warn('Scheduled tasks service already initialized');
            return;
        }

        try {
            logger.info('Initializing scheduled tasks service...');
            
            // Check if scheduled tasks are enabled
            const enableScheduledTasks = process.env.ENABLE_SCHEDULED_TASKS !== 'false';
            if (!enableScheduledTasks) {
                logger.info('Scheduled tasks disabled via ENABLE_SCHEDULED_TASKS environment variable');
                return;
            }

            // Initialize cleanup tasks
            this.initializeCleanupTasks();
            
            // Initialize maintenance tasks
            this.initializeMaintenanceTasks();
            
            this.isInitialized = true;
            logger.info('Scheduled tasks service initialized successfully');
            
        } catch (error) {
            logger.error('Failed to initialize scheduled tasks service:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Initialize cleanup tasks
     */
    initializeCleanupTasks() {
        try {
            // Orphaned image cleanup - runs daily at 2 AM
            const orphanedImageSchedule = process.env.ORPHANED_IMAGE_CLEANUP_SCHEDULE || '0 2 * * *';
            const orphanedImageTask = cron.schedule(orphanedImageSchedule, async () => {
                if (this.isShuttingDown) return;
                
                try {
                    logger.info('Starting orphaned image cleanup task');
                    await this.cleanupOrphanedImages();
                    logger.info('Orphaned image cleanup task completed');
                } catch (error) {
                    logger.error('Orphaned image cleanup task failed:', {
                        error: error.message,
                        stack: error.stack
                    });
                }
            }, {
                scheduled: false,
                timezone: process.env.CRON_TIMEZONE || 'UTC'
            });

            this.tasks.set('orphanedImageCleanup', orphanedImageTask);
            orphanedImageTask.start();
            logger.info('Orphaned image cleanup task scheduled', { schedule: orphanedImageSchedule });

            // Expired token cleanup - runs every 6 hours
            const expiredTokenSchedule = process.env.EXPIRED_TOKEN_CLEANUP_SCHEDULE || '0 */6 * * *';
            const expiredTokenTask = cron.schedule(expiredTokenSchedule, async () => {
                if (this.isShuttingDown) return;
                
                try {
                    logger.info('Starting expired token cleanup task');
                    await this.cleanupExpiredTokens();
                    logger.info('Expired token cleanup task completed');
                } catch (error) {
                    logger.error('Expired token cleanup task failed:', {
                        error: error.message,
                        stack: error.stack
                    });
                }
            }, {
                scheduled: false,
                timezone: process.env.CRON_TIMEZONE || 'UTC'
            });

            this.tasks.set('expiredTokenCleanup', expiredTokenTask);
            expiredTokenTask.start();
            logger.info('Expired token cleanup task scheduled', { schedule: expiredTokenSchedule });

        } catch (error) {
            logger.error('Failed to initialize cleanup tasks:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Initialize maintenance tasks
     */
    initializeMaintenanceTasks() {
        try {
            // Database maintenance - runs weekly on Sundays at 3 AM
            const dbMaintenanceSchedule = process.env.DB_MAINTENANCE_SCHEDULE || '0 3 * * 0';
            const dbMaintenanceTask = cron.schedule(dbMaintenanceSchedule, async () => {
                if (this.isShuttingDown) return;
                
                try {
                    logger.info('Starting database maintenance task');
                    await this.performDatabaseMaintenance();
                    logger.info('Database maintenance task completed');
                } catch (error) {
                    logger.error('Database maintenance task failed:', {
                        error: error.message,
                        stack: error.stack
                    });
                }
            }, {
                scheduled: false,
                timezone: process.env.CRON_TIMEZONE || 'UTC'
            });

            this.tasks.set('databaseMaintenance', dbMaintenanceTask);
            dbMaintenanceTask.start();
            logger.info('Database maintenance task scheduled', { schedule: dbMaintenanceSchedule });

            // User activity cleanup - runs daily at 4 AM
            const userActivitySchedule = process.env.USER_ACTIVITY_CLEANUP_SCHEDULE || '0 4 * * *';
            const userActivityTask = cron.schedule(userActivitySchedule, async () => {
                if (this.isShuttingDown) return;
                
                try {
                    logger.info('Starting user activity cleanup task');
                    await this.cleanupUserActivity();
                    logger.info('User activity cleanup task completed');
                } catch (error) {
                    logger.error('User activity cleanup task failed:', {
                        error: error.message,
                        stack: error.stack
                    });
                }
            }, {
                scheduled: false,
                timezone: process.env.CRON_TIMEZONE || 'UTC'
            });

            this.tasks.set('userActivityCleanup', userActivityTask);
            userActivityTask.start();
            logger.info('User activity cleanup task scheduled', { schedule: userActivitySchedule });

        } catch (error) {
            logger.error('Failed to initialize maintenance tasks:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Clean up orphaned images
     */
    async cleanupOrphanedImages() {
        try {
            logger.info('Executing orphaned image cleanup...');
            
            // Import file system utilities
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('url');
            
            // Get upload directory path
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const uploadsDir = path.join(__dirname, '..', 'public', 'Uploads');
            
            if (!fs.existsSync(uploadsDir)) {
                logger.warn('Uploads directory does not exist, skipping image cleanup');
                return;
            }

            // Get all files in uploads directory
            const files = fs.readdirSync(uploadsDir);
            let deletedCount = 0;
            let checkedCount = 0;

            // Import User model to check for referenced images
            const User = (await import('../models/User.js')).default;

            for (const file of files) {
                try {
                    checkedCount++;
                    const filePath = path.join(uploadsDir, file);
                    const fileStat = fs.statSync(filePath);
                    
                    // Skip if file was modified in the last 24 hours (might be newly uploaded)
                    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    if (fileStat.mtime > twentyFourHoursAgo) {
                        continue;
                    }

                    // Check if file is referenced in any user's notesTree
                    const fileUrl = `/uploads/${file}`;
                    const usersWithFile = await User.countDocuments({
                        $or: [
                            { notesTree: { $regex: fileUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
                            { profilePicture: fileUrl }
                        ]
                    });

                    if (usersWithFile === 0) {
                        // File is orphaned, delete it
                        fs.unlinkSync(filePath);
                        deletedCount++;
                        logger.debug('Deleted orphaned image:', { file, filePath });
                    }
                } catch (fileError) {
                    logger.warn('Error processing file during cleanup:', {
                        file,
                        error: fileError.message
                    });
                }
            }

            logger.info('Orphaned image cleanup completed', {
                checkedCount,
                deletedCount,
                keptCount: checkedCount - deletedCount
            });

        } catch (error) {
            logger.error('Orphaned image cleanup failed:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Clean up expired tokens
     */
    async cleanupExpiredTokens() {
        try {
            logger.info('Executing expired token cleanup...');
            
            // This would typically involve cleaning up refresh tokens, 
            // password reset tokens, email verification tokens, etc.
            // Since your User model doesn't have these fields visible,
            // this is a placeholder implementation
            
            const User = (await import('../models/User.js')).default;
            
            // Clean up any expired password reset tokens
            const result = await User.updateMany(
                {
                    $or: [
                        { passwordResetExpires: { $lt: new Date() } },
                        { emailVerificationExpires: { $lt: new Date() } }
                    ]
                },
                {
                    $unset: {
                        passwordResetToken: 1,
                        passwordResetExpires: 1,
                        emailVerificationToken: 1,
                        emailVerificationExpires: 1
                    }
                }
            );

            logger.info('Expired token cleanup completed', {
                modifiedCount: result.modifiedCount
            });

        } catch (error) {
            logger.error('Expired token cleanup failed:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Perform database maintenance
     */
    async performDatabaseMaintenance() {
        try {
            logger.info('Executing database maintenance...');
            
            const mongoose = (await import('mongoose')).default;
            
            // Get database statistics
            const db = mongoose.connection.db;
            const stats = await db.stats();
            
            logger.info('Database statistics:', {
                collections: stats.collections,
                objects: stats.objects,
                dataSize: `${Math.round(stats.dataSize / 1024 / 1024 * 100) / 100} MB`,
                storageSize: `${Math.round(stats.storageSize / 1024 / 1024 * 100) / 100} MB`,
                indexes: stats.indexes,
                indexSize: `${Math.round(stats.indexSize / 1024 / 1024 * 100) / 100} MB`
            });

            // Perform any additional maintenance tasks here
            // Such as optimizing indexes, cleaning up old sessions, etc.
            
            logger.info('Database maintenance completed successfully');

        } catch (error) {
            logger.error('Database maintenance failed:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Clean up old user activity
     */
    async cleanupUserActivity() {
        try {
            logger.info('Executing user activity cleanup...');
            
            const User = (await import('../models/User.js')).default;
            
            // Clean up inactive push subscriptions (older than 30 days)
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            
            const result = await User.updateMany(
                {},
                {
                    $pull: {
                        pushSubscriptions: {
                            lastUsed: { $lt: thirtyDaysAgo }
                        }
                    }
                }
            );

            logger.info('User activity cleanup completed', {
                modifiedUsers: result.modifiedCount
            });

        } catch (error) {
            logger.error('User activity cleanup failed:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Add a custom scheduled task
     */
    addTask(name, schedule, taskFunction, options = {}) {
        if (this.tasks.has(name)) {
            logger.warn(`Task ${name} already exists, skipping`);
            return;
        }

        try {
            const task = cron.schedule(schedule, async () => {
                if (this.isShuttingDown) return;
                
                try {
                    logger.info(`Starting custom task: ${name}`);
                    await taskFunction();
                    logger.info(`Custom task completed: ${name}`);
                } catch (error) {
                    logger.error(`Custom task failed: ${name}`, {
                        error: error.message,
                        stack: error.stack
                    });
                }
            }, {
                scheduled: false,
                timezone: process.env.CRON_TIMEZONE || 'UTC',
                ...options
            });

            this.tasks.set(name, task);
            task.start();
            logger.info(`Custom task scheduled: ${name}`, { schedule });

        } catch (error) {
            logger.error(`Failed to add custom task: ${name}`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Remove a scheduled task
     */
    removeTask(name) {
        const task = this.tasks.get(name);
        if (task) {
            task.stop();
            task.destroy();
            this.tasks.delete(name);
            logger.info(`Task removed: ${name}`);
        }
    }

    /**
     * Get status of all tasks
     */
    getTaskStatus() {
        const status = {
            initialized: this.isInitialized,
            taskCount: this.tasks.size,
            tasks: []
        };

        for (const [name, task] of this.tasks.entries()) {
            status.tasks.push({
                name,
                running: task.getStatus() === 'scheduled'
            });
        }

        return status;
    }

    /**
     * Shutdown all scheduled tasks
     */
    async shutdown() {
        logger.info('Shutting down scheduled tasks service...');
        this.isShuttingDown = true;

        try {
            // Stop and destroy all tasks
            for (const [name, task] of this.tasks.entries()) {
                try {
                    task.stop();
                    task.destroy();
                    logger.debug(`Task stopped: ${name}`);
                } catch (error) {
                    logger.error(`Error stopping task: ${name}`, {
                        error: error.message
                    });
                }
            }

            this.tasks.clear();
            this.isInitialized = false;
            logger.info('Scheduled tasks service shut down successfully');

        } catch (error) {
            logger.error('Error during scheduled tasks shutdown:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
}

// Create and export singleton instance
const scheduledTasksService = new ScheduledTasksService();
export default scheduledTasksService;

// Hook into scheduled reminders - example logic
async function processDueReminders(items) {
  for (const item of items) {
    if (item.reminder && !item.reminder.disabled && new Date(item.reminder.timestamp).getTime() <= Date.now()) {
      await sendReminderToDevice(item);
    }
  }
}
