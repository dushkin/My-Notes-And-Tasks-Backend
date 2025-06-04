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
  // Ensure MONGODB_URI for tests is overridden or handled by MongoMemoryServer
  // If your .env file has a MONGODB_URI, MongoMemoryServer will usually provide its own.
  // If JWT_SECRET or other critical env vars are still missing after dotenv.config,
  // it means they aren't in your .env file or the path is incorrect.
  if (!process.env.JWT_SECRET) {
    console.error('FATAL ERROR in setupTests.js: JWT_SECRET is still not defined after dotenv.config(). Check your .env file and its path.');
    // Optionally throw an error to stop tests if critical env vars are missing
    // throw new Error('JWT_SECRET must be defined in .env for tests.');
  }

  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  // Override process.env.MONGODB_URI for the test mongoose connection
  // This ensures tests use the in-memory server regardless of .env content
  process.env.TEST_MONGODB_URI = uri; 
  await mongoose.connect(uri);
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  if (mongod) {
    await mongod.stop();
  }
});