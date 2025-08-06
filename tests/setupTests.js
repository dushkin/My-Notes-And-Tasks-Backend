// tests/setupTests.js
import dotenv from 'dotenv'; // Import dotenv
import path from 'path'; // Import path for potential .env path customization

// Determine the path to your .env file (assuming it's in the project root,
// which is one level up from the 'tests' directory)
const projectRoot = path.resolve(process.cwd()); // Or use a more direct relative path if consistent
dotenv.config({ path: path.join(projectRoot, '.env') }); // Load .env file

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Timeout is handled in Jest config or CLI.

let mongod;

beforeAll(async () => {
  // Set default JWT_SECRET for tests if not provided
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
  }

  try {
    mongod = await MongoMemoryServer.create({
      instance: {
        dbName: 'test-db',
      },
    });
    const uri = mongod.getUri();
    process.env.TEST_MONGODB_URI = uri;
    
    // Connect to the in-memory database
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  } catch (error) {
    console.error('Failed to start MongoDB Memory Server:', error);
    throw error;
  }
}, 60000); // 60 second timeout for setup

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  if (mongod) {
    await mongod.stop();
  }
});