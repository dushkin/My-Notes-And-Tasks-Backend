
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

async function sendFCM(fcmToken, title, body) {
  const message = {
    token: fcmToken,
    notification: {
      title,
      body,
    },
    android: {
      priority: 'high',
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ FCM sent:', response);
    return response;
  } catch (err) {
    console.error('❌ FCM error:', err);
    return null;
  }
}

export { sendFCM };
