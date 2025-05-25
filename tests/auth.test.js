// tests/auth.test.js
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');

describe('Auth API Endpoints', () => {
    beforeEach(async () => {
        await User.deleteMany({ email: { $regex: /@test\.example\.com$/ } });
    });

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

        it('should return 400 if email is not provided or invalid', async () => {
            let res = await request(app)
                .post('/api/auth/register')
                .send({ password: 'password123' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide a valid email address.');

            res = await request(app)
                .post('/api/auth/register')
                .send({ email: 'invalidemail', password: 'password123' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide a valid email address.');
        });

        it('should return 400 if password is not provided', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ email: 'testmissingpass@test.example.com' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Password must be at least 8 characters long.');
        });


        it('should return 400 if password is less than 8 characters', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'shortpass@test.example.com',
                    password: 'pass',
                });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Password must be at least 8 characters long.');
        });

        it('should return 400 if user already exists', async () => {
            await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'existinguser@test.example.com',
                    password: 'password123',
                });
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
            await User.deleteMany({ email: loginUserEmail });
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

        it('should return 400 if email is not provided or invalid for login', async () => {
            let res = await request(app)
                .post('/api/auth/login')
                .send({ password: 'password123' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide a valid email address.');

            res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'invalidemail', password: 'password123' });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Please provide a valid email address.');
        });

        it('should return 400 if password is not provided for login', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: loginUserEmail });
            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toBe('Password is required.');
        });
    });
});