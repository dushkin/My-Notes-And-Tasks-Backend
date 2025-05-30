const { verifyAccessToken } = require('../utils/jwt');

const authMiddleware = async (req, res, next) => {
    console.log('authMiddleware: Processing request for', req.path);
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            console.log('authMiddleware: No Authorization header');
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.replace('Bearer ', '');
        console.log('authMiddleware: Token extracted:', token);

        const decoded = verifyAccessToken(token);
        console.log('authMiddleware: Decoded JWT:', decoded);

        if (!decoded || !decoded.user || !decoded.user.id) {
            console.log('authMiddleware: Invalid decoded payload');
            return res.status(401).json({ error: 'Not authorized, token failed' });
        }

        const User = require('../models/User');
        const user = await User.findById(decoded.user.id);
        if (!user) {
            console.log('authMiddleware: User not found');
            return res.status(401).json({ error: 'Not authorized, user not found' });
        }

        req.user = user;
        console.log('authMiddleware: User attached:', user.email);
        next();
    } catch (err) {
        console.error('authMiddleware: Error:', err.message);
        res.status(401).json({ error: 'Not authorized, token failed' });
    }
};

module.exports = authMiddleware;