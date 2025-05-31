// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/MyNotesAppDB_Prod';

  console.log('=== DB CONNECTION DEBUG ===');
  console.log('mongoURI:', mongoURI);
  console.log('============================');

  if (!mongoURI) {
    const errorMessage = 'FATAL ERROR: DATABASE_URL is not defined in .env file or process.env.';
    console.error(errorMessage);
    if (process.env.NODE_ENV === 'test') {
      throw new Error(errorMessage);
    } else {
      process.exit(1);
    }
  }
4
  // For tests, ensure we only try to connect if not already connected or connecting
  // setupTests.js will be the primary caller for the test DB.
  if (mongoose.connection.readyState === 1 && mongoose.connections[0].client.s.url === mongoURI) {
    // console.log('[config/db.js] Already connected to the target URI.');
    return;
  }
  // If a connection exists to a *different* URI, mongoose.connect will throw, which is handled.

  try {
    await mongoose.connect(mongoURI, {
      // Mongoose 6+ uses sensible defaults.
    });
    // console.log('[config/db.js] MongoDB Connected via mongoose.connect.');
  } catch (err) {
    console.error('[config/db.js] MongoDB Connection Error:', err.message);
    if (process.env.NODE_ENV === 'test') {
      // In tests, throw the error so Jest can catch it, rather than exiting the process.
      // This also helps if mongoose tries to connect to a different URI while already connected.
      throw err;
    } else {
      process.exit(1);
    }
  }
};

module.exports = connectDB;