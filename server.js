// server.js (Updated)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const swaggerUi = require('swagger-ui-express'); // Import swagger-ui-express
const swaggerSpec = require('./config/swagger'); // Import your swagger config

// --- Connect to Database ---
connectDB();

const app = express();
const PORT = process.env.PORT || 5001;

// --- Middleware ---
app.use(cors(/* Configure options for production */));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Swagger Documentation Route ---
// This route should ideally be placed *before* your main API routes if '/api' is your base
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  // Optional: Custom options for Swagger UI
  // explorer: true, // Enables the search bar
  // customCssUrl: '/custom-swagger.css' // Path to custom CSS
}));

// --- API Routes ---
app.get('/api', (req, res) => {
  res.send('Notes & Tasks Backend API');
});

// Mount Authentication routes (under /api base path specified in swagger config)
app.use('/api/auth', authRoutes);

// TODO: Add Protected routes (e.g., /api/notes, /api/tasks)

// --- Error Handling Middleware ---
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send({ error: 'Something went wrong!' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Swagger Docs available at http://localhost:${PORT}/api-docs`); // Log docs URL
});