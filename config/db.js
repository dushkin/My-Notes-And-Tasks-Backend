// config/db.js
const mongoose = require('mongoose');
// mongoose.set('debug', true);

const connectDB = async () => {
  try {
    const mongoURI = process.env.DATABASE_URL; // Make sure this is in your .env file!
    if (!mongoURI) {
      console.error('FATAL ERROR: DATABASE_URL is not defined in .env file.');
      process.exit(1); // Exit process with failure
    }

    await mongoose.connect(mongoURI, {
      // Remove deprecated options: useNewUrlParser, useUnifiedTopology, useCreateIndex, useFindAndModify
      // Mongoose 6+ handles these automatically.
    });

    console.log('MongoDB Connected...');
  } catch (err) {
    console.error('MongoDB Connection Error:', err.message);
    // Exit process with failure
    process.exit(1);
  }
};

module.exports = connectDB;