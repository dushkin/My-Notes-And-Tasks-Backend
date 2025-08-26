
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!admin.apps.length) {
  try {
    const serviceAccountPath = join(__dirname, '../notask-app-29a22bae558f.json');
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.warn('Firebase service account not found or invalid:', error.message);
  }
}

async function sendFCM(fcmToken, title, body, data = {}) {
  const message = {
    token: fcmToken,
    notification: {
      title,
      body,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'reminders',
        priority: 'high',
        defaultSound: true,
        defaultVibrateTimings: true,
        defaultLightSettings: true,
        visibility: 'public'
      }
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert'
      },
      payload: {
        aps: {
          alert: {
            title,
            body
          },
          sound: 'default',
          badge: 1,
          'interruption-level': 'active'
        }
      }
    },
    data: {
      type: 'reminder',
      itemId: data.itemId || '',
      reminderId: data.reminderId || '',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      ...data
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ FCM sent successfully:', response);
    return response;
  } catch (err) {
    console.error('❌ FCM error:', err);
    return null;
  }
}

export { sendFCM };
