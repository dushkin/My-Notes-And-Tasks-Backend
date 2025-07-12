// models/PushSubscription.js
import mongoose from 'mongoose';
const Schema = mongoose.Schema;

const pushSubscriptionSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    endpoint: {
        type: String,
        required: true,
        unique: true
    },
    keys: {
        p256dh: {
            type: String,
            required: true
        },
        auth: {
            type: String,
            required: true
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model('PushSubscription', pushSubscriptionSchema);