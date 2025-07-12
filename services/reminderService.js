// services/reminderService.js
import webpush from 'web-push';
import User from '../models/User.js';
import PushSubscription from '../models/PushSubscription.js';
import logger from '../config/logger.js';

webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

const findDueReminders = async () => {
    const now = new Date();
    const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

    // Find users with tasks that have active reminders due in the next minute
    const usersWithDueReminders = await User.find({
        'notesTree.reminder.isActive': true,
        'notesTree.reminder.dueAt': {
            $gte: now,
            $lt: oneMinuteFromNow,
        },
    }).lean();

    const dueTasks = [];
    usersWithDueReminders.forEach(user => {
        const findTasks = (nodes) => {
            if (!Array.isArray(nodes)) return;
            nodes.forEach(item => {
                if (
                    item.type === 'task' &&
                    item.reminder?.isActive &&
                    new Date(item.reminder.dueAt) >= now &&
                    new Date(item.reminder.dueAt) < oneMinuteFromNow
                ) {
                    dueTasks.push({ ...item, userId: user._id });
                }
                if (item.children) {
                    findTasks(item.children);
                }
            });
        };
        findTasks(user.notesTree);
    });
    return dueTasks;
};

const sendReminderNotification = async (task) => {
    try {
        const user = await User.findById(task.userId);
        if (!user) {
            logger.warn('User not found for sending reminder', { userId: task.userId });
            return;
        }

        const subscriptions = await PushSubscription.find({ userId: task.userId });
        if (subscriptions.length === 0) {
            logger.warn('No push subscriptions found for user to send reminder', { userId: task.userId, taskId: task.id });
            return;
        }
        
        // Use user's settings to build notification options
        const userSettings = user.settings || {};
        const notificationOptions = {
            body: "This task is now due.",
            icon: '/favicon-48x48.png',
            badge: '/badge-96x96.png', // For Badging API
            tag: task.id,
            requireInteraction: true, // For persistent notifications
            actions: [
                { action: 'snooze', title: 'Snooze (15 min)' },
                { action: 'complete', title: 'Mark as Complete' }
            ],
            data: {
                url: `/app/item/${task.id}`,
                taskId: task.id,
            }
        };

        // Add sound and vibration based on user settings
        if (userSettings.reminderSoundEnabled && userSettings.reminderSoundUrl) {
            notificationOptions.sound = userSettings.reminderSoundUrl;
        }
        if (userSettings.reminderVibrationEnabled) {
            notificationOptions.vibrate = [200, 100, 200];
        }

        const payload = JSON.stringify({
            title: task.label,
            options: notificationOptions
        });

        const sendPromises = subscriptions.map(sub =>
            webpush.sendNotification(sub.toObject(), payload)
        );

        await Promise.allSettled(sendPromises);
        logger.info('Sent reminder push notification', { userId: task.userId, taskId: task.id, title: task.label });

    } catch (error) {
        logger.error('Failed to send push notification', { userId: task.userId, taskId: task.id, error: error.message });
    }
};


const updateTaskReminder = async (task) => {
    const user = await User.findById(task.userId);
    if (!user) return;

    let wasModified = false;
    const updateInTree = (nodes) => {
        return nodes.map(item => {
            if (item.id === task.id) {
                wasModified = true;
                const newReminder = { ...item.reminder };

                if (item.reminder.repeat?.frequency) {
                    const nextDue = new Date(item.reminder.dueAt);
                    const { frequency } = item.reminder.repeat;
                    if (frequency === 'daily') nextDue.setDate(nextDue.getDate() + 1);
                    if (frequency === 'weekly') nextDue.setDate(nextDue.getDate() + 7);
                    if (frequency === 'monthly') nextDue.setMonth(nextDue.getMonth() + 1);
                    if (frequency === 'yearly') nextDue.setFullYear(nextDue.getFullYear() + 1);
                    newReminder.dueAt = nextDue.toISOString();
                } else {
                    newReminder.isActive = false;
                }
                return { ...item, reminder: newReminder };
            }
            if (item.children) {
                return { ...item, children: updateInTree(item.children) };
            }
            return item;
        });
    };

    user.notesTree = updateInTree(user.notesTree);
    if (wasModified) {
        user.markModified('notesTree');
        await user.save();
        logger.info('Updated task reminder after sending notification', { userId: task.userId, taskId: task.id });
    }
};

export const processReminders = async () => {
    const dueTasks = await findDueReminders();
    if (dueTasks.length > 0) {
        logger.info(`Found ${dueTasks.length} due task(s) to process.`);
        for (const task of dueTasks) {
            await sendReminderNotification(task);
            await updateTaskReminder(task);
        }
    }
};