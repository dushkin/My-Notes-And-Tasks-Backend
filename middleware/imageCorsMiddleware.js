// middleware/imageCorsMiddleware.js
import logger from '../config/logger.js';

const imageCorsMiddleware = (req, res, next) => {
    // Get allowed origins from environment
    const allowedOriginsStr = process.env.ALLOWED_ORIGINS || '';
    const allowedOriginsList = allowedOriginsStr ? 
        allowedOriginsStr.split(',').map(origin => origin.trim()) : 
        ['http://localhost:3000', 'http://localhost:5173']; // Default for development
    
    const origin = req.headers.origin;
    
    logger.debug('Image CORS middleware processing request', {
        origin,
        path: req.path,
        method: req.method,
        allowedOrigins: allowedOriginsList
    });
    
    // Set CORS headers for image requests
    if (!origin) {
        // Allow requests with no origin (direct URL access, mobile apps, etc.)
        res.header('Access-Control-Allow-Origin', '*');
    } else if (allowedOriginsStr === '' || allowedOriginsList.includes('*') || allowedOriginsList.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        logger.warn('Image CORS: Origin not allowed', { origin, allowedOrigins: allowedOriginsList });
        // Still serve the image but without CORS headers
        // This maintains security while allowing direct access
    }
    
    // Set other CORS headers
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    
    // Set cache headers for images
    if (req.path.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
        res.header('Cache-Control', 'public, max-age=31536000'); // 1 year
        res.header('Vary', 'Origin');
    }
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        logger.debug('Image CORS: Handling preflight request', { origin, path: req.path });
        res.sendStatus(200);
        return;
    }
    
    next();
};

export default imageCorsMiddleware;