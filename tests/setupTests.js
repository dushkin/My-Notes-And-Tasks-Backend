// tests/setupTests.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const connectDB = require('../config/db');
const User = require('../models/User');

let mongod;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.DATABASE_URL = uri;
    try {
        await connectDB();
    } catch (e) {
        console.error('[setupTests.js] FATAL: Failed to connect to In-Memory DB:', e);
        process.exit(1);
    }
});

afterAll(async () => {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }
    if (mongod) {
        await mongod.stop();
    }
});

beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
        try {
            // Example: Delete users created specifically for testing
            await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
            // Add deletion for other test-specific data in other collections if necessary
        } catch (error) {
            console.error('[setupTests.js] Error during targeted beforeEach cleanup:', error);
        }
    }
});