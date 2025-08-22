// paddle-signature-generator.js
// Run this script to generate a valid Paddle webhook signature for testing

import crypto from 'crypto';

// Your webhook secret from .env file
const WEBHOOK_SECRET = 'pdl_ntfset_fake_secret'; // Replace with your real secret

// Test payload
const payload = JSON.stringify({
  "event_type": "transaction.created",
  "event_id": "evt_test_123",
  "data": {
    "id": "txn_test_123",
    "customer": {
      "email": "test@example.com"
    },
    "status": "completed"
  }
});

// Generate timestamp (current time)
const timestamp = Math.floor(Date.now() / 1000);

// Create the signed payload (timestamp:payload)
const signedPayload = `${timestamp}:${payload}`;

// Generate HMAC SHA256 signature
const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
hmac.update(signedPayload);
const signature = hmac.digest('hex');

// Format as Paddle expects: ts=timestamp;h1=signature
const paddleSignature = `ts=${timestamp};h1=${signature}`;

console.log('Generated Paddle Signature:', paddleSignature);
console.log('\nUse this curl command:');
console.log(`curl -X POST http://localhost:5001/api/paddle/webhook \\
  -H "Content-Type: application/json" \\
  -H "Paddle-Signature: ${paddleSignature}" \\
  -d '${payload}'`);

console.log('\nPayload used:');
console.log(payload);
console.log('\nTimestamp:', timestamp);
console.log('Signature:', signature);