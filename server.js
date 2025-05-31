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

const isTestEnv = process.env.NODE_ENV === 'test';

if (!isTestEnv) {
    // Only connect to your production database when not testing  
    mongoose
        .connect(process.env.DATABASE_URL, {
            serverSelectionTimeoutMS: 30000
            // removed deprecated options like useNewUrlParser and useUnifiedTopology
        })
        .then(() => {
            console.log('Connected to MongoDB');
        })
        .catch((err) => {
            console.error('MongoDB connection error:', err.message);
            process.exit(1);
        });
} else {
    console.log('Test environment detected. Skipping Mongoose connection in server.js.');
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : '*';
  
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS.split(','),
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
console.log('CORS middleware initialized with origins:', corsOptions.origin);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Register routes
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

// Only start listening if the module is executed directly.
if (require.main === module) {
    const PORT = process.env.PORT || 5001;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        // Optional: log all registered routes.
    });
}

module.exports = app;
