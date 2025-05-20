// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path'); // Added for static file serving and path joining
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const itemsRoutes = require('./routes/itemsRoutes');
const imageRoutes = require('./routes/imageRoutes'); // Added new image routes
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const app = express();

// Connect Database ONLY if not in test environment
if (process.env.NODE_ENV !== 'test') {
  connectDB();
}

// Init Middleware
app.use(cors());

// IMPORTANT: Apply body parsing middleware with limits BEFORE routes that need them.
// The { extended: false } for express.json is not a standard option,
// express.json() doesn't take 'extended'. 'extended' is for urlencoded.
// Also, ensure these are defined before any routes that might receive large bodies.
app.use(express.json({ limit: '10mb' })); // For JSON payloads
app.use(express.urlencoded({ limit: '10mb', extended: true })); // For URL-encoded payloads

// --- Static File Serving ---
// Serve files from the 'public' directory (e.g., uploaded images)
// This should come before route definitions if routes might conflict with static file paths,
// but after body parsers.
app.use(express.static(path.join(__dirname, 'public')));

// Define Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/images', imageRoutes); // Mount the image routes
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


app.get('/', (req, res) => res.send('API Running'));

// --- Basic Error Handling (optional, but good practice, place after all routes) ---
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack || err.message || err);
  res.status(err.status || 500).json({
    message: err.message || 'An unexpected error occurred on the server.',
    // error: process.env.NODE_ENV === 'development' ? err.stack : {} // Only show stack in dev
  });
});


const PORT = process.env.PORT || 5001;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Uploaded images will be served from '/uploads/images' (relative to server root, via 'public' static folder).`);
    console.log(`Ensure your frontend's API_BASE_URL for image uploads is correctly set to this server.`);
  });
}

module.exports = app; // Export app for testing or other programmatic uses