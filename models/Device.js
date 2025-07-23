import mongoose from 'mongoose';

const DeviceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    deviceId: {
        type: String,
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    type: {
        type: String,
        required: true,
        enum: ['iOS', 'Android', 'macOS', 'Windows', 'Linux', 'Unknown'],
        index: true
    },
    platform: {
        type: String,
        required: true,
        trim: true
    },
    userAgent: {
        type: String,
        required: true,
        trim: true
    },
    capabilities: {
        pushNotifications: {
            type: Boolean,
            default: false
        },
        backgroundSync: {
            type: Boolean,
            default: false
        },
        indexedDB: {
            type: Boolean,
            default: false
        },
        serviceWorker: {
            type: Boolean,
            default: false
        },
        offlineSupport: {
            type: Boolean,
            default: false
        }
    },
    lastActive: {
        type: Date,
        default: Date.now,
        index: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    syncSettings: {
        autoSync: {
            type: Boolean,
            default: true
        },
        syncInterval: {
            type: Number,
            default: 300000, // 5 minutes
            min: 60000,     // 1 minute minimum
            max: 3600000    // 1 hour maximum
        }
    },
    notificationSettings: {
        enabled: {
            type: Boolean,
            default: true
        },
        reminderNotifications: {
            type: Boolean,
            default: true
        },
        syncNotifications: {
            type: Boolean,
            default: false
        }
    },
    metadata: {
        timezone: String,
        language: String,
        version: String
    },
    removedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true }
});

// Compound indexes
DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
DeviceSchema.index({ userId: 1, isActive: 1, lastActive: -1 });

// Virtual for checking if device is recently active
DeviceSchema.virtual('isRecentlyActive').get(function () {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return this.lastActive && this.lastActive > fiveMinutesAgo;
});

// Virtual for device icon
DeviceSchema.virtual('icon').get(function () {
    const icons = {
        'iOS': '📱',
        'Android': '🤖',
        'macOS': '💻',
        'Windows': '🖥️',
        'Linux': '🐧'
    };
    return icons[this.type] || '📱';
});

// Static method to find active devices for user
DeviceSchema.statics.findActiveForUser = function (userId) {
    return this.find({
        userId,
        isActive: true,
        removedAt: null
    }).sort({ lastActive: -1 });
};

const Device = mongoose.model('Device', DeviceSchema);

export default Device;