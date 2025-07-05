import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';
import axios from 'axios';
import logger from '../config/logger.js';
import { catchAsync, AppError } from '../middleware/errorHandlerMiddleware.js';

const PADDLE_ENV = process.env.NODE_ENV === 'production' ? 'production' : 'sandbox';
const PADDLE_BASE_URL = PADDLE_ENV === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_WEBHOOK_SECRET_KEY = process.env.PADDLE_WEBHOOK_SECRET_KEY;

const router = express.Router();

// Helper function to get customer email if not in the payload
const getCustomerEmail = async (customerId) => {
  if (!customerId) return null;
  try {
    const response = await axios.get(
      `${PADDLE_BASE_URL}/customers/${customerId}`,
      {
        headers: {
          Authorization: `Bearer ${PADDLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data?.data?.email || null;
  } catch (error) {
    logger.error(`Failed to fetch customer details for ${customerId}`, {
      error: error.response?.data || error.message,
      customerId,
      statusCode: error.response?.status
    });
    return null;
  }
};

// Improved middleware to verify Paddle's webhook signature
const verifyPaddleMiddleware = (req, res, next) => {
  const paddleSignature = req.headers['paddle-signature'];
  const webhookSecret = PADDLE_WEBHOOK_SECRET_KEY;

  logger.info('Verifying Paddle webhook signature', {
    hasSignature: !!paddleSignature,
    hasSecret: !!webhookSecret,
    hasRawBody: !!req.rawBody,
    rawBodyLength: req.rawBody?.length,
    signaturePreview: paddleSignature ? paddleSignature.substring(0, 50) + '...' : 'none'
  });

  // If no webhook secret is configured, skip verification but log warning
  if (!webhookSecret) {
    logger.warn('PADDLE_WEBHOOK_SECRET_KEY not configured - skipping signature verification');
    return next();
  }

  if (!paddleSignature) {
    logger.error('Paddle webhook signature missing', {
      headers: Object.keys(req.headers),
      contentType: req.headers['content-type']
    });
    return res.status(400).json({ 
      error: 'Webhook signature missing',
      message: 'Paddle-Signature header is required' 
    });
  }

  if (!req.rawBody) {
    logger.error('Raw body missing for signature verification');
    return res.status(400).json({ 
      error: 'Raw body missing',
      message: 'Unable to verify signature without raw body' 
    });
  }

  try {
    const parts = paddleSignature.split(';');
    const timestampStr = parts.find(part => part.startsWith('ts='))?.split('=')[1];
    const signatureHex = parts.find(part => part.startsWith('h1='))?.split('=')[1];

    if (!timestampStr || !signatureHex) {
      logger.error('Invalid Paddle-Signature header format', { 
        paddleSignature,
        parts: parts.length 
      });
      return res.status(400).json({ 
        error: 'Invalid signature format',
        message: 'Expected format: ts=timestamp;h1=hash' 
      });
    }

    const timestamp = parseInt(timestampStr, 10);
    const fiveMinutesInMillis = 5 * 60 * 1000;
    const timeDiff = Date.now() - (timestamp * 1000);
    
    if (timeDiff > fiveMinutesInMillis) {
      logger.warn('Webhook timestamp too old', { 
        timestamp, 
        timeDiffMinutes: Math.round(timeDiff / (60 * 1000)) 
      });
      return res.status(400).json({ 
        error: 'Timestamp too old',
        message: 'Webhook must be processed within 5 minutes' 
      });
    }

    const signedPayload = `${timestampStr}:${req.rawBody}`;
    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(signedPayload);
    const computedSignature = hmac.digest('hex');

    // Use timingSafeEqual for secure comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(computedSignature, 'hex'),
      Buffer.from(signatureHex, 'hex')
    );

    if (isValid) {
      logger.info('Paddle webhook signature verified successfully');
      next();
    } else {
      logger.error('Invalid Paddle webhook signature', {
        computedLength: computedSignature.length,
        providedLength: signatureHex.length,
        timestampStr,
        payloadLength: req.rawBody.length
      });
      return res.status(400).json({ 
        error: 'Invalid signature',
        message: 'Signature verification failed' 
      });
    }
  } catch (error) {
    logger.error('Error during signature verification', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ 
      error: 'Signature verification error',
      message: 'Internal error during verification' 
    });
  }
};

router.post('/webhook', verifyPaddleMiddleware, catchAsync(async (req, res, next) => {
  const eventType = req.body.event_type;
  const eventId = req.body.event_id;
  const eventData = req.body.data;

  logger.info('Processing Paddle webhook', {
    eventType,
    eventId,
    hasData: !!eventData,
    customerId: eventData?.customer_id,
    subscriptionId: eventData?.subscription_id,
    transactionId: eventData?.id,
    eventDataKeys: eventData ? Object.keys(eventData) : [],
    // Add full payload for debugging transaction.completed
    fullPayload: eventType === 'transaction.completed' ? JSON.stringify(eventData, null, 2) : 'not logged'
  });

  // Define events that don't require user processing
  const skipUserProcessingEvents = [
    'address.created',
    'customer.created',
    'transaction.created',
    'transaction.updated',
    'transaction.ready',
    'transaction.paid',
    'subscription.created',
    'subscription.activated',
    'payment_method.saved'
  ];

  // For events that don't require user processing, acknowledge immediately
  if (skipUserProcessingEvents.includes(eventType)) {
    logger.info('Acknowledging event without user processing', {
      eventType,
      eventId,
      customerId: eventData?.customer_id
    });
    
    return res.status(200).json({ 
      received: true,
      eventType,
      eventId,
      processed: true,
      message: 'Event acknowledged - no user processing required'
    });
  }

  let email = null;

  // Handle different event types and their payload structures
  switch (eventType) {
    case 'transaction.completed':
      // For transaction events, try multiple ways to get the email
      email = eventData?.customer?.email || 
              eventData?.billing_details?.email || 
              eventData?.checkout?.customer_email ||
              eventData?.customer_email ||
              eventData?.billing?.email ||
              eventData?.payer?.email ||
              null;
              
      logger.info('Email extraction attempt for transaction.completed', {
        customerEmail: eventData?.customer?.email,
        billingEmail: eventData?.billing_details?.email,
        checkoutEmail: eventData?.checkout?.customer_email,
        directEmail: eventData?.customer_email,
        billingEmail2: eventData?.billing?.email,
        payerEmail: eventData?.payer?.email,
        customerId: eventData?.customer_id,
        foundEmail: email
      });
      
      if (!email && eventData?.customer_id) {
        logger.info('Attempting to fetch customer email from API', {
          customerId: eventData.customer_id
        });
        email = await getCustomerEmail(eventData.customer_id);
      }
      
      // If still no email, try looking in items or other nested objects
      if (!email && eventData?.items) {
        for (const item of eventData.items) {
          if (item?.customer?.email) {
            email = item.customer.email;
            logger.info('Found email in items array', { email });
            break;
          }
        }
      }
      
      // Try looking in any nested objects
      if (!email && eventData) {
        const searchForEmail = (obj, path = '') => {
          for (const [key, value] of Object.entries(obj)) {
            if (key === 'email' && typeof value === 'string' && value.includes('@')) {
              logger.info(`Found email at path: ${path}.${key}`, { email: value });
              return value;
            }
            if (typeof value === 'object' && value !== null) {
              const found = searchForEmail(value, `${path}.${key}`);
              if (found) return found;
            }
          }
          return null;
        };
        
        if (!email) {
          email = searchForEmail(eventData);
        }
      }
      break;
      
    case 'subscription.canceled':
      // For subscription events, we might need to fetch customer details
      if (eventData?.customer_id) {
        email = await getCustomerEmail(eventData.customer_id);
      }
      break;
      
    default:
      // For other events, try both approaches
      email = eventData?.customer?.email || eventData?.email || null;
      if (!email && eventData?.customer_id) {
        email = await getCustomerEmail(eventData.customer_id);
      }
  }

  const planId = eventData?.custom_data?.plan || null;

  logger.info('Webhook details extracted', {
    eventType,
    email,
    planId,
    customerId: eventData?.customer_id
  });

  if (!email) {
    logger.error('Could not determine email from webhook payload or customer lookup', {
      eventType,
      eventId,
      customerId: eventData?.customer_id,
      hasCustomerObject: !!eventData?.customer,
      eventDataKeys: Object.keys(eventData || {}),
      isSimulation: eventId?.includes('ntfsimevt_') || false
    });
    
    // For transaction.completed, try to find user by paddle transaction ID or subscription ID
    if (eventType === 'transaction.completed') {
      let user = null;
      
      // Try to find user by transaction ID
      if (eventData?.id) {
        user = await User.findOne({ paddleTransactionId: eventData.id });
      }
      
      // Try to find user by subscription ID
      if (!user && eventData?.subscription_id) {
        user = await User.findOne({ paddleSubscriptionId: eventData.subscription_id });
      }
      
      if (user) {
        logger.info('Found user by paddle ID for transaction.completed', {
          userId: user.id,
          email: user.email,
          transactionId: eventData.id,
          subscriptionId: eventData.subscription_id
        });
        
        // Process the transaction for this user
        await handleTransactionCompleted(user, eventData, planId);
        
        return res.status(200).json({ 
          received: true,
          eventType,
          eventId,
          processed: true,
          message: 'User found by paddle ID'
        });
      }
      
      // If this is a simulation event, we can acknowledge it without processing
      if (eventId?.includes('ntfsimevt_')) {
        logger.info('Acknowledging simulation transaction.completed without user processing', {
          eventType,
          eventId,
          reason: 'Simulation event - no email available'
        });
        
        return res.status(200).json({ 
          received: true,
          eventType,
          eventId,
          processed: false,
          message: 'Simulation event acknowledged - no user processing'
        });
      }
      
      logger.warn('Could not find user by email or paddle IDs for transaction.completed', {
        eventType,
        eventId,
        transactionId: eventData?.id,
        subscriptionId: eventData?.subscription_id
      });
    }
    
    return res.status(400).json({ 
      error: 'Email required',
      message: 'Could not determine customer email',
      eventType,
      eventId
    });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      logger.warn('User not found for webhook', { 
        email, 
        eventType, 
        eventId 
      });
      
      return res.status(404).json({ 
        error: 'User not found',
        message: `No user found with email: ${email}`,
        eventType,
        eventId
      });
    }

    logger.info('Processing webhook for user', {
      userId: user.id,
      email: user.email,
      currentSubscriptionStatus: user.subscriptionStatus,
      eventType
    });

    // Process different event types
    switch (eventType) {
      case 'transaction.completed':
        await handleTransactionCompleted(user, eventData, planId);
        break;
        
      case 'subscription.canceled':
        await handleSubscriptionCanceled(user, eventData);
        break;
        
      default:
        logger.info('Unhandled webhook event type', { 
          eventType,
          eventId,
          userId: user.id 
        });
    }

    res.status(200).json({ 
      received: true,
      eventType,
      eventId,
      processed: true 
    });
    
  } catch (err) {
    logger.error('Webhook processing error', {
      error: err.message,
      stack: err.stack,
      eventType,
      eventId,
      email
    });
    
    return next(new AppError('Webhook processing failed', 500));
  }
}));

// Helper functions for handling different event types
async function handleTransactionCompleted(user, transaction, planId) {
  // Check for subscription details for recurring plans
  if (transaction.subscription_id && transaction.billing_period) {
    user.subscriptionStatus = 'active';
    user.subscriptionEndsAt = new Date(transaction.billing_period.ends_at);
    user.paddleSubscriptionId = transaction.subscription_id;
    user.paddleTransactionId = transaction.id;
    await user.save();
    
    logger.info('Recurring plan activated', {
      userId: user.id,
      email: user.email,
      subscriptionId: transaction.subscription_id,
      endsAt: user.subscriptionEndsAt
    });
  }
  // Handle one-time purchases (like lifetime)
  else if (planId === 'lifetime') {
    user.subscriptionStatus = 'active';
    user.subscriptionEndsAt = new Date('2999-12-31T23:59:59Z');
    user.paddleTransactionId = transaction.id;
    await user.save();
    
    logger.info('Lifetime plan activated', {
      userId: user.id,
      email: user.email,
      transactionId: transaction.id
    });
  } else {
    // Handle other one-time purchases
    user.subscriptionStatus = 'active';
    user.paddleTransactionId = transaction.id;
    await user.save();
    
    logger.info('One-time purchase completed', {
      userId: user.id,
      email: user.email,
      transactionId: transaction.id,
      planId
    });
  }
}

async function handleSubscriptionCanceled(user, subscription) {
  user.subscriptionStatus = 'cancelled';
  if (subscription.scheduled_change_at) {
    user.subscriptionEndsAt = new Date(subscription.scheduled_change_at);
  }
  await user.save();
  
  logger.info('Subscription cancellation processed', {
    userId: user.id,
    email: user.email,
    subscriptionId: subscription.id,
    endsAt: user.subscriptionEndsAt
  });
}

export default router;