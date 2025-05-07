// server.js
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5001; // Use environment variable or default

// --- Middleware ---
// Enable CORS for requests from your frontend origin
// TODO: Configure CORS more restrictively for production
app.use(cors());
// Parse JSON request bodies
app.use(express.json());
// Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// --- Basic Routes (Placeholder) ---
app.get('/', (req, res) => {
    res.send('Notes & Tasks Backend API');
});

// TODO: Add Authentication routes (/api/auth/register, /api/auth/login)
// TODO: Add Protected routes (e.g., /api/notes, /api/tasks)

// --- Error Handling Middleware (Basic) ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send({ error: 'Something went wrong!' });
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // TODO: Add Database connection logic here
});