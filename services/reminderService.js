import logger from '../config/logger.js';

/**
 * Calculates the next occurrence time for a repeating reminder.
 */
function calculateNextReminderTime(currentTime, repeatOptions) {
    if (!repeatOptions || !repeatOptions.unit || !repeatOptions.interval) {
        return null;
    }

    const lastTime = new Date(currentTime);
    let nextTime = new Date(lastTime.getTime());
    const interval = parseInt(repeatOptions.interval, 10) || 0;

    if (interval <= 0) return null;

    switch (repeatOptions.unit) {
        case 'seconds': nextTime.setSeconds(nextTime.getSeconds() + interval); break;
        case 'minutes': nextTime.setMinutes(nextTime.getMinutes() + interval); break;
        case 'hours': nextTime.setHours(nextTime.getHours() + interval); break;
        case 'days': nextTime.setDate(nextTime.getDate() + interval); break;
        case 'weeks': nextTime.setDate(nextTime.getDate() + interval * 7); break;
        case 'months': nextTime.setMonth(nextTime.getMonth() + interval); break;
        case 'years': nextTime.setFullYear(nextTime.getFullYear() + interval); break;
        default: return null;
    }

    return nextTime;
}

/**
 * Minimal ReminderService class
 */
class ReminderService {
    constructor() {
        this.isRunning = false;
        this.isProcessing = false;
        this.cronJob = null;
    }

    init() {
        if (process.env.NODE_ENV === 'test') {
            logger.info('Test environment detected. Skipping reminder service initialization.');
            return;
        }

        // Import cron dynamically to catch import errors
        this.initializeCron().catch(error => {
            logger.error('Failed to initialize cron:', { error: error.message });
            // Service will work without cron (manual mode only)
        });
    }

    async initializeCron() {
        try {
            const cron = await import('node-cron');
            const schedule = process.env.REMINDER_CHECK_SCHEDULE || '* * * * *';
            
            this.cronJob = cron.default.schedule(schedule, () => {
                if (!this.isProcessing) {
                    this.checkAndSendReminders().catch(error => {
                        logger.error('Error in reminder check:', { error: error.message });
                    });
                }
            }, {
                scheduled: false,
                timezone: process.env.CRON_TIMEZONE || 'UTC'
            });

            this.start();
            logger.info('Reminder service initialized', { schedule });
        } catch (error) {
            logger.error('Failed to initialize cron job:', { error: error.message });
        }
    }

    start() {
        if (this.cronJob && !this.isRunning) {
            this.cronJob.start();
            this.isRunning = true;
            logger.info('Reminder service started');
        } else {
            logger.info('Reminder service: cron not available, running in manual mode');
        }
    }

    stop() {
        if (this.cronJob && this.isRunning) {
            this.cronJob.stop();
            this.isRunning = false;
            logger.info('Reminder service stopped');
        }
    }

    async shutdown() {
        this.stop();
        if (this.cronJob) {
            this.cronJob.destroy();
        }
        logger.info('Reminder service shutdown completed');
    }

    findDueReminders(notesTree, currentTime) {
        const due = [];
        
        const findRecursive = (nodes) => {
            if (!Array.isArray(nodes)) return;
            
            for (const item of nodes) {
                if (!item) continue;
                
                if (item.type === 'task' && item.reminder?.timestamp) {
                    const reminderTime = new Date(item.reminder.timestamp).getTime();
                    if (reminderTime <= currentTime) {
                        due.push({ ...item });
                    }
                }
                
                if (item.type === 'folder' && Array.isArray(item.children)) {
                    findRecursive(item.children);
                }
            }
        };
        
        findRecursive(notesTree);
        return due;
    }

    async checkAndSendReminders() {
        this.isProcessing = true;
        const now = Date.now();
        
        try {
            // Import dependencies dynamically
            const User = (await import('../models/User.js')).default;
            
            const usersWithReminders = await User.find({ 
                'notesTree.reminder.timestamp': { $lte: now },
                isVerified: true
            }).select('_id email notesTree');

            if (usersWithReminders.length === 0) {
                logger.debug('No users with due reminders found.');
                return;
            }

            for (const user of usersWithReminders) {
                await this.processUserReminders(user, now);
            }

        } catch (error) {
            logger.error('Error during reminder check:', { error: error.message });
        } finally {
            this.isProcessing = false;
        }
    }

    async processUserReminders(user, now) {
        const dueReminders = this.findDueReminders(user.notesTree, now);
        if (dueReminders.length === 0) return;

        logger.info(`Found ${dueReminders.length} due reminder(s) for user`, { userId: user._id });

        let treeWasModified = false;
        let currentTree = user.notesTree;

        for (const item of dueReminders) {
            try {
                // Import dependencies dynamically
                const { sendReminderNotification } = await import('../controllers/pushNotificationController.js');
                const { emitToUser } = await import('../socket/socketController.js');
                const { updateItemInTree } = await import('../utils/backendTreeUtils.js');

                // Send notifications
                await sendReminderNotification(user._id, item.label, item.id, item.reminder.timestamp);
                emitToUser(user._id.toString(), 'reminderTriggered', { 
                    itemId: item.id, 
                    reminderTime: new Date(),
                    itemLabel: item.label
                });

                // Handle repeating reminders
                let nextReminder = null;
                if (item.reminder.repeatOptions) {
                    const nextTime = calculateNextReminderTime(item.reminder.timestamp, item.reminder.repeatOptions);
                    if (nextTime) {
                        nextReminder = { ...item.reminder, timestamp: nextTime.getTime() };
                    }
                }
                
                currentTree = updateItemInTree(currentTree, item.id, { reminder: nextReminder });
                treeWasModified = true;

            } catch (reminderError) {
                logger.error('Error processing individual reminder:', {
                    userId: user._id,
                    itemId: item.id,
                    error: reminderError.message
                });
            }
        }

        if (treeWasModified) {
            user.notesTree = currentTree;
            user.markModified('notesTree');
            await user.save();
            logger.info('Updated reminders in user tree', { userId: user._id });
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            isProcessing: this.isProcessing,
            cronJobExists: !!this.cronJob
        };
    }
}

// Create singleton
const reminderService = new ReminderService();

// Export functions
export async function emitReminderSet(userId, reminder) {
    try {
        const { emitToUser } = await import('../socket/socketController.js');
        emitToUser(userId, "reminder_set", reminder);
    } catch (error) {
        logger.error('Error emitting reminder set:', { error: error.message });
    }
}

export default reminderService;
export { calculateNextReminderTime };