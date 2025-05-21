// tests/auth.test.js
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');

describe('Auth API Endpoints', () => {
    // Clean up test users before each test in this suite
    beforeEach(async () => {
        await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
    });

    // Clean up all test users after all tests in this suite have run
    afterAll(async () => {
        await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
    });

    describe('POST /api/auth/register', () => {
        it('should register a new user successfully', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'registeruser@test.example.com',
                    password: 'password123',
                });
            expect(res.statusCode).toEqual(201);
            expect(res.body).toHaveProperty('token');
            expect(res.body).toHaveProperty('user');
            expect(res.body.user.email).toBe('registeruser@test.example.com');
            expect(res.body.user).not.toHaveProperty('password');
            const userInDb = await User.findOne({ email: 'registeruser@test.example.com' });
            expect(userInDb).not.toBeNull();
        });

        it('should return 400 if email or password is not provided', async () => {
            let res = await request(app)
                .post('/api/auth/register')
                .send({ email: 'testmissingpass@test.example.com' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide email and password');

            res = await request(app)
                .post('/api/auth/register')
                .send({ password: 'password123' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide email and password');
        });

        it('should return 400 if password is less than 8 characters', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'shortpass@test.example.com',
                    password: 'pass',
                });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Password must be at least 8 characters long');
        });

        it('should return 400 if user already exists', async () => {
            // First registration
            await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'existinguser@test.example.com',
                    password: 'password123',
                });
            // Attempt to register again with the same email
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'existinguser@test.example.com',
                    password: 'anotherPassword123',
                });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('User already exists with this email');
        });
    });

    describe('POST /api/auth/login', () => {
        const loginUserEmail = 'loginuser@test.example.com';
        const loginUserPassword = 'password123';

        beforeEach(async () => {
            // Ensure user for login tests exists
            await User.deleteMany({ email: loginUserEmail }); // Clean up specific user first
            await request(app)
                .post('/api/auth/register')
                .send({
                    email: loginUserEmail,
                    password: loginUserPassword,
                });
        });

        it('should login an existing user successfully', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: loginUserEmail,
                    password: loginUserPassword,
                });
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('token');
            expect(res.body).toHaveProperty('user');
            expect(res.body.user.email).toBe(loginUserEmail);
        });

        it('should return 401 for invalid credentials (wrong password)', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: loginUserEmail,
                    password: 'wrongpassword',
                });
            expect(res.statusCode).toEqual(401);
            expect(res.body.error).toBe('Invalid credentials');
        });

        it('should return 401 if user does not exist', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'nonexistentuser@test.example.com',
                    password: 'password123',
                });
            expect(res.statusCode).toEqual(401);
            expect(res.body.error).toBe('Invalid credentials');
        });

        it('should return 400 if email or password is not provided for login', async () => {
            let res = await request(app)
                .post('/api/auth/login')
                .send({ email: loginUserEmail });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide email and password');

            res = await request(app)
                .post('/api/auth/login')
                .send({ password: loginUserPassword });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide email and password');
        });
    });
});