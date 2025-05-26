const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const refreshTokenSchema = new Schema({
    jti: { type: String, required: true, index: true }, // JWT ID, unique identifier for the token
    token: { type: String, required: true }, // Store the refresh token itself, or a hash of it
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    // Optional: For tracking device/IP from which it was issued
    // ipAddress: String,
    // userAgent: String,
});

const userSchema = new Schema({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/\S+@\S+\.\S+/, 'Please use a valid email address'],
        index: true,
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [8, 'Password must be at least 8 characters long'],
    },
    notesTree: {
        type: Schema.Types.Mixed,
        default: [],
    },
    refreshTokens: [refreshTokenSchema], // Array to store active refresh tokens
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

userSchema.pre('save', function (next) {
    if (this.isModified()) {
        this.updatedAt = Date.now();
    }
    next();
});

userSchema.methods.toJSON = function () {
    var obj = this.toObject();
    delete obj.password;
    // Decide if you want to send refreshTokens to the client in user object
    // delete obj.refreshTokens; 
    return obj;
}

module.exports = mongoose.model('User', userSchema);