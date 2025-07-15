import cron from 'node-cron';
import User from '../models/User.js';
import { sendReminderNotification } from '../controllers/pushNotificationController.js';
import logger from '../config/logger.js';

class ReminderService {
    constructor() {
        this.cronJob = null;
        this.isRunning = false;
    }

    /**
     * Initialize the reminder service
     */
    init() {
        if (process.env.NODE_ENV === 'test') {
            logger.info('Test environment detected. Skipping reminder service initialization.');
            return;
        }

        // Run every minute to check for due reminders
        const schedule = process.env.REMINDER_CHECK_SCHEDULE || '* * * * *';
        
        this.cronJob = cron.schedule(schedule, async () => {
            await this.checkAndSendReminders();
        }, {
            scheduled: false,
            timezone: process.env.CRON_TIMEZONE || 'UTC'
        });

        this.start();
        logger.info('Reminder service initialized', { schedule });
    }

    /**
     * Start the reminder service
     */
    start() {
        if (this.cronJob && !this.isRunning) {
            this.cronJob.start();
            this.isRunning = true;
            logger.info('Reminder service started');
        }
    }

    /**
     * Stop the reminder service
     */
    stop() {
        if (this.cronJob && this.isRunning) {
            this.cronJob.stop();
            this.isRunning = false;
            logger.info('Reminder service stopped');
        }
    }

    /**
     * Check for due reminders and send notifications
     */
    async checkAndSendReminders() {
        try {
            const now = new Date();
            logger.debug('Checking for due reminders', { timestamp: now.toISOString() });

            // Get all users with notes trees
            const users = await User.find({ 
                notesTree: { $exists: true, $ne: [] },
                pushSubscriptions: { $exists: true, $ne: [] }
            }).select('_id notesTree pushSubscriptions');

            let totalRemindersChecked = 0;
            let totalRemindersSent = 0;

            for (const user of users) {
                const result = await this.processUserReminders(user, now);
                totalRemindersChecked += result.checked;
                totalRemindersSent += result.sent;
            }

            if (totalRemindersChecked > 0) {
                logger.info('Reminder check completed', {
                    usersProcessed: users.length,
                    remindersChecked: totalRemindersChecked,
                    remindersSent: totalRemindersSent
                });
            }

        } catch (error) {
            logger.error('Error during reminder check:', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Process reminders for a specific user
     */
    async processUserReminders(user, currentTime) {
        let remindersChecked = 0;
        let remindersSent = 0;

        try {
            const dueReminders = this.findDueReminders(user.notesTree, currentTime);
            remindersChecked = dueReminders.length;

            for (const reminder of dueReminders) {
                try {
                    await sendReminderNotification(
                        user._id,
                        reminder.itemTitle,
                        reminder.itemId,
                        reminder.reminderTime
                    );
                    remindersSent++;

                    // Remove the processed reminder from the user's tree
                    await this.removeProcessedReminder(user._id, reminder.itemId);

                } catch (error) {
                    logger.error('Failed to send individual reminder:', {
                        userId: user._id,
                        itemId: reminder.itemId,
                        error: error.message
                    });
                }
            }

        } catch (error) {
            logger.error('Error processing user reminders:', {
                userId: user._id,
                error: error.message,
                stack: error.stack
            });
        }

        return { checked: remindersChecked, sent: remindersSent };
    }

    /**
     * Find due reminders in a notes tree
     */
    findDueReminders(notesTree, currentTime, path = []) {
        const dueReminders = [];

        if (!Array.isArray(notesTree)) {
            return dueReminders;
        }

        for (const item of notesTree) {
            // Check if this item has a due reminder
            if (item.reminder && item.reminder.timestamp) {
                const reminderTime = new Date(item.reminder.timestamp);
                if (reminderTime <= currentTime) {
                    dueReminders.push({
                        itemId: item.id,
                        itemTitle: item.label || 'Untitled',
                        reminderTime: reminderTime,
                        path: [...path, item.label || 'Untitled']
                    });
                }
            }

            // Recursively check children
            if (item.children && Array.isArray(item.children)) {
                const childReminders = this.findDueReminders(
                    item.children, 
                    currentTime, 
                    [...path, item.label || 'Untitled']
                );
                dueReminders.push(...childReminders);
            }
        }

        return dueReminders;
    }

    /**
     * Remove a processed reminder from user's notes tree
     */
    async removeProcessedReminder(userId, itemId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                logger.warn('User not found when removing reminder', { userId, itemId });
                return;
            }

            // Remove reminder from the item
            const updated = this.removeReminderFromTree(user.notesTree, itemId);
            
            if (updated) {
                await user.save();
                logger.debug('Reminder removed from item', { userId, itemId });
            }

        } catch (error) {
            logger.error('Failed to remove processed reminder:', {
                userId,
                itemId,
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Remove reminder from a specific item in the tree
     */
    removeReminderFromTree(tree, itemId) {
        if (!Array.isArray(tree)) {
            return false;
        }

        for (const item of tree) {
            if (item.id === itemId && item.reminder) {
                delete item.reminder;
                return true;
            }

            if (item.children && Array.isArray(item.children)) {
                if (this.removeReminderFromTree(item.children, itemId)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Shutdown the reminder service
     */
    async shutdown() {
        this.stop();
        logger.info('Reminder service shutdown completed');
    }
}

// Export singleton instance
export default new ReminderService();
