const jwt = require('jsonwebtoken');

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Not authorized, no token' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('[authMiddleware.js] Auth Middleware Error:', {
            message: error.message,
            stack: error.stack,
            token: req.header('Authorization')?.replace('Bearer ', 'REDACTED'),
            jwtSecret: process.env.JWT_SECRET ? 'SET' : 'UNSET'
        });
        res.status(401).json({ error: 'Not authorized, invalid token' });
    }
};

module.exports = authMiddleware;