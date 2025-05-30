require('dotenv').config({ path: '../.env' }); // Load .env from project root
const { generateAccessToken } = require('./jwt');

const userId = '68385a7bb9f11078ac6c6f24'; // Replace with a real user ID
const token = generateAccessToken(userId);
console.log('Generated JWT:', token);