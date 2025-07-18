import mongoose from 'mongoose';
import { fieldEncryption } from 'mongoose-field-encryption';

const Schema = mongoose.Schema;
const userSchema = new Schema({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/\S+@\S+\.\S+/, 'Please use a valid email address'],
        index: true
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [8, 'Password must be at least 8 characters long']
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    subscriptionStatus: {
        type: String,
        enum: ['active', 'cancelled', 'past_due', 'none'],
        default: 'none'
    },
    subscriptionEndsAt: {
        type: Date
    },
    paddleSubscriptionId: {
        type: String,
        trim: true,
        index: true
    },
    paddleTransactionId: {
        type: String,
        trim: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    
    // Push notification subscription data
    pushSubscriptions: [{
        endpoint: String,
        keys: {
            p256dh: String,
            auth: String
        },
        userAgent: String,
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    
    notesTree: {
        type: Schema.Types.Mixed,
        default: []
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});
// Preserve timestamp
userSchema.pre('save', function (next) {
    if (this.isModified()) this.updatedAt = Date.now();
    next();
});
userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};
// Encrypt notesTree field
userSchema.plugin(fieldEncryption, {
    fields: ['notesTree'],
    secret: process.env.DATA_ENCRYPTION_SECRET
});

export default mongoose.model('User', userSchema);