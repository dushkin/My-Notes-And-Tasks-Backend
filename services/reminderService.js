import { emitToUser } from "../socket/socketController.js";
import cron from 'node-cron';
import User from '../models/User.js';
import logger from '../config/logger.js';
import { sendReminderNotification } from '../controllers/pushNotificationController.js';
import { updateItemInTree } from '../utils/backendTreeUtils.js';

/**
 * Calculates the next occurrence time for a repeating reminder.
 * @param {Date|number} currentTime - The time the last reminder was sent.
 * @param {object} repeatOptions - The repeat configuration { value, unit }.
 * @returns {Date|null} The next reminder time or null if invalid.
 */
function calculateNextReminderTime(currentTime, repeatOptions) {
    if (!repeatOptions || !repeatOptions.unit || !repeatOptions.interval) return null;

    const lastTime = new Date(currentTime);
    let nextTime = new Date(lastTime.getTime());
    const interval = parseInt(repeatOptions.interval, 10) || 0;

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

class ReminderService {
    constructor() {
        this.cronJob = null;
        this.isRunning = false;
        this.isProcessing = false;
    }

    init() {
        if (process.env.NODE_ENV === 'test') {
            logger.info('Test environment detected. Skipping reminder service initialization.');
            return;
        }

        const schedule = process.env.REMINDER_CHECK_SCHEDULE || '* * * * *';
        this.cronJob = cron.schedule(schedule, () => {
            if (!this.isProcessing) {
                this.checkAndSendReminders();
            } else {
                logger.warn('Skipping reminder check cycle, previous cycle still running.');
            }
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
    
    shutdown() {
        this.stop();
        logger.info('Reminder service shutdown completed');
    }

    findDueReminders(notesTree, currentTime) {
        const due = [];
        const findRecursive = (nodes) => {
            if (!Array.isArray(nodes)) return;
            for (const item of nodes) {
                if (item && item.type === 'task' && item.reminder?.timestamp) {
                    const reminderTime = new Date(item.reminder.timestamp).getTime();
                    if (reminderTime <= currentTime) {
                        due.push({ ...item });
                    }
                }
                if (item && item.type === 'folder' && Array.isArray(item.children)) {
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
        logger.debug('Checking for due reminders', { timestamp: new Date(now).toISOString() });

        try {
            const usersWithReminders = await User.find({ 
                'notesTree.reminder.timestamp': { $lte: now } 
            }).select('_id email notesTree');

            if (usersWithReminders.length === 0) {
                logger.debug('No users with due reminders found.');
                return;
            }

            for (const user of usersWithReminders) {
                await this.processUserReminders(user, now);
            }
        } catch (error) {
            logger.error('Error during reminder check:', {
                error: error.message,
                stack: error.stack
            });
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
            await sendReminderNotification(user._id, item.label, item.id, item.reminder.timestamp);
            emitToUser(user._id.toString(), 'reminderTriggered', { itemId: item.id, reminderTime: new Date() });

            let nextReminder = null;
            if (item.reminder.repeatOptions) {
                const nextTime = calculateNextReminderTime(item.reminder.timestamp, item.reminder.repeatOptions);
                if (nextTime) {
                    nextReminder = { ...item.reminder, timestamp: nextTime.getTime() };
                }
            }
            
            currentTree = updateItemInTree(currentTree, item.id, { reminder: nextReminder });
            treeWasModified = true;
        }

        if (treeWasModified) {
            user.notesTree = currentTree;
            user.markModified('notesTree');
            await user.save();
            logger.info('Updated reminders in user tree', { userId: user._id });
        }
    }
}

export default new ReminderService();
export { calculateNextReminderTime };