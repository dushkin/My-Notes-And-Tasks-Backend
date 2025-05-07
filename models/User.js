// models/User.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true, // Ensure emails are unique
        lowercase: true, // Store emails in lowercase
        trim: true, // Remove whitespace
        match: [/\S+@\S+\.\S+/, 'Please use a valid email address'], // Basic email format validation
        index: true, // Add an index for faster querying by email
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [8, 'Password must be at least 8 characters long'], // Enforce minimum length
    },
    // Store the user's notes/tasks tree directly within the user document
    // It defaults to an empty array, matching the frontend's initial state expectation
    notesTree: {
        type: Schema.Types.Mixed, // Allows storing arbitrary nested objects/arrays
        default: [],
    },
    // Optional: Add timestamps for creation and updates
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Middleware to update the 'updatedAt' field on save
userSchema.pre('save', function (next) {
    if (this.isModified()) { // only update if the document was modified
        this.updatedAt = Date.now();
    }
    next();
});


// IMPORTANT: Selectively remove password field when converting document to JSON
userSchema.methods.toJSON = function () {
    var obj = this.toObject(); // or var obj = this._doc;
    delete obj.password; // remove password hash from responses
    return obj;
}

module.exports = mongoose.model('User', userSchema);