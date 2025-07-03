import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';
import axios from 'axios'; // Import axios to make API calls to Paddle

const router = express.Router();

// Helper function to get customer email if not in the payload
const getCustomerEmail = async (customerId) => {
  if (!customerId) return null;
  try {
    const response = await axios.get(
      `https://sandbox-api.paddle.com/customers/${customerId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data?.data?.email || null;
  } catch (error) {
    console.error(`[Paddle] Failed to fetch customer details for ${customerId}:`, error.response?.data || error.message);
    return null;
  }
};


// Middleware to verify Paddle's webhook signature
const verifyPaddleMiddleware = (req, res, next) => {
  const paddleSignature = req.headers['paddle-signature'];
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET_KEY;

  if (!paddleSignature || !webhookSecret) {
    console.warn('[Paddle] Missing signature or secret key.');
    return res.status(400).send('Webhook signature or secret missing.');
  }

  const parts = paddleSignature.split(';');
  const timestampStr = parts.find(part => part.startsWith('ts='))?.split('=')[1];
  const signatureHex = parts.find(part => part.startsWith('h1='))?.split('=')[1];

  if (!timestampStr || !signatureHex) {
    return res.status(400).send('Invalid Paddle-Signature header format.');
  }

  const timestamp = parseInt(timestampStr, 10);
  const fiveMinutesInMillis = 5 * 60 * 1000;
  if (Date.now() - (timestamp * 1000) > fiveMinutesInMillis) {
    return res.status(400).send('Webhook timestamp too old.');
  }

  const signedPayload = `${timestampStr}:${req.rawBody}`;
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(signedPayload);
  const computedSignature = hmac.digest('hex');

  if (crypto.timingSafeEqual(Buffer.from(computedSignature), Buffer.from(signatureHex))) {
    next();
  } else {
    console.warn('[Paddle] Invalid webhook signature.');
    return res.status(400).send('Invalid signature.');
  }
};

router.post('/webhook', verifyPaddleMiddleware, async (req, res) => {
  console.log('[Paddle] Received and verified webhook:', JSON.stringify(req.body, null, 2));

  const eventType = req.body.event_type;
  let email = req.body.data?.customer?.email || null;

  // If email is not in the payload, try fetching it using the customer_id
  if (!email && req.body.data?.customer_id) {
    console.log(`[Paddle] Email not in payload, fetching from customer ID: ${req.body.data.customer_id}`);
    email = await getCustomerEmail(req.body.data.customer_id);
  }

  const planId = req.body.data?.custom_data?.plan || null;

  console.log(`[Paddle] Event: ${eventType}, Email: ${email}, Plan: ${planId}`);

  if (!email) {
    console.warn('[Paddle] Could not determine email from webhook payload or customer lookup.');
    return res.status(400).send('Email could not be determined.');
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.warn(`[Paddle] User not found: ${email}`);
      return res.status(404).send('User not found');
    }

    // Use transaction.completed as the source of truth for all purchases
    if (eventType === 'transaction.completed') {
      const transaction = req.body.data;
      // Check for subscription details for recurring plans
      if (transaction.subscription_id && transaction.billing_period) {
        user.subscriptionStatus = 'active';
        user.subscriptionEndsAt = new Date(transaction.billing_period.ends_at);
        user.paddleSubscriptionId = transaction.subscription_id;
        user.paddleTransactionId = transaction.id;
        await user.save();
        console.log(`[Paddle] Recurring plan activated for ${email}. Access until ${user.subscriptionEndsAt}`);
      }
      // Handle one-time purchases (like lifetime)
      else if (planId === 'lifetime') {
        user.subscriptionStatus = 'active';
        user.subscriptionEndsAt = new Date('2999-12-31T23:59:59Z');
        user.paddleTransactionId = transaction.id;
        await user.save();
        console.log(`[Paddle] Lifetime plan activated for ${email}.`);
      }
    } else if (eventType === 'subscription.canceled') {
      const subscription = req.body.data;
      user.subscriptionStatus = 'cancelled';
      if (subscription.scheduled_change_at) {
        user.subscriptionEndsAt = new Date(subscription.scheduled_change_at);
      }
      await user.save();
      console.log(`[Paddle] Subscription cancellation processed for ${email}. Access ends at ${user.subscriptionEndsAt}`);
    } else {
      console.log(`[Paddle] Unhandled but acknowledged event type: ${eventType}`);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[Paddle] Webhook processing error:', err);
    res.status(500).send('Server error');
  }
});

export default router;