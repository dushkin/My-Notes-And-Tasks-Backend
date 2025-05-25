// controllers/authController.js
const User = require('../models/User');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateToken } = require('../utils/jwt');

exports.register = async (req, res) => {
    const { email, password } = req.body;

    // Input validation is now primarily handled by express-validator in authRoutes.js

    try {
        // Check if user already exists
        let user = await User.findOne({ email: email.toLowerCase() }); // email is already trimmed and normalized by validator
        if (user) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        // Hash Password
        const hashedPassword = await hashPassword(password);
        // Create and Save User
        user = new User({
            email: email.toLowerCase(), // email is already trimmed and normalized
            password: hashedPassword,
        });
        await user.save();

        // Generate JWT
        const token = generateToken(user.id);

        // Send Response
        res.status(201).json({ token, user });
    } catch (err) {
        console.error('Registration Error:', err.message);
        if (err.name === 'ValidationError') { // Mongoose validation error
            const messages = Object.values(err.errors).map(val => val.message);
            return res.status(400).json({ error: messages.join(', ') });
        }
        res.status(500).json({ error: 'Server error during registration' });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    // Input validation is now primarily handled by express-validator in authRoutes.js

    try {
        // Find User
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password'); // email is already trimmed and normalized
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Compare Passwords
        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = generateToken(user.id);
        // Send Response
        const userResponse = await User.findById(user.id);
        res.status(200).json({ token, user: userResponse });

    } catch (err) {
        console.error('Login Error:', err.message);
        res.status(500).json({ error: 'Server error during login' });
    }
};