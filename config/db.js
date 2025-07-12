// config/db.js
import mongoose from 'mongoose'; // Assuming ESM, changed from require
import logger from './logger.js'; // Import the logger

const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI;

  if (!mongoURI) {
    logger.error('FATAL ERROR: MONGODB_URI is not set.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoURI);
    logger.info('✅ MongoDB connected successfully.');
  } catch (error) {
    logger.error('❌ MongoDB Connection Error:', {
      message: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
};

export default connectDB;