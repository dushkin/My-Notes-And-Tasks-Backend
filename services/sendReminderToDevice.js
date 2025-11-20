
import { sendFCM } from '../utils/fcmSender.js';
// Note: No Item model import needed as this service is currently disabled

async function sendReminderToDevice(item) {
  try {
    if (!item || !item.user || !item.user.fcmToken) return;

    const now = Date.now();
    const reminder = item.reminder;
    if (!reminder || reminder.disabled || new Date(reminder.timestamp).getTime() > now) return;

    const title = '🔔 Reminder';
    const body = item.title || 'Reminder from Notes & Tasks';

    const reminderData = {
      itemId: item._id?.toString(),
      reminderId: `${item._id}-${reminder.timestamp}`,
      type: 'reminder',
      timestamp: reminder.timestamp
    };
    
    await sendFCM(item.user.fcmToken, title, body, reminderData);
    console.log(`✅ FCM reminder sent for item: ${item._id}`);
  } catch (err) {
    console.error('❌ Failed to send FCM reminder:', err);
  }
}

export { sendReminderToDevice };
