// controllers/authController.js
const User = require('../models/User');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateToken } = require('../utils/jwt');

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = generateToken(user.id);
        
        // Send Response with both accessToken and refreshToken
        const userResponse = await User.findById(user.id);
        res.status(200).json({ 
            accessToken: token,    // ← Change this
            refreshToken: token,   // ← Add this (for now, same token)
            user: userResponse 
        });

    } catch (err) {
        console.error('Login Error:', err.message);
        res.status(500).json({ error: 'Server error during login' });
    }
};

// Also update the register function similarly
exports.register = async (req, res) => {
    const { email, password } = req.body;

    try {
        let user = await User.findOne({ email: email.toLowerCase() });
        if (user) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        const hashedPassword = await hashPassword(password);
        user = new User({
            email: email.toLowerCase(),
            password: hashedPassword,
        });
        await user.save();

        const token = generateToken(user.id);

        // Send Response with both accessToken and refreshToken
        res.status(201).json({ 
            accessToken: token,    // ← Change this
            refreshToken: token,   // ← Add this
            user 
        });
    } catch (err) {
        console.error('Registration Error:', err.message);
        if (err.name === 'ValidationError') {
            const messages = Object.values(err.errors).map(val => val.message);
            return res.status(400).json({ error: messages.join(', ') });
        }
        res.status(500).json({ error: 'Server error during registration' });
    }
};