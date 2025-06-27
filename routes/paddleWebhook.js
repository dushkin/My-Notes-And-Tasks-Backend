// routes/paddleWebhook.js
import express from 'express';
import User from '../models/User.js';

const router = express.Router();

// TODO: implement real Paddle signature verification
function verifyPaddleSignature(reqBody) {
  return true;
}

router.post('/webhook', express.json(), async (req, res) => {
  // Verify request authenticity
  if (!verifyPaddleSignature(req.body)) {
    console.warn('[Paddle] Invalid webhook signature');
    return res.status(400).send('Invalid signature');
  }

  const eventType = req.body.alert_name;
  const email =
    req.body.email ||
    req.body.checkout?.custom_data?.email ||
    req.body.checkout?.passthrough?.email;

  if (!email) {
    console.warn('[Paddle] Missing email in webhook payload');
    return res.status(400).send('Missing email');
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.warn(`[Paddle] User not found: ${email}`);
      return res.status(404).send('User not found');
    }

    switch (eventType) {
      case 'subscription_created':
      case 'subscription_payment_succeeded': {
        const nextBillDate = req.body.next_bill_date;
        if (nextBillDate) {
          user.subscriptionStatus = 'active';
          user.subscriptionEndsAt = new Date(nextBillDate);
          await user.save();
          console.log(
            `[Paddle] Subscription active for ${email}, expires ${nextBillDate}`
          );
        } else {
          console.warn(
            `[Paddle] Missing next_bill_date for event: ${eventType}`
          );
        }
        break;
      }
      case 'subscription_cancelled': {
        const cancelDate = req.body.cancellation_effective_date;
        if (cancelDate) {
          user.subscriptionStatus = 'cancelled';
          user.subscriptionEndsAt = new Date(cancelDate);
          await user.save();
          console.log(
            `[Paddle] Subscription cancelled for ${email}, access until ${cancelDate}`
          );
        } else {
          console.warn(
            '[Paddle] Missing cancellation_effective_date for subscription_cancelled event'
          );
        }
        break;
      }
      default:
        console.log(`[Paddle] Unhandled event type: ${eventType}`);
        break;
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[Paddle] Webhook processing error:', err);
    res.status(500).send('Server error');
  }
});

export default router;
