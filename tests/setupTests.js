// tests/setupTests.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const connectDB = require('../config/db'); // Import your connectDB function

let mongod;

beforeAll(async () => {
    // console.log('[setupTests.js] Starting MongoDB In-Memory Server...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.DATABASE_URL = uri; // Override DATABASE_URL for all tests
    // console.log(`[setupTests.js] In-Memory DB URI set to: ${uri}`);
    // console.log('[setupTests.js] Connecting to In-Memory DB via connectDB...');
    try {
        await connectDB(); // Establish connection for the entire test suite
        // console.log('[setupTests.js] MongoDB In-Memory Connected successfully.');
    } catch (e) {
        console.error('[setupTests.js] FATAL: Failed to connect to In-Memory DB:', e);
        process.exit(1); // Essential services failed
    }
});

afterAll(async () => {
    // console.log('[setupTests.js] Disconnecting Mongoose and stopping In-Memory DB...');
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }
    if (mongod) {
        await mongod.stop();
    }
    // console.log('[setupTests.js] MongoDB In-Memory Server stopped and Mongoose disconnected.');
});

// Optional: Clear data before each test for complete isolation
beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
        const collections = mongoose.connection.collections;
        for (const key in collections) {
            const collection = collections[key];
            await collection.deleteMany({});
        }
    }
});