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

// Configure CORS
const allowedOrigins = [
  'http://localhost:3000', // Your local frontend dev URL (if different)
  'http://localhost:5173', // Vite's default local dev URL
  'https://my-notes-and-tasks-f3bd3.web.app' // IMPORTANT: Replace with your actual deployed frontend URL
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  optionsSuccessStatus: 200, // For legacy browser compatibility
  credentials: true // If you plan to use cookies or authorization headers
};

app.use(cors(corsOptions));
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