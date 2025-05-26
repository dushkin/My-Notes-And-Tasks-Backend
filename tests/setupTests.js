// Clear cached modules to prevent .env interference
Object.keys(require.cache).forEach((key) => {
    if (key.includes('dotenv') || key.includes('server.js') || key.includes('config/db.js') || key.includes('jwt.js') || key.includes('authController.js')) {
        delete require.cache[key];
    }
});

// Set environment variables for tests BEFORE anything else
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'testsecretkey123';
process.env.BCRYPT_SALT_ROUNDS = '8';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const connectDB = require('../config/db');
const User = require('../models/User');
const fs = require('fs').promises;
const path = require('path');
const app = require('../server');
const http = require('http');

let mongod;
let server;
const UPLOAD_DIR_FOR_TESTS = path.join(__dirname, '..', 'public', 'uploads', 'images');

beforeAll(async () => {
    delete process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'testsecretkey123';

    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.DATABASE_URL = uri;

    try {
        await connectDB();
        if (mongoose.connection.readyState !== 1) {
            throw new Error('MongoDB connection not established');
        }
    } catch (e) {
        console.error('[setupTests.js] FATAL: Failed to connect to In-Memory DB:', e);
        process.exit(1);
    }

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    console.log('[setupTests.js] Test server started');

    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
        await fs.mkdir(UPLOAD_DIR_FOR_TESTS, { recursive: true });
        const files = await fs.readdir(UPLOAD_DIR_FOR_TESTS);
        for (const file of files) {
            if (file !== '.gitkeep') {
                await fs.unlink(path.join(UPLOAD_DIR_FOR_TESTS, file));
            }
        }
    } catch (err) {
        console.error('[setupTests.js] Error preparing uploads directory:', err);
    }
});

afterAll(async () => {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
    if (mongod) {
        await mongod.stop();
    }
    if (server) {
        await new Promise((resolve) => server.close(resolve));
        console.log('[setupTests.js] Test server stopped');
    }
    try {
        await fs.rm(UPLOAD_DIR_FOR_TESTS, { recursive: true, force: true });
    } catch (err) {
        console.warn('[setupTests.js] Warning during cleanup of test image files:', err.message);
    }
});

beforeEach(async () => {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
            await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
        } catch (error) {
            console.error('[setupTests.js] Error during beforeEach cleanup:', error);
        }
    }
});