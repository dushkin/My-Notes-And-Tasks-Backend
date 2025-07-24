import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get environment from command line argument
const environment = process.argv[2] || 'development';

console.log(`🚀 Running migration for: ${environment.toUpperCase()} environment`);

// Load environment-specific file
if (environment === 'production') {
  const prodEnvPath = path.join(__dirname, '..', '.env.production');
  console.log('Loading production environment from: .env.production');
  console.log('Full path:', prodEnvPath);
  
  // Check if file exists
  if (!fs.existsSync(prodEnvPath)) {
    console.error('❌ .env.production file does not exist at:', prodEnvPath);
    process.exit(1);
  }
  
  const result = dotenv.config({ path: prodEnvPath });
  console.log('dotenv.config result:', result);
  
  if (result.error) {
    console.error('❌ Error loading .env.production:', result.error);
    process.exit(1);
  }
} else {
  console.log('Loading development environment from: .env');
  dotenv.config(); // Loads .env by default
}

// Debug environment loading
console.log('Environment check:');
console.log('- MONGODB_URI:', process.env.MONGODB_URI ? 'SET' : 'NOT SET');
console.log('- DATA_ENCRYPTION_SECRET:', process.env.DATA_ENCRYPTION_SECRET ? 'SET' : 'NOT SET');

// Exit early if secret is missing
if (!process.env.DATA_ENCRYPTION_SECRET) {
  console.error('❌ ERROR: DATA_ENCRYPTION_SECRET is not loaded');
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error('❌ ERROR: MONGODB_URI is not loaded');
  process.exit(1);
}

// Show which database we're connecting to (mask password but show database name)
const dbUri = process.env.MONGODB_URI;
const maskedUri = dbUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
console.log(`📁 Database URI: ${maskedUri}`);

// Extract and show the database name specifically
const dbNameMatch = dbUri.match(/\/([^?]+)\?/);
const dbName = dbNameMatch ? dbNameMatch[1] : 'unknown';
console.log(`📊 Database Name: ${dbName}`);

// Confirm before proceeding with production
if (environment === 'production') {
  console.log('\n⚠️  WARNING: You are about to run migration on PRODUCTION database!');
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
  
  await new Promise(resolve => setTimeout(resolve, 8000));
  console.log('Proceeding with production migration...\n');
}

console.log('Importing User model...');

// Import User model AFTER environment variables are loaded
const User = (await import('../models/User.js')).default;

console.log('✅ User model imported successfully');

async function migrate() {
  console.log('🔗 Connecting to database...');
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  
  console.log('✅ Database connected');
  
  const users = await User.find({});
  console.log(`📊 Found ${users.length} users to encrypt`);
  
  if (users.length === 0) {
    console.log('No users found to encrypt');
    await mongoose.disconnect();
    return;
  }
  
  console.log('🔐 Starting encryption process...');
  
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    console.log(`Processing ${i + 1}/${users.length}: ${user.email}`);
    
    user.markModified('notesTree');
    await user.save();
    console.log(`✅ Encrypted data for user ${user._id}`);
  }
  
  console.log('\n🎉 Migration completed successfully!');
  await mongoose.disconnect();
  console.log('📤 Database disconnected');
  process.exit();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});