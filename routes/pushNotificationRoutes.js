import express from "express";
import webpush from "web-push";
import PushSubscription from "../models/PushSubscription.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Save subscription
router.post("/subscribe", authMiddleware, async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).send("Invalid subscription");

  await PushSubscription.create({ userId: req.user.id, subscription });
  res.status(201).send("Subscribed");
});

// Send test notification
router.post("/test", authMiddleware, async (req, res) => {
  const subscriptions = await PushSubscription.find({ userId: req.user.id });

  const payload = JSON.stringify({ title: "Test Notification", body: "Hello from multi-device push!" });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub.subscription, payload);
    } catch (err) {
      console.error("Failed to send:", err);
    }
  }
  res.status(200).send("Notification sent to all devices.");
});

export default router;
