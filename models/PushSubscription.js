import mongoose from "mongoose";

const PushSubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subscription: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now }
});

const PushSubscription = mongoose.model("PushSubscription", PushSubscriptionSchema);
export default PushSubscription;
