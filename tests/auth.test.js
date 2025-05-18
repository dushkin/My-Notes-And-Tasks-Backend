// tests/auth.test.js
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');

describe('Auth API Endpoints', () => {

    beforeEach(async () => {
        // Specific cleanup for users, if not covered by a global pattern in setupTests.js
        // or if more granular control is needed for this suite.
        // If setupTests.js already cleans test users effectively, this might be redundant.
        await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
        await User.deleteMany({ email: 'test@example.com' }); // For specific emails used in these tests
        await User.deleteMany({ email: 'loginuser@example.com' });
    });

    describe('POST /api/auth/register', () => {
        it('should register a new user successfully', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@test.example.com',
                    password: 'password123',
                });
            expect(res.statusCode).toEqual(201);
            expect(res.body).toHaveProperty('token');
            expect(res.body).toHaveProperty('user');
            expect(res.body.user.email).toBe('test@test.example.com');
            expect(res.body.user).not.toHaveProperty('password');
            const userInDb = await User.findOne({ email: 'test@test.example.com' });
            expect(userInDb).not.toBeNull();
        });

        it('should return 400 if email or password is not provided', async () => {
            let res = await request(app)
                .post('/api/auth/register')
                .send({ email: 'test@test.example.com' });
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
            await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'existing@test.example.com',
                    password: 'password123',
                });
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'existing@test.example.com',
                    password: 'password123',
                });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('User already exists with this email');
        });
    });

    describe('POST /api/auth/login', () => {
        beforeEach(async () => {
            await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'loginuser@test.example.com',
                    password: 'password123',
                });
        });

        it('should login an existing user successfully', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'loginuser@test.example.com',
                    password: 'password123',
                });
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('token');
            expect(res.body).toHaveProperty('user');
            expect(res.body.user.email).toBe('loginuser@test.example.com');
        });

        it('should return 401 for invalid credentials (wrong password)', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'loginuser@test.example.com',
                    password: 'wrongpassword',
                });
            expect(res.statusCode).toEqual(401);
            expect(res.body.error).toBe('Invalid credentials');
        });

        it('should return 401 if user does not exist', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'nonexistent@test.example.com',
                    password: 'password123',
                });
            expect(res.statusCode).toEqual(401);
            expect(res.body.error).toBe('Invalid credentials');
        });

        it('should return 400 if email or password is not provided', async () => {
            let res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'loginuser@test.example.com' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide email and password');
        });
    });
});