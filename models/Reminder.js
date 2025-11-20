import mongoose from 'mongoose';

const ReminderSchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true
    },
    itemId: { 
      type: String, 
      required: true,
      index: true
    },
    itemTitle: { 
      type: String, 
      required: true 
    },
    timestamp: { 
      type: Date, 
      required: true,
      index: true
    },
    repeatOptions: {
      type: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'yearly']
      },
      interval: {
        type: Number,
        default: 1,
        min: 1
      },
      endDate: {
        type: Date,
        default: null
      },
      daysOfWeek: [{
        type: Number,
        min: 0,
        max: 6
      }] // For weekly repeats, 0 = Sunday
    },
    snoozedUntil: { 
      type: Date, 
      default: null 
    },
    enabled: { 
      type: Boolean, 
      default: true,
      index: true
    },
    deviceId: { 
      type: String, 
      default: null 
    },
    lastTriggered: { 
      type: Date, 
      default: null 
    },
    triggerCount: { 
      type: Number, 
      default: 0 
    }
  },
  { 
    timestamps: true,
    // Add compound indexes for efficient queries
    indexes: [
      { userId: 1, itemId: 1 }, // Unique reminder per user per item
      { userId: 1, timestamp: 1, enabled: 1 }, // For finding due reminders
      { userId: 1, enabled: 1 }, // For listing active reminders
    ]
  }
);

// Ensure only one active reminder per item per user
ReminderSchema.index({ userId: 1, itemId: 1 }, { unique: true });

// Methods for handling repeat logic
ReminderSchema.methods.getNextOccurrence = function() {
  if (!this.repeatOptions) return null;

  const { type, interval, endDate, daysOfWeek } = this.repeatOptions;
  const baseDate = this.snoozedUntil || this.timestamp;
  let nextDate = new Date(baseDate);
  
  switch (type) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + interval);
      break;
      
    case 'weekly':
      if (daysOfWeek && daysOfWeek.length > 0) {
        // Find next occurrence on specified days of week
        const currentDay = nextDate.getDay();
        const sortedDays = [...daysOfWeek].sort((a, b) => a - b);
        
        // Find next day in the same week
        let nextDay = sortedDays.find(day => day > currentDay);
        
        if (nextDay !== undefined) {
          nextDate.setDate(nextDate.getDate() + (nextDay - currentDay));
        } else {
          // Move to next week, first day in the list
          const daysUntilNextWeek = 7 - currentDay + sortedDays[0];
          nextDate.setDate(nextDate.getDate() + daysUntilNextWeek);
          // Add additional weeks if interval > 1
          nextDate.setDate(nextDate.getDate() + (interval - 1) * 7);
        }
      } else {
        nextDate.setDate(nextDate.getDate() + (interval * 7));
      }
      break;
      
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + interval);
      break;
      
    case 'yearly':
      nextDate.setFullYear(nextDate.getFullYear() + interval);
      break;
  }
  
  // Check if next occurrence exceeds end date
  if (endDate && nextDate > endDate) {
    return null;
  }
  
  return nextDate;
};

ReminderSchema.methods.shouldRepeat = function() {
  return this.repeatOptions !== null && this.enabled;
};

ReminderSchema.methods.markTriggered = function() {
  this.lastTriggered = new Date();
  this.triggerCount += 1;
  
  // If it's a repeating reminder, schedule next occurrence
  if (this.shouldRepeat()) {
    const nextOccurrence = this.getNextOccurrence();
    if (nextOccurrence) {
      this.timestamp = nextOccurrence;
      this.snoozedUntil = null; // Clear snooze when moving to next occurrence
    } else {
      this.enabled = false; // Disable if no more occurrences
    }
  } else {
    this.enabled = false; // Disable one-time reminders after triggering
  }
  
  return this.save();
};

ReminderSchema.methods.snooze = function(minutes) {
  this.snoozedUntil = new Date(Date.now() + minutes * 60 * 1000);
  return this.save();
};

// Static methods for queries
ReminderSchema.statics.findDueReminders = function(userId = null) {
  const now = new Date();
  const query = {
    enabled: true,
    $or: [
      { snoozedUntil: null, timestamp: { $lte: now } },
      { snoozedUntil: { $lte: now } }
    ]
  };
  
  if (userId) {
    query.userId = userId;
  }
  
  return this.find(query).sort({ timestamp: 1 });
};

ReminderSchema.statics.findUserReminders = function(userId, activeOnly = true) {
  const query = { userId };
  if (activeOnly) {
    query.enabled = true;
  }
  return this.find(query).sort({ timestamp: 1 });
};

ReminderSchema.statics.findByUserAndItem = function(userId, itemId) {
  return this.findOne({ userId, itemId });
};

ReminderSchema.statics.deleteByUserAndItem = function(userId, itemId) {
  return this.deleteOne({ userId, itemId });
};

// Clean up expired reminders
ReminderSchema.statics.cleanupExpiredReminders = function(daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return this.deleteMany({
    enabled: false,
    lastTriggered: { $lt: cutoffDate }
  });
};

const Reminder = mongoose.model("Reminder", ReminderSchema);
export default Reminder;
