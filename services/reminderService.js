import logger from '../config/logger.js';

/**
 * Calculates the next occurrence time for a repeating reminder.
 */
function calculateNextReminderTime(currentTime, repeatOptions) {
    if (!repeatOptions || !repeatOptions.type || !repeatOptions.interval) {
        return null;
    }

    const lastTime = new Date(currentTime);
    let nextTime = new Date(lastTime.getTime());
    const interval = parseInt(repeatOptions.interval, 10) || 0;

    if (interval <= 0) return null;

    switch (repeatOptions.type) {
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
        this.lastCheckTime = null;
        this.checkCount = 0;
        this.processedCount = 0;
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
            // Default: check every 10 seconds for second-level precision
            // For even more precision, set REMINDER_CHECK_SCHEDULE='*/5 * * * * *' (5 seconds)
            // or REMINDER_CHECK_SCHEDULE='* * * * * *' (1 second) - NOT recommended for production
            const schedule = process.env.REMINDER_CHECK_SCHEDULE || '*/10 * * * * *';
            
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
        const now = new Date();
        this.checkCount++;
        this.lastCheckTime = now;
        
        try {
            // Import dependencies dynamically
            const Reminder = (await import('../models/Reminder.js')).default;
            const User = (await import('../models/User.js')).default;
            
            // Optimized query: only check reminders due within the last 30 seconds
            // This prevents processing the same reminder multiple times
            const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
            const dueReminders = await Reminder.find({
                enabled: true,
                $or: [
                    { 
                        snoozedUntil: null, 
                        timestamp: { $lte: now, $gte: thirtySecondsAgo } 
                    },
                    { 
                        snoozedUntil: { $lte: now, $gte: thirtySecondsAgo } 
                    }
                ]
            }).sort({ timestamp: 1 });
            
            if (dueReminders.length === 0) {
                if (this.checkCount % 60 === 0) { // Log every 10 minutes (60 * 10sec)
                    logger.debug(`No due reminders found (checked ${this.checkCount} times, processed ${this.processedCount} reminders)`);
                }
                return;
            }

            logger.info(`Processing ${dueReminders.length} due reminders (check #${this.checkCount})`);
            this.processedCount += dueReminders.length;

            // Group reminders by user for batch processing
            const remindersByUser = new Map();
            for (const reminder of dueReminders) {
                if (!remindersByUser.has(reminder.userId.toString())) {
                    remindersByUser.set(reminder.userId.toString(), []);
                }
                remindersByUser.get(reminder.userId.toString()).push(reminder);
            }

            // Process each user's reminders
            for (const [userId, userReminders] of remindersByUser) {
                await this.processUserCloudReminders(userId, userReminders);
            }

            // Also check old notesTree-based reminders for backward compatibility
            // But only check this less frequently to avoid overhead
            if (this.checkCount % 6 === 0) { // Every minute (6 * 10sec)
                const usersWithLegacyReminders = await User.find({ 
                    'notesTree.reminder.timestamp': { $lte: now },
                    isVerified: true
                }).select('_id email notesTree');

                for (const user of usersWithLegacyReminders) {
                    await this.processUserReminders(user, now.getTime());
                }
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

    async processUserCloudReminders(userId, reminders) {
        logger.info(`Processing ${reminders.length} reminder(s) for user ${userId}`);

        for (const reminder of reminders) {
            try {
                // Import dependencies dynamically
                const { sendReminderNotification } = await import('../controllers/pushNotificationController.js');
                const { emitToUser } = await import('../socket/socketController.js');

                // Send push notifications to all user devices
                await sendReminderNotification(
                    reminder.userId,
                    reminder.itemTitle,
                    reminder.itemId,
                    reminder.timestamp.getTime()
                );

                // Emit WebSocket event to trigger reminders on all connected devices
                emitToUser(reminder.userId.toString(), 'reminder:trigger', {
                    itemId: reminder.itemId,
                    itemTitle: reminder.itemTitle,
                    timestamp: reminder.timestamp,
                    reminderData: {
                        reminderVibrationEnabled: true,
                        reminderSoundEnabled: true,
                        reminderDisplayDoneButton: true,
                        originalReminder: {
                            itemId: reminder.itemId,
                            itemTitle: reminder.itemTitle,
                            timestamp: reminder.timestamp.getTime(),
                            repeatOptions: reminder.repeatOptions
                        }
                    }
                });

                // Mark reminder as triggered (handles repeats and disabling)
                await reminder.markTriggered();

                logger.info('Cloud reminder processed successfully', {
                    userId: reminder.userId,
                    itemId: reminder.itemId,
                    itemTitle: reminder.itemTitle,
                    wasRepeating: !!reminder.repeatOptions,
                    stillEnabled: reminder.enabled
                });

            } catch (reminderError) {
                logger.error('Error processing cloud reminder:', {
                    userId,
                    itemId: reminder.itemId,
                    error: reminderError.message
                });
            }
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            isProcessing: this.isProcessing,
            cronJobExists: !!this.cronJob,
            lastCheckTime: this.lastCheckTime,
            checkCount: this.checkCount,
            processedCount: this.processedCount,
            checkFrequency: '10 seconds'
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