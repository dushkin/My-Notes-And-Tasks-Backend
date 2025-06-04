// config/db.js
import mongoose from 'mongoose'; // Assuming ESM, changed from require
import logger from './logger.js'; // Import the logger

const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/MyNotesAppDB_Prod';

  logger.debug('=== DB CONNECTION DEBUG ===', { mongoURI });

  if (!mongoURI) {
    const errorMessage = 'FATAL ERROR: DATABASE_URL is not defined in .env file or process.env.';
    logger.error(errorMessage);
    if (process.env.NODE_ENV === 'test') {
      throw new Error(errorMessage);
    } else {
      process.exit(1);
    }
  }

  if (mongoose.connection.readyState === 1 && mongoose.connections[0]?.client?.s?.url === mongoURI) {
    logger.info('[config/db.js] Already connected to the target URI.');
    return;
  }

  try {
    await mongoose.connect(mongoURI, {
      // Mongoose 6+ uses sensible defaults.
    });
    logger.info('[config/db.js] MongoDB Connected via mongoose.connect.');
  } catch (err) {
    logger.error('[config/db.js] MongoDB Connection Error:', { message: err.message, stack: err.stack });
    if (process.env.NODE_ENV === 'test') {
      throw err;
    } else {
      process.exit(1);
    }
  }
};

export default connectDB;