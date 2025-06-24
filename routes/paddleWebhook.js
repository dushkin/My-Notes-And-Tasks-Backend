// routes/paddleWebhook.js
import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js'; // your real user model

const router = express.Router();

// Optionally verify signature
function verifyPaddleSignature(reqBody) {
  return true; // Simplified
}

router.post('/webhook', async (req, res) => {
  const eventType = req.body.alert_name;
  const email = req.body.email || req.body.checkout?.custom_data?.email || req.body.checkout?.passthrough?.email;

  if (!email) {
    console.warn('Missing email in Paddle webhook');
    return res.status(400).send('Missing email');
  }

  try {
    switch (eventType) {
      case 'checkout_completed':
      case 'subscription_created':
      case 'subscription_payment_succeeded':
        await User.findOneAndUpdate({ email }, { isPro: true });
        console.log(`[Paddle] Marked ${email} as PRO`);
        break;

      case 'subscription_cancelled':
        await User.findOneAndUpdate({ email }, { isPro: false });
        console.log(`[Paddle] Marked ${email} as NOT PRO`);
        break;

      default:
        console.log(`[Paddle] Unhandled event: ${eventType}`);
        break;
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Server error');
  }
});

export default router;
