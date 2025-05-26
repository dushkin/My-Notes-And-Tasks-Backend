const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoURI = process.env.DATABASE_URL;
  console.log(`[config/db.js] Attempting to connect to MongoDB URI: ${mongoURI}`);

  if (!mongoURI) {
    const errorMessage = 'FATAL ERROR: DATABASE_URL is not defined in .env file or process.env.';
    console.error(errorMessage);
    if (process.env.NODE_ENV === 'test') {
      throw new Error(errorMessage);
    } else {
      process.exit(1);
    }
  }

  if (mongoose.connection.readyState === 1 && mongoose.connections[0].client.s.url === mongoURI) {
    console.log('[config/db.js] Already connected to the target URI.');
    return;
  }

  try {
    await mongoose.connect(mongoURI, {
    });
    console.log('[config/db.js] MongoDB Connected via mongoose.connect.');
  } catch (err) {
    console.error('[config/db.js] MongoDB Connection Error:', err.message, err.stack);
    if (process.env.NODE_ENV === 'test') {
      throw err;
    } else {
      process.exit(1);
    }
  }
};

module.exports = connectDB;