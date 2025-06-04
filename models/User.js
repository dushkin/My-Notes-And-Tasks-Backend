// models/User.js
import mongoose from 'mongoose'; // Changed from require
const Schema = mongoose.Schema; // [cite: 173, 184]

const userSchema = new Schema({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/\S+@\S+\.\S+/, 'Please use a valid email address'],
        index: true, // [cite: 174, 185]
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [8, 'Password must be at least 8 characters long'],
    },
    notesTree: {
        type: Schema.Types.Mixed,
        default: [], // [cite: 175, 186]
    },
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
    var obj = this.toObject(); // [cite: 177, 188]
    delete obj.password; // [cite: 178, 189]
    return obj; // [cite: 178, 189]
};

// Changed from module.exports
export default mongoose.model('User', userSchema);