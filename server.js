// server.js (Relevant parts updated)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const itemsRoutes = require('./routes/itemsRoutes');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// --- Connect to Database ---
connectDB();

const app = express();
const PORT = process.env.PORT || 5001;

// --- Middleware ---
app.use(cors(/* Configure options for production */));
app.use(express.json({ limit: '10mb' })); // Increase JSON body limit if trees might be large
app.use(express.urlencoded({ limit: '10mb', extended: true })); // Increase URL-encoded limit too


// --- Swagger Documentation Route ---
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- API Routes ---
app.get('/api', (req, res) => {
  res.send('Notes & Tasks Backend API');
});

// Mount Authentication routes
app.use('/api/auth', authRoutes);
// Mount Items routes (protected by middleware defined within itemsRoutes.js)
app.use('/api/items', itemsRoutes);


// --- Error Handling Middleware ---
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send({ error: 'Something went wrong!' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Swagger Docs available at http://localhost:${PORT}/api-docs`);
});