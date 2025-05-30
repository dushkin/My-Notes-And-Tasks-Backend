require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

console.log('Environment Variables:', {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    FRONTEND_URL: process.env.FRONTEND_URL,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
    BACKEND_URL: process.env.BACKEND_URL,
    DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Not set'
});

// Connect to MongoDB
mongoose.connect(process.env.DATABASE_URL, {
    serverSelectionTimeoutMS: 30000
}).then(() => {
    console.log('Connected to MongoDB');
}).catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
});

const corsOptions = {
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
console.log('CORS middleware initialized with origins:', corsOptions.origin);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

try {
    console.log('Loading authRoutes...');
    const authRoutes = require('./routes/authRoutes');
    app.use('/api/auth', authRoutes);
    console.log('authRoutes registered successfully');
} catch (err) {
    console.error('Error registering authRoutes:', err.stack);
    throw err;
}

try {
    console.log('Loading itemsRoutes...');
    const itemsRoutes = require('./routes/itemsRoutes');
    app.use('/api/items', itemsRoutes);
    console.log('itemsRoutes registered successfully');
} catch (err) {
    console.error('Error registering itemsRoutes:', err.stack);
    throw err;
}

try {
    console.log('Loading imageRoutes...');
    const imageRoutes = require('./routes/imageRoutes');
    app.use('/api/images', imageRoutes);
    console.log('imageRoutes registered successfully');
} catch (err) {
    console.error('Error registering imageRoutes:', err.stack);
    throw err;
}

app.get('/', (req, res) => res.send('API Running'));

// Log registered routes after server starts
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Alternative route logging for Express 4.x/5.x
    try {
        const stack = app._router ? app._router.stack : app.stack;
        if (stack) {
            stack.forEach((layer) => {
                if (layer.route && layer.route.path) {
                    console.log('Registered route:', layer.route.path, layer.route.methods);
                } else if (layer.name === 'router' && layer.handle.stack) {
                    const prefix = layer.regexp.toString().replace(/.*\/(.*?)\/\.\*/, '$1') || '';
                    layer.handle.stack.forEach((subLayer) => {
                        if (subLayer.route && subLayer.route.path) {
                            const fullPath = `/api${prefix}${subLayer.route.path}`;
                            console.log('Registered sub-route:', fullPath, subLayer.route.methods);
                        }
                    });
                }
            });
        } else {
            console.error('Router stack not available. Ensure Express is properly initialized.');
        }
    } catch (err) {
        console.error('Error logging routes:', err.message);
    }
});