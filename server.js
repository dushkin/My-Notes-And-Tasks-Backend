// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron'); // Import node-cron
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const itemsRoutes = require('./routes/itemsRoutes');
const imageRoutes = require('./routes/imageRoutes');
const { cleanupOrphanedImages } = require('./services/orphanedFileCleanupService'); // Import cleanup function
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const app = express();

if (process.env.NODE_ENV !== 'test') {
  connectDB();
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/images', imageRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/', (req, res) => res.send('API Running'));

app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack || err.message || err);
  res.status(err.status || 500).json({
    message: err.message || 'An unexpected error occurred on the server.',
  });
});

const PORT = process.env.PORT || 5001;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Uploaded images will be served from '/uploads/images' (relative to server root, via 'public' static folder).`);
    console.log(`Ensure your frontend's API_BASE_URL for image uploads is correctly set to this server.`);

    // Schedule orphaned image cleanup
    // Runs once a day at 3:00 AM. You can change the schedule.
    // Cron pattern: second(optional) minute hour day-of-month month day-of-week
    // See https://www.npmjs.com/package/node-cron for more patterns
    cron.schedule('0 3 * * *', () => {
      console.log(`[${new Date().toISOString()}] Running scheduled task: cleanupOrphanedImages`);
      cleanupOrphanedImages().catch(err => { // Ensure any promise rejection from cleanup is caught
        console.error(`[${new Date().toISOString()}] Scheduled cleanupOrphanedImages task encountered an unhandled error:`, err);
      });
    }, {
      scheduled: true,
      timezone: "Asia/Jerusalem" // Example: Set your server's timezone. Use IANA timezone names.
    });
    console.log("Orphaned image cleanup job scheduled daily at 3:00 AM (Asia/Jerusalem).");

    // If you want to test it on startup (for development only):
    if (process.env.NODE_ENV === 'development' && process.env.RUN_CLEANUP_ON_START === 'true') {
      console.log('Running cleanup job on startup for development...');
      cleanupOrphanedImages();
    }
  });
}

module.exports = app;