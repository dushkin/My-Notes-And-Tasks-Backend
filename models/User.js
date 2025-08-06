import mongoose from 'mongoose';
import { fieldEncryption } from 'mongoose-field-encryption';

const Schema = mongoose.Schema;

// Enhanced push subscription schema with device tracking
const pushSubscriptionSchema = new mongoose.Schema({
    endpoint: {
        type: String,
        required: true
        // Note: index removed from here to avoid duplicate index warning
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
    deviceId: {
        type: String
        // Note: index removed from here to avoid duplicate index warning  
    },
    userAgent: {
        type: String,
        default: 'unknown'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    lastUsed: {
        type: Date,
        default: Date.now
    }
});

// Sync preferences schema
const syncPreferencesSchema = new mongoose.Schema({
    autoSync: {
        type: Boolean,
        default: true
    },
    syncInterval: {
        type: Number,
        default: 300000, // 5 minutes
        min: 60000,     // 1 minute minimum
        max: 3600000    // 1 hour maximum
    },
    conflictResolution: {
        type: String,
        enum: ['client_wins', 'server_wins', 'timestamp_wins', 'manual'],
        default: 'timestamp_wins'
    },
    backgroundSync: {
        type: Boolean,
        default: true
    },
    crossDeviceNotifications: {
        type: Boolean,
        default: true
    }
});

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
    
    // Enhanced push notification subscriptions with device tracking
    pushSubscriptions: [pushSubscriptionSchema],
    
    // NEW: Sync preferences
    syncPreferences: {
        type: syncPreferencesSchema,
        default: () => ({})
    },
    
    // NEW: Device and sync metadata
    deviceMetadata: {
        totalDevices: {
            type: Number,
            default: 0
        },
        lastSyncTime: {
            type: Date,
            default: null
        },
        syncVersion: {
            type: String,
            default: '1.0.0'
        }
    },
    
    // NEW: Notification preferences for PWA
    notificationPreferences: {
        email: {
            reminders: { type: Boolean, default: true },
            deviceSync: { type: Boolean, default: false },
            security: { type: Boolean, default: true }
        },
        push: {
            reminders: { type: Boolean, default: true },
            deviceSync: { type: Boolean, default: false },
            crossDevice: { type: Boolean, default: true }
        },
        inApp: {
            reminders: { type: Boolean, default: true },
            syncStatus: { type: Boolean, default: true }
        }
    },
    
    // NEW: Usage statistics
    usageStats: {
        lastLoginAt: {
            type: Date,
            default: null
        },
        loginCount: {
            type: Number,
            default: 0
        },
        totalSyncs: {
            type: Number,
            default: 0
        },
        lastActiveDevice: {
            type: String,
            default: null
        }
    },
    
    // YOUR EXISTING FIELDS (preserved exactly)
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

// FIXED: Add indexes properly using schema.index() to avoid duplicates
userSchema.index({ 'pushSubscriptions.endpoint': 1 });
userSchema.index({ 'pushSubscriptions.deviceId': 1 });
userSchema.index({ 'usageStats.lastLoginAt': -1 });

// NEW: Virtual for active push subscriptions
userSchema.virtual('activePushSubscriptions').get(function() {
    return this.pushSubscriptions.filter(sub => sub.isActive !== false);
});

// NEW: Virtual for total active devices
userSchema.virtual('activeDevicesCount').get(function() {
    return this.activePushSubscriptions.length;
});

// NEW: Virtual for last sync time formatted
userSchema.virtual('lastSyncFormatted').get(function() {
    if (!this.deviceMetadata.lastSyncTime) return 'Never';
    
    const now = new Date();
    const diff = now - this.deviceMetadata.lastSyncTime;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
});

// PRESERVED: Your original timestamp behavior
userSchema.pre('save', function (next) {
    if (this.isModified()) this.updatedAt = Date.now();
    
    // NEW: Update device count for PWA sync
    this.deviceMetadata.totalDevices = this.activePushSubscriptions.length;
    
    // NEW: Update push subscription timestamps
    this.pushSubscriptions.forEach(sub => {
        if (sub.isModified() || sub.isNew) {
            sub.updatedAt = new Date();
        }
    });
    
    next();
});

// PRESERVED: Your original toJSON behavior
userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

// NEW: PWA Sync Methods

/**
 * Add or update push subscription with device tracking
 */
userSchema.methods.addPushSubscription = function(subscriptionData, deviceId = null) {
    const existing = this.pushSubscriptions.find(
        sub => sub.endpoint === subscriptionData.endpoint
    );
    
    if (existing) {
        existing.keys = subscriptionData.keys;
        existing.deviceId = deviceId;
        existing.updatedAt = new Date();
        existing.lastUsed = new Date();
        existing.isActive = true;
    } else {
        this.pushSubscriptions.push({
            endpoint: subscriptionData.endpoint,
            keys: subscriptionData.keys,
            deviceId,
            userAgent: subscriptionData.userAgent || 'unknown',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastUsed: new Date()
        });
    }
    
    return this.save();
};

/**
 * Remove push subscription
 */
userSchema.methods.removePushSubscription = function(endpoint) {
    this.pushSubscriptions = this.pushSubscriptions.filter(
        sub => sub.endpoint !== endpoint
    );
    return this.save();
};

/**
 * Update push subscription activity
 */
userSchema.methods.updateSubscriptionActivity = function(endpoint) {
    const subscription = this.pushSubscriptions.find(
        sub => sub.endpoint === endpoint
    );
    if (subscription) {
        subscription.lastUsed = new Date();
        return this.save();
    }
    return Promise.resolve(this);
};

/**
 * Deactivate push subscriptions for a device
 */
userSchema.methods.deactivateDeviceSubscriptions = function(deviceId) {
    this.pushSubscriptions.forEach(sub => {
        if (sub.deviceId === deviceId) {
            sub.isActive = false;
        }
    });
    return this.save();
};

/**
 * Update sync preferences
 */
userSchema.methods.updateSyncPreferences = function(preferences) {
    this.syncPreferences = { ...this.syncPreferences.toObject(), ...preferences };
    this.markModified('syncPreferences');
    return this.save();
};

/**
 * Update notification preferences
 */
userSchema.methods.updateNotificationPreferences = function(preferences) {
    this.notificationPreferences = { 
        ...this.notificationPreferences.toObject(), 
        ...preferences 
    };
    this.markModified('notificationPreferences');
    return this.save();
};

/**
 * Record login activity
 */
userSchema.methods.recordLogin = function(deviceId = null) {
    this.usageStats.lastLoginAt = new Date();
    this.usageStats.loginCount += 1;
    if (deviceId) {
        this.usageStats.lastActiveDevice = deviceId;
    }
    return this.save();
};

/**
 * Record sync activity
 */
userSchema.methods.recordSync = function() {
    this.usageStats.totalSyncs += 1;
    this.deviceMetadata.lastSyncTime = new Date();
    return this.save();
};

/**
 * Clean up inactive push subscriptions
 */
userSchema.methods.cleanupInactiveSubscriptions = function(daysInactive = 30) {
    const cutoffDate = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000);
    
    this.pushSubscriptions = this.pushSubscriptions.filter(sub => {
        return sub.lastUsed && sub.lastUsed > cutoffDate;
    });
    
    return this.save();
};

/**
 * Get user sync status
 */
userSchema.methods.getSyncStatus = function() {
    return {
        totalDevices: this.deviceMetadata.totalDevices,
        activeSubscriptions: this.activePushSubscriptions.length,
        lastSync: this.deviceMetadata.lastSyncTime,
        lastSyncFormatted: this.lastSyncFormatted,
        syncVersion: this.deviceMetadata.syncVersion,
        preferences: this.syncPreferences
    };
};

// NEW: Static methods for PWA sync

/**
 * Find users with push subscriptions
 */
userSchema.statics.findUsersWithPushSubscriptions = function() {
    return this.find({
        'pushSubscriptions.0': { $exists: true },
        isVerified: true
    });
};

/**
 * Find users by device ID
 */
userSchema.statics.findByDeviceId = function(deviceId) {
    return this.find({
        'pushSubscriptions.deviceId': deviceId,
        isVerified: true
    });
};

/**
 * Get sync statistics
 */
userSchema.statics.getSyncStatistics = function() {
    return this.aggregate([
        { $match: { isVerified: true } },
        {
            $project: {
                totalDevices: '$deviceMetadata.totalDevices',
                totalSyncs: '$usageStats.totalSyncs',
                hasActiveSubscriptions: { 
                    $gt: [{ $size: { $ifNull: ['$pushSubscriptions', []] } }, 0] 
                }
            }
        },
        {
            $group: {
                _id: null,
                totalUsers: { $sum: 1 },
                usersWithDevices: { 
                    $sum: { $cond: ['$hasActiveSubscriptions', 1, 0] } 
                },
                totalDevices: { $sum: '$totalDevices' },
                totalSyncs: { $sum: '$totalSyncs' },
                avgDevicesPerUser: { $avg: '$totalDevices' },
                avgSyncsPerUser: { $avg: '$totalSyncs' }
            }
        }
    ]);
};

/**
 * Clean up all inactive subscriptions
 */
userSchema.statics.cleanupAllInactiveSubscriptions = function(daysInactive = 30) {
    const cutoffDate = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000);
    
    return this.updateMany(
        { 
            isVerified: true,
            'pushSubscriptions.lastUsed': { $lt: cutoffDate }
        },
        {
            $pull: {
                pushSubscriptions: {
                    lastUsed: { $lt: cutoffDate }
                }
            }
        }
    );
};

// PRESERVED: Encrypt notesTree field with UTF-8 support
userSchema.plugin(fieldEncryption, {
    fields: ['notesTree'],
    secret: process.env.DATA_ENCRYPTION_SECRET,
    // Enable UTF-8 support for Hebrew and other Unicode characters
    encryptNull: false,
    useAuthTag: true
});

export default mongoose.model('User', userSchema);