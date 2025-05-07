// controllers/authController.js
const User = require('../models/User');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateToken } = require('../utils/jwt');

exports.register = async (req, res) => {
    const { email, password } = req.body;

    // --- Basic Input Validation ---
    if (!email || !password) {
        return res.status(400).json({ error: 'Please provide email and password' });
    }
    // Add more robust validation as needed (e.g., email format, password strength)
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    try {
        // --- Check if user already exists ---
        let user = await User.findOne({ email: email.toLowerCase() });
        if (user) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        // --- Hash Password ---
        const hashedPassword = await hashPassword(password);

        // --- Create and Save User ---
        // Note: The notesTree will default to [] based on the schema
        user = new User({
            email: email.toLowerCase(),
            password: hashedPassword,
        });

        await user.save();

        // --- Generate JWT ---
        const token = generateToken(user.id); // user.id is the MongoDB _id

        // --- Send Response ---
        // Return token and user object (password is removed by toJSON method in schema)
        res.status(201).json({ token, user });

    } catch (err) {
        console.error('Registration Error:', err.message);
        if (err.name === 'ValidationError') {
            // Extract specific validation errors if needed
            const messages = Object.values(err.errors).map(val => val.message);
            return res.status(400).json({ error: messages.join(', ') });
        }
        res.status(500).json({ error: 'Server error during registration' });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    // --- Basic Input Validation ---
    if (!email || !password) {
        return res.status(400).json({ error: 'Please provide email and password' });
    }

    try {
        // --- Find User ---
        // Explicitly select the password field as it might be excluded by default in some setups
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

        if (!user) {
            // Generic error message for security (don't reveal if email exists)
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // --- Compare Passwords ---
        const isMatch = await comparePassword(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // --- Generate JWT ---
        const token = generateToken(user.id);

        // --- Send Response ---
        // Find the user again *without* the password to send back
        const userResponse = await User.findById(user.id);

        res.status(200).json({ token, user: userResponse });

    } catch (err) {
        console.error('Login Error:', err.message);
        res.status(500).json({ error: 'Server error during login' });
    }
};