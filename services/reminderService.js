import cron from 'node-cron';
import User from '../models/User.js';
import logger from '../config/logger.js';
import PushSubscription from "../models/PushSubscription.js";
import webpush from "web-push";

class ReminderService {
    constructor() {
        this.cronJob = null;
        this.isRunning = false;
    }

    init() {
        if (process.env.NODE_ENV === 'test') {
            logger.info('Test environment detected. Skipping reminder service initialization.');
            return;
        }

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

    start() {
        if (this.cronJob && !this.isRunning) {
            this.cronJob.start();
            this.isRunning = true;
            logger.info('Reminder service started');
        }
    }

    stop() {
        if (this.cronJob && this.isRunning) {
            this.cronJob.stop();
            this.isRunning = false;
            logger.info('Reminder service stopped');
        }
    }

    async checkAndSendReminders() {
        try {
            const now = new Date();
            logger.debug('Checking for due reminders', { timestamp: now.toISOString() });

            const users = await User.find({
                notesTree: { $exists: true, $ne: [] }
            }).select('_id notesTree');

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

    async processUserReminders(user, currentTime) {
        let remindersChecked = 0;
        let remindersSent = 0;

        try {
            const dueReminders = this.findDueReminders(user.notesTree, currentTime);
            remindersChecked = dueReminders.length;

            const subscriptions = await PushSubscription.find({ userId: user._id });

            for (const reminder of dueReminders) {
                const payload = JSON.stringify({
                    title: "🔔 Reminder",
                    body: reminder.itemTitle,
                    data: { taskId: reminder.itemId }
                });

                for (const sub of subscriptions) {
                    try {
                        await webpush.sendNotification(sub.subscription, payload);
                        remindersSent++;
                    } catch (err) {
                        logger.warn("Push notification failed", {
                            userId: user._id,
                            endpoint: sub.subscription.endpoint,
                            error: err.message
                        });
                    }
                }

                await this.removeProcessedReminder(user._id, reminder.itemId);
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

    findDueReminders(notesTree, currentTime, path = []) {
        const dueReminders = [];

        if (!Array.isArray(notesTree)) return dueReminders;

        for (const item of notesTree) {
            if (item.reminder && item.reminder.timestamp) {
                const reminderTime = new Date(item.reminder.timestamp);
                if (reminderTime <= currentTime) {
                    dueReminders.push({
                        itemId: item.id,
                        itemTitle: item.label || 'Untitled',
                        reminderTime,
                        path: [...path, item.label || 'Untitled']
                    });
                }
            }

            if (item.children && Array.isArray(item.children)) {
                dueReminders.push(
                    ...this.findDueReminders(item.children, currentTime, [...path, item.label || 'Untitled'])
                );
            }
        }

        return dueReminders;
    }

    async removeProcessedReminder(userId, itemId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                logger.warn('User not found when removing reminder', { userId, itemId });
                return;
            }

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

    removeReminderFromTree(tree, itemId) {
        if (!Array.isArray(tree)) return false;

        for (const item of tree) {
            if (item.id === itemId && item.reminder) {
                delete item.reminder;
                return true;
            }

            if (item.children && Array.isArray(item.children)) {
                if (this.removeReminderFromTree(item.children, itemId)) return true;
            }
        }

        return false;
    }

    async shutdown() {
        this.stop();
        logger.info('Reminder service shutdown completed');
    }
}

export default new ReminderService();

function calculateNextReminderTime(currentTime, repeat) {
    const multiplier = {
        seconds: 1000,
        minutes: 60 * 1000,
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000,
        weeks: 7 * 24 * 60 * 60 * 1000,
        months: 30 * 24 * 60 * 60 * 1000,
        years: 365 * 24 * 60 * 60 * 1000,
    };
    if (!repeat || !repeat.unit || !repeat.value) return null;
    const ms = multiplier[repeat.unit] * repeat.value;
    return new Date(new Date(currentTime).getTime() + ms);
}

export { calculateNextReminderTime };
