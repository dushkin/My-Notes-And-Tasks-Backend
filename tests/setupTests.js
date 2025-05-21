// tests/setupTests.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const connectDB = require('../config/db');
const User = require('../models/User');
const fs = require('fs').promises; // For file system operations
const path = require('path');     // For path joining

let mongod;

// Define UPLOAD_DIR for test cleanup, consistent with items.test.js
const UPLOAD_DIR_FOR_TESTS = path.join(__dirname, '..', 'public', 'uploads', 'images');


beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.DATABASE_URL = uri; // Set for connectDB
    process.env.JWT_SECRET = 'testsecretkey'; // Ensure JWT_SECRET is set for tests
    process.env.BCRYPT_SALT_ROUNDS = '8'; // Use fewer salt rounds for faster tests

    try {
        await connectDB();
    } catch (e) {
        console.error('[setupTests.js] FATAL: Failed to connect to In-Memory DB:', e);
        process.exit(1); // Exit if DB connection fails during setup
    }

    // Ensure upload directory exists for tests but is empty
    try {
        await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });
        const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
        for (const file of files) {
            if (file !== '.gitkeep') { // Don't delete .gitkeep if you use one
                await fs.unlink(path.join(UPLOAD_DIR_FOR_TESTS, file));
            }
        }
    } catch (err) {
        console.error("[setupTests.js] Error preparing uploads directory for tests:", err);
    }
});

afterAll(async () => {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        await mongoose.connection.dropDatabase(); // Drop the test database
        await mongoose.disconnect();
    }
    if (mongod) {
        await mongod.stop();
    }
    // Clean up any remaining test image files after all tests
    try {
        const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
        for (const file of files) {
            if (file !== '.gitkeep') {
                await fs.unlink(path.join(UPLOAD_DIR_FOR_TESTS, file));
            }
        }
        // Optional: remove the directory itself if it was created by tests and should not persist
        // if (files.length === 0 || (files.length === 1 && files[0] === '.gitkeep')) {
        //    await fs.rmdir(UPLOAD_DIR_FOR_TESTS, { recursive: true }); // Careful with recursive remove
        // }
    } catch (err) {
        // console.warn("[setupTests.js] Warning: Could not fully clean up test image files/directory:", err.message);
    }
});

// General beforeEach to clean common test entities if not handled by specific test suites
beforeEach(async () => {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
            // This regex is good for general cleanup of test users if suites don't do it
            await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
        } catch (error) {
            console.error('[setupTests.js] Error during global beforeEach cleanup:', error);
        }
    }
});