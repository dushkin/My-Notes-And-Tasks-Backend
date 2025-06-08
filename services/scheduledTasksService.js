// services/scheduledTasksService.js
import cron from 'node-cron';
import { cleanupOrphanedImages } from './orphanedFileCleanupService.js';
import { cleanupExpiredTokens } from '../utils/jwt.js';
import logger from '../config/logger.js';

class ScheduledTasksService {
    constructor() {
        this.tasks = new Map();
        this.isShuttingDown = false;
    }

    /**
     * Initialize and start all scheduled tasks
     */
    init() {
        logger.info('Initializing scheduled tasks service...');
        
        try {
            this.scheduleOrphanedImageCleanup();
            this.scheduleExpiredTokenCleanup();
            this.scheduleHealthChecks();
            
            logger.info('All scheduled tasks initialized successfully', {
                activeTasks: this.tasks.size,
                taskNames: Array.from(this.tasks.keys())
            });
        } catch (error) {
            logger.error('Failed to initialize scheduled tasks', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Schedule orphaned image cleanup
     * Runs daily at 2:00 AM to clean up unused image files
     */
    scheduleOrphanedImageCleanup() {
        const taskName = 'orphaned-image-cleanup';
        const schedule = process.env.ORPHANED_IMAGE_CLEANUP_SCHEDULE || '0 2 * * *'; // Daily at 2 AM
        
        const task = cron.schedule(schedule, async () => {
            if (this.isShuttingDown) return;
            
            const jobId = `${taskName}-${Date.now()}`;
            logger.info(`Starting scheduled task: ${taskName}`, { jobId, schedule });
            
            try {
                await cleanupOrphanedImages();
                logger.info(`Completed scheduled task: ${taskName}`, { jobId });
            } catch (error) {
                logger.error(`Failed scheduled task: ${taskName}`, {
                    jobId,
                    error: error.message,
                    stack: error.stack
                });
            }
        }, {
            scheduled: false, // Don't start immediately
            timezone: process.env.CRON_TIMEZONE || 'UTC'
        });

        this.tasks.set(taskName, {
            task,
            schedule,
            description: 'Clean up orphaned image files',
            lastRun: null,
            enabled: process.env.ENABLE_ORPHANED_IMAGE_CLEANUP !== 'false'
        });

        if (this.tasks.get(taskName).enabled) {
            task.start();
            logger.info(`Scheduled task started: ${taskName}`, { schedule });
        } else {
            logger.info(`Scheduled task disabled: ${taskName}`);
        }
    }

    /**
     * Schedule expired token cleanup
     * Runs every 6 hours to clean up expired refresh tokens
     */
    scheduleExpiredTokenCleanup() {
        const taskName = 'expired-token-cleanup';
        const schedule = process.env.EXPIRED_TOKEN_CLEANUP_SCHEDULE || '0 */6 * * *'; // Every 6 hours
        
        const task = cron.schedule(schedule, async () => {
            if (this.isShuttingDown) return;
            
            const jobId = `${taskName}-${Date.now()}`;
            logger.info(`Starting scheduled task: ${taskName}`, { jobId, schedule });
            
            try {
                const deletedCount = await cleanupExpiredTokens();
                logger.info(`Completed scheduled task: ${taskName}`, { 
                    jobId, 
                    deletedTokens: deletedCount 
                });
            } catch (error) {
                logger.error(`Failed scheduled task: ${taskName}`, {
                    jobId,
                    error: error.message,
                    stack: error.stack
                });
            }
        }, {
            scheduled: false,
            timezone: process.env.CRON_TIMEZONE || 'UTC'
        });

        this.tasks.set(taskName, {
            task,
            schedule,
            description: 'Clean up expired refresh tokens',
            lastRun: null,
            enabled: process.env.ENABLE_EXPIRED_TOKEN_CLEANUP !== 'false'
        });

        if (this.tasks.get(taskName).enabled) {
            task.start();
            logger.info(`Scheduled task started: ${taskName}`, { schedule });
        } else {
            logger.info(`Scheduled task disabled: ${taskName}`);
        }
    }

    /**
     * Schedule system health checks
     * Runs every hour to log system health metrics
     */
    scheduleHealthChecks() {
        const taskName = 'system-health-check';
        const schedule = process.env.HEALTH_CHECK_SCHEDULE || '0 * * * *'; // Every hour
        
        const task = cron.schedule(schedule, async () => {
            if (this.isShuttingDown) return;
            
            const jobId = `${taskName}-${Date.now()}`;
            
            try {
                const healthMetrics = await this.collectHealthMetrics();
                logger.info(`System health check completed`, { 
                    jobId, 
                    ...healthMetrics 
                });
            } catch (error) {
                logger.error(`Failed scheduled task: ${taskName}`, {
                    jobId,
                    error: error.message,
                    stack: error.stack
                });
            }
        }, {
            scheduled: false,
            timezone: process.env.CRON_TIMEZONE || 'UTC'
        });

        this.tasks.set(taskName, {
            task,
            schedule,
            description: 'System health monitoring',
            lastRun: null,
            enabled: process.env.ENABLE_HEALTH_CHECKS !== 'false'
        });

        if (this.tasks.get(taskName).enabled) {
            task.start();
            logger.info(`Scheduled task started: ${taskName}`, { schedule });
        } else {
            logger.info(`Scheduled task disabled: ${taskName}`);
        }
    }

    /**
     * Collect system health metrics
     */
    async collectHealthMetrics() {
        const metrics = {
            timestamp: new Date().toISOString(),
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            nodeVersion: process.version,
            environment: process.env.NODE_ENV
        };

        // Add MongoDB connection status if available
        try {
            const mongoose = await import('mongoose');
            metrics.mongodb = {
                readyState: mongoose.connection.readyState,
                name: mongoose.connection.name,
                host: mongoose.connection.host,
                port: mongoose.connection.port
            };
        } catch (error) {
            metrics.mongodb = { error: 'MongoDB status unavailable' };
        }

        return metrics;
    }

    /**
     * Run a specific task manually (useful for testing or admin endpoints)
     */
    async runTaskNow(taskName) {
        const taskInfo = this.tasks.get(taskName);
        if (!taskInfo) {
            throw new Error(`Task '${taskName}' not found`);
        }

        logger.info(`Manually triggering task: ${taskName}`);
        
        switch (taskName) {
            case 'orphaned-image-cleanup':
                return await cleanupOrphanedImages();
            case 'expired-token-cleanup':
                return await cleanupExpiredTokens();
            case 'system-health-check':
                return await this.collectHealthMetrics();
            default:
                throw new Error(`Task '${taskName}' cannot be run manually`);
        }
    }

    /**
     * Get status of all scheduled tasks
     */
    getTasksStatus() {
        const status = {};
        
        for (const [name, info] of this.tasks.entries()) {
            status[name] = {
                schedule: info.schedule,
                description: info.description,
                enabled: info.enabled,
                running: info.task.running,
                lastRun: info.lastRun
            };
        }
        
        return status;
    }

    /**
     * Enable a specific task
     */
    enableTask(taskName) {
        const taskInfo = this.tasks.get(taskName);
        if (!taskInfo) {
            throw new Error(`Task '${taskName}' not found`);
        }

        if (!taskInfo.enabled) {
            taskInfo.task.start();
            taskInfo.enabled = true;
            logger.info(`Enabled scheduled task: ${taskName}`);
        }
    }

    /**
     * Disable a specific task
     */
    disableTask(taskName) {
        const taskInfo = this.tasks.get(taskName);
        if (!taskInfo) {
            throw new Error(`Task '${taskName}' not found`);
        }

        if (taskInfo.enabled) {
            taskInfo.task.stop();
            taskInfo.enabled = false;
            logger.info(`Disabled scheduled task: ${taskName}`);
        }
    }

    /**
     * Gracefully shutdown all scheduled tasks
     */
    async shutdown() {
        this.isShuttingDown = true;
        logger.info('Shutting down scheduled tasks service...');
        
        const shutdownPromises = [];
        
        for (const [name, info] of this.tasks.entries()) {
            if (info.task.running) {
                logger.info(`Stopping scheduled task: ${name}`);
                info.task.stop();
            }
        }

        // Wait a moment for any running tasks to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        this.tasks.clear();
        logger.info('Scheduled tasks service shutdown complete');
    }

    /**
     * Validate cron schedule format
     */
    static validateCronSchedule(schedule) {
        return cron.validate(schedule);
    }
}

// Create singleton instance
const scheduledTasksService = new ScheduledTasksService();

export default scheduledTasksService;