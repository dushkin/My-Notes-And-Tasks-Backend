// models/RefreshToken.js
import mongoose from 'mongoose'; // Changed from require
const Schema = mongoose.Schema;

const refreshTokenSchema = new Schema({
    token: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expireAfterSeconds: 0 } // Auto-delete when expired
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastUsed: {
        type: Date,
        default: Date.now
    },
    isRevoked: {
        type: Boolean,
        default: false,
        index: true
    },
    deviceInfo: {
        userAgent: String,
        ip: String
    }
});

refreshTokenSchema.index({ userId: 1, isRevoked: 1 }); // [cite: 172, 183]

// Changed from module.exports
export default mongoose.model('RefreshToken', refreshTokenSchema);