import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load environment variables FIRST
console.log('Loading environment variables...');
const result = dotenv.config();
console.log('dotenv result:', result);

// Debug environment loading
console.log('DATA_ENCRYPTION_SECRET exists:', !!process.env.DATA_ENCRYPTION_SECRET);
console.log('DATA_ENCRYPTION_SECRET length:', process.env.DATA_ENCRYPTION_SECRET?.length);

// Exit early if secret is missing
if (!process.env.DATA_ENCRYPTION_SECRET) {
  console.error('ERROR: DATA_ENCRYPTION_SECRET is not loaded');
  console.error('Current working directory:', process.cwd());
  console.error('Available env vars:', Object.keys(process.env).filter(key => key.includes('DATA')));
  process.exit(1);
}

console.log('Environment loaded successfully, now importing User model...');

// Import User model AFTER environment variables are loaded
const User = (await import('../models/User.js')).default;

console.log('User model imported successfully');

async function migrate() {
  console.log('Connecting to database...');
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  
  const users = await User.find({});
  console.log(`Found ${users.length} users to encrypt`);
  
  for (const user of users) {
    user.markModified('notesTree');
    await user.save();
    console.log(`Encrypted data for user ${user._id}`);
  }
  
  console.log('Migration completed successfully');
  await mongoose.disconnect();
  process.exit();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});